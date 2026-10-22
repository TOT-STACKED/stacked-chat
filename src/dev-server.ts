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
import { FakeSensitiveStore } from './testing/sensitive-fakes.js';
import { FakeOpsStore } from './testing/ops-fakes.js';
import { createOps } from './modules/operations/service.js';
import { FakeConsoleStore } from './testing/console-fakes.js';
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
    STRIPE_SECRET_KEY: 'sk_test_dev', STRIPE_WEBHOOK_SECRET: 'whsec_dev', STACKED_STAFF_EMAILS: 'owner@example.com' };
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
  const opsStore = new FakeOpsStore();
  for (const x of repo.sites) opsStore.addSite(org.id, x.id);
  const opsSample = createOps({ store: opsStore });
  const opening = await opsSample.create(org.id, { title: 'Opening checklist', kind: 'opening', site_id: null, items: ['Unlock the front door and turn off the alarm', 'Switch on the ovens and extraction', 'Check fridge and freezer temperatures', 'Count the till float', 'Set the specials board'], by: 'owner@example.com' });
  await opsSample.create(org.id, { title: 'Closing checklist', kind: 'closing', site_id: a.id, items: ['Clean down the kitchen', 'Cash up', 'Lock the cellar', 'Set the alarm'], by: 'alex@example.com' });
  for (const it of opening.items.slice(0, 2)) await opsSample.tick({ orgId: org.id, siteId: a.id, email: 'jordan@example.com' }, opening.id, it.id, true);
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
  // Console sample data: this sample company plus a few others, so the staff views have something to show
  const cstore = new FakeConsoleStore();
  const day = 86_400_000; const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
  const OB = crypto.randomUUID(), OH = crypto.randomUUID(), OC = crypto.randomUUID();
  cstore.orgRows = [{ id: org.id, name: org.name, slug: 'sample', created_at: ago(70) },
    { id: OB, name: 'Bistro Group', slug: 'bistro', created_at: ago(25) }, { id: OH, name: 'Harbour Hotels', slug: 'harbour', created_at: ago(12) }, { id: OC, name: 'Cafe Solo', slug: 'cafe', created_at: ago(4) }];
  cstore.siteRows = repo.sites.map((x) => ({ id: x.id, org_id: org.id, name: x.name, created_at: ago(60), billing_tier: x.id === c.id ? 'large' as const : 'standard' as const, active: true }));
  const extraSite = (orgId: string, name: string, tier: 'standard' | 'large' = 'standard') => { const id = crypto.randomUUID(); cstore.siteRows.push({ id, org_id: orgId, name, created_at: ago(10), billing_tier: tier, active: true }); return id; };
  const bis = ['One', 'Two', 'Three'].map((n) => extraSite(OB, 'Bistro ' + n)); const har = extraSite(OH, 'Harbour Hotel', 'large'); const caf = extraSite(OC, 'Cafe Solo');
  cstore.memberRows = repo.members.map((m) => ({ org_id: org.id, site_id: m.site_id, email: m.email, display_name: m.display_name, role: m.role, status: m.status }));
  for (const [o, e, r] of [[OB, 'bea@bistro.co.uk', 'owner'], [OH, 'gm@harbour.co.uk', 'owner'], [OC, 'sam@cafesolo.co', 'owner']] as Array<[string, string, string]>) cstore.memberRows.push({ org_id: o, site_id: null, email: e, display_name: null, role: r, status: 'active' });
  cstore.usageRows = [{ site_id: bis[0]!, ai_questions: 2350, flagged_at: ago(2) }];
  // customers added in the preview show up in the Console list too
  const baseOrgs = cstore.orgs.bind(cstore); const baseSites = cstore.sites.bind(cstore); const baseMembers = cstore.members.bind(cstore);
  cstore.orgs = async () => { const have = await baseOrgs(); return [...have, ...repo.orgs.filter((o) => !have.some((h) => h.id === o.id)).map((o) => ({ id: o.id, name: o.name, slug: o.slug, created_at: new Date().toISOString() }))]; };
  cstore.sites = async () => { const have = await baseSites(); return [...have, ...repo.sites.filter((x) => !have.some((h) => h.id === x.id)).map((x) => ({ id: x.id, org_id: x.org_id, name: x.name, created_at: x.created_at, billing_tier: 'standard' as const, active: true }))]; };
  cstore.members = async () => { const have = await baseMembers(); return [...have, ...repo.members.filter((m) => !have.some((h) => h.email === m.email && h.org_id === m.org_id)).map((m) => ({ org_id: m.org_id, site_id: m.site_id, email: m.email, display_name: m.display_name, role: m.role, status: m.status }))]; };
  cstore.convRows = [...istore.convs];
  const cq = (site: string, email: string, q: string, answered = true) => cstore.convRows.push({ id: 1000 + cstore.convRows.length, venue_id: site, email, created_at: ago(Math.random() * 20), messages: [{ role: 'user', content: q }, { role: 'assistant', content: answered ? 'Try restarting it.' : IDK }] });
  for (let i = 0; i < 6; i++) cq(bis[i % 3]!, 'ops@bistro.co.uk', 'our dojo card machine keeps declining payments');
  for (let i = 0; i < 4; i++) cq(bis[0]!, 'ops@bistro.co.uk', 'deputy rota not syncing for new starters');
  for (let i = 0; i < 3; i++) cq(har, 'fd@harbour.co.uk', 'mews check in screen frozen', false);
  for (let i = 0; i < 2; i++) cq(har, 'fd@harbour.co.uk', 'Do we get paid for training days?', false);
  for (let i = 0; i < 3; i++) cq(caf, 'sam@cafesolo.co', 'square reader will not connect offline');
  cstore.npsRows = [...[9, 10, 8, 9, 6].map((score) => ({ vendor: 'dojo', score, comment: null, created_at: ago(3) })), ...[4, 6, 9].map((score) => ({ vendor: 'deputy', score, comment: null, created_at: ago(5) })), { vendor: 'square', score: 10, comment: null, created_at: ago(1) }];
  await store.saveAccount(OB, { stripe_customer_id: 'cus_b', stripe_subscription_id: 'sub_b', status: 'active', interval: 'month', has_payment_method: true });
  await store.saveAccount(OH, { stripe_customer_id: 'cus_h', stripe_subscription_id: 'sub_h', status: 'trialing', interval: 'year', has_payment_method: false, trial_ends_at: new Date(Date.now() + 3 * day).toISOString() });
  const drafter = { draft: async (q: string) => `Staff are paid for training days at [CONFIRM: rate]. Training is rostered like a normal shift. (Draft for: ${q})` };
  const app = await buildApp(config, { repo, mailer, stripe, billingStore: store, knowledgeStore: kstore, insightsStore: istore, brandingStore: new FakeBrandingStore(() => repo.sites), sensitiveStore: new FakeSensitiveStore(), opsStore, conversationStore: new FakeConversationStore(), consoleStore: cstore, chatModel: previewChatModel, mirrorNps: null,
    npsStore: { save: async (r) => { console.log('[preview] rating saved', JSON.stringify(r)); } },
    techStackStore: (() => { const stacks = new Map<string, Record<string, string>>([[a.id, { epos: 'Lightspeed', payments: 'Dojo' }]]); return { get: async (id: string) => stacks.get(id) ?? {}, list: async () => repo.sites.map((x) => ({ id: x.id, name: x.name, stack: stacks.get(x.id) ?? {} })), set: async (id: string, st: Record<string, string>) => { stacks.set(id, st); return st; } }; })(), drafter, devMode: true, verifyToken: async (t) => users[t] ?? null });
  const port = Number(process.env.PORT ?? 4300);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Manage preview: http://127.0.0.1:${port}/manage/  (sample data, dev sign-in)`);
}
void main();
