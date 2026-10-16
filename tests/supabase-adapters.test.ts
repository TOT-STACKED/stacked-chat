import { describe, expect, it } from 'vitest';
import { createSupabaseTokenVerifier } from '../src/lib/auth.js';
import { ApiHttpError } from '../src/lib/errors.js';
import type { Db, DbResult } from '../src/lib/supabase.js';
import { createSupabaseRepo } from '../src/lib/supabase-repo.js';

/** Records every PostgREST call and answers from a queue. */
function recordingDb(...answers: DbResult[]) {
  const calls: { path: string; init?: { method?: string; body?: unknown; headers?: Record<string, string> } }[] = [];
  const db: Db = {
    ping: async () => true,
    rest: async <T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      calls.push({ path, init });
      return (answers.shift() ?? { status: 200, data: [] }) as DbResult<T>;
    },
  };
  return { db, calls };
}
const UID = '11111111-1111-1111-1111-111111111111';

describe('token verifier (Supabase Auth)', () => {
  const mk = (resp: { ok: boolean; body?: unknown }, counter = { n: 0 }, now = () => Date.now()) =>
    createSupabaseTokenVerifier({
      url: 'https://x.supabase.co', anonKey: 'anon', now,
      fetchImpl: (async () => { counter.n++; return { ok: resp.ok, json: async () => resp.body } as Response; }) as unknown as typeof fetch,
    });

  it('accepts a confirmed email and lower-cases it', async () => {
    const v = mk({ ok: true, body: { id: UID, email: 'Chris@Stacked.IO', email_confirmed_at: '2026-01-01' } });
    expect(await v('t')).toEqual({ userId: UID, email: 'chris@stacked.io' });
  });
  it('rejects an unconfirmed email, a failed lookup, and a malformed body', async () => {
    expect(await mk({ ok: true, body: { id: UID, email: 'a@b.co', email_confirmed_at: null } })('t')).toBeNull();
    expect(await mk({ ok: false })('t')).toBeNull();
    expect(await mk({ ok: true, body: {} })('t')).toBeNull();
  });
  it('caches results (one upstream call per token per minute) and expires them', async () => {
    const c = { n: 0 }; let t = 1_000_000;
    const v = mk({ ok: true, body: { id: UID, email: 'a@b.co', email_confirmed_at: 'x' } }, c, () => t);
    await v('tok'); await v('tok'); await v('tok');
    expect(c.n).toBe(1);
    t += 61_000; await v('tok');
    expect(c.n).toBe(2);
  });
  it('sends the anon key and the user token to Supabase Auth', async () => {
    let seen: { url?: string; headers?: Record<string, string> } = {};
    const v = createSupabaseTokenVerifier({ url: 'https://x.supabase.co/', anonKey: 'ANON', fetchImpl: (async (u: string, init: RequestInit) => { seen = { url: u, headers: init.headers as Record<string, string> }; return { ok: false } as Response; }) as unknown as typeof fetch });
    await v('USERTOKEN');
    expect(seen.url).toBe('https://x.supabase.co/auth/v1/user');
    expect(seen.headers).toEqual({ apikey: 'ANON', Authorization: 'Bearer USERTOKEN' });
  });
});

describe('Supabase repo (query building and error mapping)', () => {
  it('memberships: looks up by user id AND by not-yet-linked email, merging duplicates', async () => {
    const row = { id: 'm1', org_id: 'o1', site_id: null, role: 'owner', organisations: { name: 'Acme' }, venues: null };
    const { db, calls } = recordingDb({ status: 200, data: [row] }, { status: 200, data: [row, { ...row, id: 'm2', site_id: 's1', role: 'staff', venues: { name: 'North' } }] });
    const out = await createSupabaseRepo(db).membershipsForUser(UID, 'Chris+test@Stacked.io');
    expect(calls[0]!.path).toContain(`user_id=eq.${UID}`);
    expect(calls[1]!.path).toContain('email=eq.chris%2Btest%40stacked.io');
    expect(calls[1]!.path).toContain('user_id=is.null');
    expect(out.map((m) => m.memberId).sort()).toEqual(['m1', 'm2']);
    expect(out.find((m) => m.memberId === 'm2')).toMatchObject({ siteName: 'North', role: 'staff' });
  });

  it('linkUser only touches unlinked rows with that email: invited people become active, others are only linked', async () => {
    const { db, calls } = recordingDb({ status: 204, data: null }, { status: 204, data: null });
    await createSupabaseRepo(db).linkUser('A@B.co', UID);
    expect(calls[0]).toMatchObject({ path: '/members?email=eq.a%40b.co&user_id=is.null&status=eq.invited', init: { method: 'PATCH', body: { user_id: UID, status: 'active' } } });
    expect(calls[1]).toMatchObject({ path: '/members?email=eq.a%40b.co&user_id=is.null&status=neq.invited', init: { method: 'PATCH', body: { user_id: UID } } });
  });

  it('listSites restricts to the given ids, and short-circuits an empty list without a query', async () => {
    const { db, calls } = recordingDb({ status: 200, data: [] });
    const repo = createSupabaseRepo(db);
    expect(await repo.listSites('o1', [])).toEqual([]);
    expect(calls).toHaveLength(0);
    await repo.listSites('o1', ['a', 'b']);
    expect(calls[0]!.path).toContain('id=in.(a,b)');
  });

  it('createMember lower-cases the email; a unique violation becomes 409', async () => {
    const { db, calls } = recordingDb({ status: 409, data: { code: '23505', message: 'duplicate' } });
    const repo = createSupabaseRepo(db);
    await expect(repo.createMember({ org_id: 'o', site_id: null, email: 'X@Y.CO', role: 'staff', status: 'invited' })).rejects.toMatchObject({ statusCode: 409 });
    expect((calls[0]!.init!.body as { email: string }).email).toBe('x@y.co');
  });

  it('database failures surface as a generic 503 (no internals leaked)', async () => {
    const { db } = recordingDb({ status: 500, data: { message: 'relation "members" does not exist' } });
    const err = await createSupabaseRepo(db).listMembers('o1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).toMatchObject({ statusCode: 503, code: 'database_error', message: 'list members failed' });
  });

  it('revoke reports whether a key was actually revoked', async () => {
    const { db } = recordingDb({ status: 200, data: [{ id: 'k1' }] }, { status: 200, data: [] });
    const repo = createSupabaseRepo(db);
    expect(await repo.revokeApiKey('o1', 'k1')).toBe(true);
    expect(await repo.revokeApiKey('o1', 'k1')).toBe(false);
  });

  it('counts only ACTIVE owners', async () => {
    const { db, calls } = recordingDb({ status: 200, data: [{ id: '1' }, { id: '2' }] });
    expect(await createSupabaseRepo(db).countActiveOwners('o1')).toBe(2);
    expect(calls[0]!.path).toContain('role=eq.owner');
    expect(calls[0]!.path).toContain('status=eq.active');
  });
});

describe('Supabase repo: teams and sites', () => {
  it('lists member-team links for ONE organisation via an inner join, dropping the join column', async () => {
    const { db, calls } = recordingDb({ status: 200, data: [{ member_id: 'm1', team_id: 't1', members: { org_id: 'o1' } }] });
    expect(await createSupabaseRepo(db).listMemberTeams('o1')).toEqual([{ member_id: 'm1', team_id: 't1' }]);
    expect(calls[0]!.path).toBe('/member_teams?select=member_id,team_id,members!inner(org_id)&members.org_id=eq.o1');
  });

  it('setMemberTeams replaces the set: delete then insert; an empty list only deletes', async () => {
    const a = recordingDb({ status: 204, data: null }, { status: 201, data: null });
    await createSupabaseRepo(a.db).setMemberTeams('m1', ['t1', 't2']);
    expect(a.calls.map((c) => c.init?.method)).toEqual(['DELETE', 'POST']);
    expect(a.calls[0]!.path).toBe('/member_teams?member_id=eq.m1');
    expect(a.calls[1]!.init!.body).toEqual([{ member_id: 'm1', team_id: 't1' }, { member_id: 'm1', team_id: 't2' }]);
    const b = recordingDb({ status: 204, data: null });
    await createSupabaseRepo(b.db).setMemberTeams('m1', []);
    expect(b.calls).toHaveLength(1);
  });

  it('createSite writes to venues with its organisation; a slug clash becomes 409', async () => {
    const ok = recordingDb({ status: 201, data: [{ id: 's1', org_id: 'o1', name: 'N', slug: 'n-ab12', created_at: null }] });
    const site = await createSupabaseRepo(ok.db).createSite({ org_id: 'o1', name: 'N', slug: 'n-ab12' });
    expect(site.id).toBe('s1');
    expect(ok.calls[0]).toMatchObject({ path: expect.stringContaining('/venues?'), init: { method: 'POST', body: { org_id: 'o1', name: 'N', slug: 'n-ab12' } } });
    const clash = recordingDb({ status: 409, data: { code: '23505' } });
    await expect(createSupabaseRepo(clash.db).createSite({ org_id: 'o1', name: 'N', slug: 'dup' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('deleteTeam is scoped to the organisation and reports whether anything was deleted', async () => {
    const { db, calls } = recordingDb({ status: 200, data: [{ id: 't1' }] }, { status: 200, data: [] });
    const repo = createSupabaseRepo(db);
    expect(await repo.deleteTeam('o1', 't1')).toBe(true);
    expect(calls[0]!.path).toContain('org_id=eq.o1');
    expect(await repo.deleteTeam('o1', 't1')).toBe(false);
  });
});
