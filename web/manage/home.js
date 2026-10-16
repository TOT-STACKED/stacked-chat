import { clear, h } from './dom.js';
import { formatGbp, planName } from './lib.js';
import { pageHeader, tile } from './ui.js';

/** Home: a quick read on the company and what to do next. */
export async function renderHome(main, ctx) {
  const { api, orgId, orgName, isManager, isAdmin, email } = ctx;
  const first = (email || '').split('@')[0].split(/[._-]/)[0];
  const hello = first ? `Welcome back, ${first[0].toUpperCase()}${first.slice(1)}` : 'Welcome back';
  const draw = (data) => {
    clear(main);
    main.append(pageHeader({ icon: 'home', title: 'Home', sub: `${hello}. Here is where ${orgName} stands.` }));
    if (!isManager) {
      main.append(h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text: 'You are set up as a team member' }),
        h('p', { text: 'Staff use the Stacked Chat app to ask questions and read handbooks. Managers use this area to look after people and settings.' })));
      return;
    }
    if (!data) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
    const { sites, members, billing } = data;
    const live = members.filter((m) => m.status !== 'disabled');
    const invited = live.filter((m) => m.status === 'invited').length;
    const stat = (icon, label, value, sub, href) => h('a', { class: 'card pad stat', href, style: 'text-decoration:none' }, tile(icon, 44),
      h('div', { class: 'sb' }, h('span', { class: 'lbl', text: label }), h('span', { class: 'big', text: value }), sub ? h('span', { class: 'sub2', text: sub }) : null));
    const cards = [
      stat('people', 'People', String(live.length), invited ? `${invited} invited, not signed in yet` : 'All signed in', '#/people'),
      stat('operations', 'Venues', String(sites.length), sites.length === 1 ? '1 site' : `${sites.length} sites`, '#/people'),
    ];
    if (isAdmin && billing) {
      const st = billing.state;
      const value = !billing.account ? 'Not started' : st.mode === 'full' && billing.account.status === 'trialing' ? `${st.trial_days_left} days left` : billing.account.status === 'active' ? 'Active' : st.mode === 'grace' ? 'Payment due' : 'Needs attention';
      cards.push(stat('billing', 'Billing', value, billing.account ? `${planName(billing.pricing)}, ${formatGbp(billing.pricing.total_pence)} / ${billing.account.interval}` : 'Start your free trial', '#/settings/billing'));
    }
    main.append(h('div', { class: 'grid3' }, cards));

    const step = (done, title, text, href, cta) => h('div', { class: `step ${done ? 'done' : ''}` },
      h('span', { class: 'check', 'aria-hidden': 'true', text: done ? '✓' : '' }), h('div', { class: 'sb' }, h('b', { text: title }), h('span', { class: 'muted', text })),
      done ? null : h('a', { class: 'btn line small', href, text: cta }));
    const steps = [
      step(sites.length > 0, 'Add your venues', 'Each venue is one site, with its own people and teams.', '#/people', 'Add a venue'),
      step(live.length > 1, 'Invite your team', 'People get an email with a one-time code. No passwords.', '#/people', 'Invite people'),
    ];
    if (isAdmin && billing) steps.push(step(!!billing.account, 'Start your free trial', '30 days free, no card needed. One price per venue, unlimited staff.', '#/settings/billing', 'Start trial'));
    steps.push(step(false, 'Add your handbooks', 'Upload policies and training so the AI can answer from them.', '#/knowledge', 'Coming soon'));
    main.append(h('div', { class: 'stack' }, h('h2', { text: 'Get set up' }), h('div', { class: 'card steps' }, steps)));
  };

  draw(null);
  if (!isManager) { draw(null); return; }
  try {
    const [s, m, b] = await Promise.all([
      api.get(`/api/v1/orgs/${orgId}/sites`), api.get(`/api/v1/orgs/${orgId}/members`),
      isAdmin ? api.get(`/api/v1/orgs/${orgId}/billing/summary`).catch(() => null) : Promise.resolve(null),
    ]);
    draw({ sites: s.data, members: m.data, billing: b });
  } catch (e) { clear(main); main.append(pageHeader({ icon: 'home', title: 'Home' }), h('div', { class: 'banner', role: 'alert', text: e.message })); }
}
