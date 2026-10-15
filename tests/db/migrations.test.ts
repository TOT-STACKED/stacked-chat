import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, migrationFiles, migrationSql, newDb } from './harness.js';

const q = async (db: PGlite, sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

describe('migrations', () => {
  it('apply cleanly in order and are safe to re-run', async () => {
    const db = await newDb();
    for (const f of migrationFiles()) await db.exec(migrationSql(f)); // second pass
    const t = await q(db, "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('organisations','members','teams','member_teams','api_keys')");
    expect(t[0]?.n).toBe(5);
  });
});

/** Seed shaped like production: venues with/without a workspace, an admin-less venue, shared + tenant content. */
async function seedLegacy(db: PGlite) {
  await db.exec(`
    insert into venues (id, name, slug, workspace_id) values
      ('a0000000-0000-0000-0000-00000000000a', 'Acme North', 'acme-north', 'acme'),
      ('b0000000-0000-0000-0000-00000000000b', 'Acme South', 'acme-south', 'acme'),
      ('c0000000-0000-0000-0000-00000000000c', 'Cafe C',     'cafe-c',     null),
      ('d0000000-0000-0000-0000-00000000000d', 'Solo D',     'solo-d',     'solo');
    insert into venue_members (venue_id, email, name, role, created_at) values
      ('a0000000-0000-0000-0000-00000000000a', 'Zed@X.com', 'Zed', 'admin', '2026-01-01'),
      ('a0000000-0000-0000-0000-00000000000a', 'amy@x.com', 'Amy', 'staff', '2026-01-02'),
      ('b0000000-0000-0000-0000-00000000000b', 'bob@x.com', 'Bob', 'admin', '2026-02-01'),
      ('c0000000-0000-0000-0000-00000000000c', 'cat@x.com', 'Cat', 'staff', '2026-03-01'),
      ('d0000000-0000-0000-0000-00000000000d', 'dee@x.com', 'Dee', 'admin', '2026-04-01');
    insert into documents (filename, workspace_id) values ('a1','acme'), ('a2','acme'), ('shared', null), ('ghost','ghost');
    insert into videos (url, tenant) values ('u1','acme'), ('u2','stacked'), ('u3', null);
  `);
}

describe('004 backfill (legacy -> organisations/sites/members)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await newDb('002_lockdown_legacy_tables.sql');
    await seedLegacy(db);
    await db.exec(migrationSql('003_tenancy.sql'));
    await db.exec(migrationSql('004_backfill_organisations.sql'));
  });

  it('creates one organisation per workspace, plus one per workspace-less venue', async () => {
    const orgs = await q(db, 'select slug, workspace_id from organisations order by slug');
    expect(orgs.map((o) => o.slug)).toEqual(['acme', 'solo', 'venue-cafe-c']);
    const v = await q(db, 'select count(*)::int n from venues where org_id is null');
    expect(v[0]?.n).toBe(0);
    const sameOrg = await q(db, "select count(distinct org_id)::int n from venues where workspace_id = 'acme'");
    expect(sameOrg[0]?.n).toBe(1);
  });

  it('maps roles: admin -> site_manager, earliest admin per organisation -> owner, staff -> staff', async () => {
    const m = await q(db, 'select email, role::text role, status from members order by email');
    expect(m).toEqual([
      { email: 'amy@x.com', role: 'staff', status: 'active' },
      { email: 'bob@x.com', role: 'site_manager', status: 'active' },
      { email: 'cat@x.com', role: 'staff', status: 'active' },
      { email: 'dee@x.com', role: 'owner', status: 'active' },
      { email: 'zed@x.com', role: 'owner', status: 'active' }, // lower-cased, earliest acme admin
    ]);
  });

  it('keeps site scope on members, and never deletes legacy data', async () => {
    const m = await q(db, "select site_id from members where email = 'amy@x.com'");
    expect(m[0]?.site_id).toBe('a0000000-0000-0000-0000-00000000000a');
    expect((await q(db, 'select count(*)::int n from venue_members'))[0]?.n).toBe(5);
    expect((await q(db, 'select count(*)::int n from documents'))[0]?.n).toBe(4);
  });

  it('assigns tenant content to organisations and leaves shared content shared', async () => {
    const d = await q(db, "select filename, (org_id is not null) as has_org from documents order by filename");
    expect(d).toEqual([
      { filename: 'a1', has_org: true }, { filename: 'a2', has_org: true },
      { filename: 'ghost', has_org: false }, { filename: 'shared', has_org: false },
    ]);
    const v = await q(db, 'select url, (org_id is not null) as has_org from videos order by url');
    expect(v).toEqual([{ url: 'u1', has_org: true }, { url: 'u2', has_org: false }, { url: 'u3', has_org: false }]);
  });

  it('is idempotent: running the backfill again changes nothing', async () => {
    const before = await q(db, 'select (select count(*) from organisations)::int o, (select count(*) from members)::int m');
    await db.exec(migrationSql('004_backfill_organisations.sql'));
    expect(await q(db, 'select (select count(*) from organisations)::int o, (select count(*) from members)::int m')).toEqual(before);
    expect((await q(db, "select count(*)::int n from members where role = 'owner'"))[0]?.n).toBe(2);
  });

  it('reports venues that have members but no admin, without promoting anyone', async () => {
    const report = await q(db, `select v.name from venues v join venue_members vm on vm.venue_id = v.id
      group by v.id, v.name having count(*) filter (where vm.role = 'admin') = 0`);
    expect(report).toEqual([{ name: 'Cafe C' }]);
    const cat = await q(db, "select role::text role from members where email = 'cat@x.com'");
    expect(cat[0]?.role).toBe('staff');
  });
});

describe('row-level security', () => {
  const U1 = '11111111-1111-1111-1111-111111111111';
  const U2 = '22222222-2222-2222-2222-222222222222';
  let db: PGlite;
  beforeEach(async () => {
    db = await newDb();
    await seedLegacy(db);
    await db.exec(migrationSql('004_backfill_organisations.sql'));
    await db.exec(`update members set user_id = '${U1}' where email = 'zed@x.com'; update members set user_id = '${U2}' where email = 'amy@x.com';`);
  });

  const ALL = ['venues', 'venue_members', 'documents', 'videos', 'conversations', 'tickets', 'leads', 'nps_scores', 'images',
    'organisations', 'teams', 'members', 'member_teams', 'api_keys'];

  it('the public (anon) key cannot read, write or delete ANY table', async () => {
    for (const t of ALL) {
      // use each table's real first column so the statement parses and the PERMISSION check is what fails
      const col = (await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema='public' and table_name='${t}' order by ordinal_position limit 1`)).rows[0]!.column_name;
      await asRole(db, 'anon', null, async () => {
        await expect(db.query(`select * from public.${t} limit 1`), `anon select ${t}`).rejects.toThrow(/permission denied/);
        await expect(db.query(`delete from public.${t}`), `anon delete ${t}`).rejects.toThrow(/permission denied/);
        await expect(db.query(`update public.${t} set ${col} = ${col}`), `anon update ${t}`).rejects.toThrow(/permission denied/);
        await expect(db.query(`insert into public.${t} default values`), `anon insert ${t}`).rejects.toThrow(/permission denied/);
      });
    }
  });

  it('a signed-in user can read only their own membership, and cannot change it', async () => {
    await asRole(db, 'authenticated', U2, async () => {
      const rows = (await db.query<{ email: string }>('select email from public.members')).rows;
      expect(rows).toEqual([{ email: 'amy@x.com' }]);
      await expect(db.query("update public.members set role = 'owner'")).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.organisations')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.api_keys')).rejects.toThrow(/permission denied/);
    });
  });

  it('a signed-in user cannot read legacy tenant tables either', async () => {
    await asRole(db, 'authenticated', U1, async () => {
      for (const t of ['venues', 'venue_members', 'documents', 'conversations', 'leads']) {
        await expect(db.query(`select * from public.${t}`), t).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('the service role (our server) can read everything', async () => {
    await asRole(db, 'service_role', null, async () => {
      expect((await db.query<{ n: number }>('select count(*)::int n from public.members')).rows[0]?.n).toBe(5);
      expect((await db.query<{ n: number }>('select count(*)::int n from public.venues')).rows[0]?.n).toBe(4);
    });
  });

  it('is_org_member / has_org_role reflect the signed-in user', async () => {
    const acme = (await db.query<{ id: string }>("select id from public.organisations where slug = 'acme'")).rows[0]!.id;
    const solo = (await db.query<{ id: string }>("select id from public.organisations where slug = 'solo'")).rows[0]!.id;
    await asRole(db, 'authenticated', U1, async () => {
      const r = (await db.query<Record<string, boolean>>(
        `select public.is_org_member('${acme}') as acme_member, public.is_org_member('${solo}') as solo_member,
                public.has_org_role('${acme}', array['owner','hq_admin']::public.member_role[]) as acme_admin`)).rows[0];
      expect(r).toEqual({ acme_member: true, solo_member: false, acme_admin: true });
    });
    await asRole(db, 'authenticated', U2, async () => {
      const r = (await db.query<Record<string, boolean>>(
        `select public.has_org_role('${acme}', array['owner','hq_admin']::public.member_role[]) as acme_admin`)).rows[0];
      expect(r?.acme_admin).toBe(false);
    });
  });
});
