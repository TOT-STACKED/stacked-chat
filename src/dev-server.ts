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
import { FakeKnowledgeStore } from './testing/knowledge-fakes.js';
import { FakeInsightsStore } from './testing/insights-fakes.js';
import { FakeBrandingStore } from './testing/branding-fakes.js';
import { FakeConversationStore, previewChatModel } from './testing/chat-fakes.js';

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
  const kstore = new FakeKnowledgeStore();
  kstore.addOrg(org.id, 'sample', 'sample');
  for (const x of repo.sites) kstore.sites.push({ id: x.id, org_id: org.id });
  for (const t of repo.teams) kstore.teamRows.push({ id: t.id, org_id: org.id, name: t.name, site_id: t.site_id });
  kstore.addLegacyDoc('sample', 'Allergen policy.pdf', 'All 14 allergens must be declared. Check the allergen matrix before every service and brief every new starter on day one.');
  kstore.addLegacyDoc('sample', 'Fire safety and evacuation', 'If the alarm sounds, stop service, switch off gas, and lead guests to the assembly point at the car park.');
  kstore.addLegacyVideo('sample', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'How to void a payment on the till');
  kstore.addLegacyImage('sample', 'https://example.com/burger.png', 'Signature burger plating');
  const kb = (await import('./modules/knowledge/service.js')).createKnowledge({ store: kstore });
  await kb.createDocument(org.id, { title: 'Opening checklist', body: 'Unlock, lights, fridge temperatures, till float, specials board.', site_id: a.id, status: 'published', by: 'alex@example.com' });
  await kb.createDocument(org.id, { title: 'New staff meal policy (draft)', body: 'Staff meals are £3.50 per shift. Still to confirm with finance.', site_id: null, status: 'draft', by: 'hq@example.com' });
  const istore = new FakeInsightsStore();
  for (const x of repo.sites) istore.siteList.push({ id: x.id, org_id: org.id, name: x.name });
  istore.members.push({ org_id: org.id, email: 'alex@example.com', teams: ['Kitchen'] }, { org_id: org.id, email: 'jordan@example.com', teams: ['Front of house'] }, { org_id: org.id, email: 'sam@example.com', teams: ['Bar'] });
  const IDK = "I don't have that in my knowledge base yet.";
  const ask = (site: { id: string }, email: string, q: string, answered = true, daysAgo = 1) =>
    istore.addConversation(site.id, email, [[q, answered ? 'Here is how that works.' : IDK]], new Date(Date.now() - daysAgo * 86_400_000));
  for (let i = 0; i < 8; i++) ask(a, 'alex@example.com', 'How do I report an allergen incident?', true, i % 6);
  for (let i = 0; i < 6; i++) ask(b, 'jordan@example.com', 'Can I swap a shift?', true, i % 5);
  for (let i = 0; i < 5; i++) ask(a, 'jordan@example.com', 'can i swap shifts', true, i % 5);
  for (let i = 0; i < 4; i++) ask(a, 'sam@example.com', 'Where is the fire assembly point?', true, i);
  for (let i = 0; i < 6; i++) ask(i % 2 ? a : b, 'sam@example.com', 'Do we get paid for training days?', false, i);
  for (let i = 0; i < 5; i++) ask(a, 'alex@example.com', 'Is there a staff meal policy?', false, i);
  for (let i = 0; i < 4; i++) ask(c, 'alex@example.com', 'How do I log a broken fridge?', false, i);
  for (let i = 0; i < 3; i++) ask(a, 'someone@example.com', 'What time does the bar close on Sundays?', true, i);
  const drafter = { draft: async (q: string) => `Staff are paid for training days at [CONFIRM: rate]. Training is rostered like a normal shift. (Draft for: ${q})` };
  const app = await buildApp(config, { repo, mailer, stripe, billingStore: store, knowledgeStore: kstore, insightsStore: istore, brandingStore: new FakeBrandingStore(() => repo.sites), conversationStore: new FakeConversationStore(), chatModel: previewChatModel, mirrorNps: null,
    npsStore: { save: async (r) => { console.log('[preview] rating saved', JSON.stringify(r)); } },
    techStackStore: (() => { const stacks = new Map<string, Record<string, string>>([[a.id, { epos: 'Lightspeed', payments: 'Dojo' }]]); return { get: async (id: string) => stacks.get(id) ?? {}, list: async () => repo.sites.map((x) => ({ id: x.id, name: x.name, stack: stacks.get(x.id) ?? {} })), set: async (id: string, st: Record<string, string>) => { stacks.set(id, st); return st; } }; })(), drafter, devMode: true, verifyToken: async (t) => users[t] ?? null });
  const port = Number(process.env.PORT ?? 4300);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Manage preview: http://127.0.0.1:${port}/manage/  (sample data, dev sign-in)`);
}
void main();
