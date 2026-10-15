/**
 * LOCAL PREVIEW ONLY (never loaded by server.js or production).
 * Runs the Manage app against in-memory sample data so the screens can be tried without
 * Supabase. Sign in by choosing a role: tokens are dev-owner, dev-hq, dev-mgr, dev-staff.
 *   npm run build && node dist/dev-server.js
 */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { FakeMailer, FakeRepo } from './testing/fakes.js';
import { FakeBillingStore, FakeStripe, testBillingConfig } from './testing/billing-fakes.js';

async function main() {
  const repo = new FakeRepo();
  const org = repo.addOrg('Sample Group');
  const a = repo.addSite(org, 'Site A'); const b = repo.addSite(org, 'Site B'); const c = repo.addSite(org, 'Site C'); repo.addSite(org, 'Site D');
  const kitchen = repo.addTeam(org, 'Kitchen', a); const foh = repo.addTeam(org, 'Front of house', a); const bar = repo.addTeam(org, 'Bar', a);
  const compliance = repo.addTeam(org, 'Compliance');
  const ids = { owner: crypto.randomUUID(), hq: crypto.randomUUID(), mgr: crypto.randomUUID(), staff: crypto.randomUUID() };
  repo.addMember(org, 'owner@example.com', 'owner', null, ids.owner).display_name = 'Olivia Owner';
  repo.addMember(org, 'hq@example.com', 'hq_admin', null, ids.hq).display_name = 'Harper HQ';
  const mgr = repo.addMember(org, 'alex@example.com', 'site_manager', a, ids.mgr); mgr.display_name = 'Alex M.';
  const jordan = repo.addMember(org, 'jordan@example.com', 'staff', a, ids.staff); jordan.display_name = 'Jordan P.';
  const sam = repo.addMember(org, 'sam@example.com', 'staff', a, crypto.randomUUID()); sam.display_name = 'Sam R.';
  const casey = repo.addMember(org, 'casey@example.com', 'staff', a, null, 'invited'); casey.display_name = 'Casey T.';
  repo.addMember(org, 'bea@example.com', 'site_manager', b, crypto.randomUUID()).display_name = 'Bea K.';
  repo.addMember(org, 'cal@example.com', 'staff', c, crypto.randomUUID()).display_name = 'Cal D.';
  await repo.setMemberTeams(mgr.id, [kitchen.id]); await repo.setMemberTeams(jordan.id, [foh.id]);
  await repo.setMemberTeams(sam.id, [bar.id]); await repo.setMemberTeams(casey.id, [kitchen.id]);
  await repo.setMemberTeams(ids.hq ? repo.members.find((m) => m.user_id === ids.hq)!.id : '', [compliance.id]);

  const users: Record<string, { userId: string; email: string }> = {
    'dev-owner': { userId: ids.owner, email: 'owner@example.com' }, 'dev-hq': { userId: ids.hq, email: 'hq@example.com' },
    'dev-mgr': { userId: ids.mgr, email: 'alex@example.com' }, 'dev-staff': { userId: ids.staff, email: 'jordan@example.com' },
  };
  const mailer = new FakeMailer();
  // Sample billing: the group starts with no plan (try "Start free trial"). BILLING_DEMO=trial|lapsed pre-sets a state.
  const bc = testBillingConfig();
  const env: Record<string, string> = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'dev-anon-key', LOG_LEVEL: 'warn',
    STRIPE_SECRET_KEY: 'sk_test_dev', STRIPE_WEBHOOK_SECRET: 'whsec_dev' };
  for (const [k, v] of Object.entries(bc.prices)) { env[`STRIPE_PRICE_${k.toUpperCase()}_MONTHLY`] = v.month; env[`STRIPE_PRICE_${k.toUpperCase()}_ANNUAL`] = v.year; }
  const config = loadConfig(env);
  const store = new FakeBillingStore(); const stripe = new FakeStripe(bc);
  store.listSites = async (orgId) => repo.sites.filter((s) => s.org_id === orgId).map((s) => ({ id: s.id, org_id: s.org_id, name: s.name, billing_tier: s.id === c.id ? 'large' : 'standard', active: true }));
  store.getSite = async (id) => (await store.listSites(org.id)).find((x) => x.id === id) ?? null;
  store.updateSite = async (id, patch) => { const x = repo.sites.find((q) => q.id === id)!; void patch; return { id, org_id: x.org_id, name: x.name, billing_tier: patch.billing_tier ?? 'standard', active: patch.active ?? true }; };
  store.countActiveStaff = async () => ({ [a.id]: 41, [b.id]: 28, [c.id]: 96 });
  store.listUsage = async () => [{ site_id: a.id, ai_questions: 1480, flagged_at: null }, { site_id: b.id, ai_questions: 2210, flagged_at: new Date().toISOString() }];
  if (process.env.BILLING_DEMO) {
    await store.saveAccount(org.id, { stripe_customer_id: 'cus_demo', stripe_subscription_id: 'sub_demo', has_payment_method: process.env.BILLING_DEMO === 'lapsed',
      status: process.env.BILLING_DEMO === 'lapsed' ? 'past_due' : 'trialing', interval: 'month',
      trial_ends_at: new Date(Date.now() + 11 * 86_400_000).toISOString(), past_due_since: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  }
  const app = await buildApp(config, { repo, mailer, stripe, billingStore: store, devMode: true, verifyToken: async (t) => users[t] ?? null });
  const port = Number(process.env.PORT ?? 4300);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Manage preview: http://127.0.0.1:${port}/manage/  (sample data, dev sign-in)`);
}
void main();
