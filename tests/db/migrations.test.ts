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

describe('005 storage policies', () => {
  it('drops the public rules on the stacked-videos bucket and leaves other buckets alone', async () => {
    const db = await newDb('004_backfill_organisations.sql');
    await db.exec(`
      create policy "anon read videos"   on storage.objects for select to anon using (bucket_id = 'stacked-videos');
      create policy "anon upload videos" on storage.objects for insert to anon with check (bucket_id = 'stacked-videos');
      create policy "other app avatars"  on storage.objects for select to anon using (bucket_id = 'avatars');
    `);
    await db.exec(migrationSql('005_storage_private.sql'));
    const left = (await db.query<{ policyname: string }>(`select policyname from pg_policies where schemaname='storage' order by 1`)).rows;
    expect(left).toEqual([{ policyname: 'other app avatars' }]);
    await db.exec(migrationSql('005_storage_private.sql')); // safe to re-run
  });
});

describe('006 keep new tenancy model in sync with legacy writes', () => {
  const orgOf = async (db: PGlite, slug: string) => (await q(db, `select org_id from venues where slug = '${slug}'`))[0]?.org_id as string;
  const memberRole = async (db: PGlite, email: string) => (await q(db, `select role::text r, status from members where email = '${email}'`))[0];

  it('catches up venues and members that were created after the 004 backfill', async () => {
    const db = await newDb('005_storage_private.sql');
    await db.exec(migrationSql('004_backfill_organisations.sql'));
    await db.exec(`
      insert into venues (id, name, slug, workspace_id) values ('e0000000-0000-0000-0000-00000000000e', 'Late Venue', 'late-venue', 'tgi-fridays');
      insert into venue_members (venue_id, email, name, role) values ('e0000000-0000-0000-0000-00000000000e', 'Boss@Late.com', 'Boss', 'admin');
    `);
    expect((await q(db, "select count(*)::int n from venues where org_id is null"))[0]?.n).toBe(1); // the gap
    await db.exec(migrationSql('006_sync_legacy_to_tenancy.sql'));
    expect((await q(db, "select count(*)::int n from venues where org_id is null"))[0]?.n).toBe(0);
    expect((await q(db, "select slug from organisations where workspace_id = 'tgi-fridays'"))[0]?.slug).toBe('tgi-fridays');
    expect(await memberRole(db, 'boss@late.com')).toEqual({ r: 'owner', status: 'active' });
    await db.exec(migrationSql('006_sync_legacy_to_tenancy.sql')); // idempotent
    expect((await q(db, "select count(*)::int n from members where email = 'boss@late.com'"))[0]?.n).toBe(1);
  });

  describe('after the migration (live sync)', () => {
    let db: PGlite;
    beforeEach(async () => { db = await newDb(); });

    it('gives every new venue an organisation: by workspace, or its own', async () => {
      await db.exec(`
        insert into venues (name, slug, workspace_id) values ('A1', 'a1', 'chain'), ('A2', 'a2', 'chain'), ('Solo', 'solo', null);`);
      expect(await orgOf(db, 'a1')).toBe(await orgOf(db, 'a2'));
      expect(await orgOf(db, 'solo')).not.toBe(await orgOf(db, 'a1'));
      expect((await q(db, "select slug from organisations where id = (select org_id from venues where slug='solo')"))[0]?.slug).toBe('venue-solo');
    });

    it("a workspace set later is adopted by the venue's own organisation (no duplicate org)", async () => {
      await db.exec(`insert into venues (id, name, slug) values ('f0000000-0000-0000-0000-00000000000f', 'Later', 'later');`);
      const before = await orgOf(db, 'later');
      await db.exec(`update venues set workspace_id = 'later-co' where slug = 'later'`);
      expect(await orgOf(db, 'later')).toBe(before);
      expect((await q(db, "select count(*)::int n from organisations"))[0]?.n).toBe(1);
      expect((await q(db, `select workspace_id from organisations where id = '${before}'`))[0]?.workspace_id).toBe('later-co');
    });

    it('moves a venue (and its members) when its workspace already belongs to another organisation', async () => {
      await db.exec(`
        insert into venues (id, name, slug, workspace_id) values ('a1000000-0000-0000-0000-0000000000a1', 'Main', 'main', 'group');
        insert into venues (id, name, slug) values ('a2000000-0000-0000-0000-0000000000a2', 'Branch', 'branch');
        insert into venue_members (venue_id, email, name, role) values ('a2000000-0000-0000-0000-0000000000a2', 'x@y.com', 'X', 'staff');
        update venues set workspace_id = 'group' where slug = 'branch';`);
      expect(await orgOf(db, 'branch')).toBe(await orgOf(db, 'main'));
      expect((await q(db, "select count(*)::int n from members m join venues v on v.id = m.site_id where m.org_id <> v.org_id"))[0]?.n).toBe(0);
    });

    it('mirrors legacy members: first admin -> owner, later admins -> site_manager, staff -> staff', async () => {
      await db.exec(`
        insert into venues (id, name, slug, workspace_id) values ('b0000000-0000-0000-0000-00000000000b', 'V', 'v', 'co');
        insert into venue_members (venue_id, email, name, role) values
          ('b0000000-0000-0000-0000-00000000000b', 'one@co.com', 'One', 'admin'),
          ('b0000000-0000-0000-0000-00000000000b', 'two@co.com', 'Two', 'admin'),
          ('b0000000-0000-0000-0000-00000000000b', 'S@co.com', 'S', 'staff');`);
      expect((await memberRole(db, 'one@co.com'))?.r).toBe('owner');
      expect((await memberRole(db, 'two@co.com'))?.r).toBe('site_manager');
      expect((await memberRole(db, 's@co.com'))?.r).toBe('staff');
    });

    it('follows legacy role changes but never demotes an owner; deleting disables, never deletes', async () => {
      await db.exec(`
        insert into venues (id, name, slug, workspace_id) values ('c0000000-0000-0000-0000-00000000000c', 'V', 'v', 'co');
        insert into venue_members (venue_id, email, name, role) values
          ('c0000000-0000-0000-0000-00000000000c', 'own@co.com', 'Own', 'admin'),
          ('c0000000-0000-0000-0000-00000000000c', 'adm@co.com', 'Adm', 'admin');
        update venue_members set role = 'staff' where email = 'adm@co.com';
        update venue_members set role = 'staff' where email = 'own@co.com';`);
      expect((await memberRole(db, 'adm@co.com'))?.r).toBe('staff');
      expect((await memberRole(db, 'own@co.com'))?.r).toBe('owner'); // owner is a new-model role: not demoted by legacy edits
      await db.exec(`delete from venue_members where email = 'adm@co.com'`);
      expect(await memberRole(db, 'adm@co.com')).toEqual({ r: 'staff', status: 'disabled' });
    });
  });
});
