import { clear, h } from './dom.js';
import { formatGbp, homeAttention, planName } from './lib.js';
import { pageHeader, tile } from './ui.js';

const greeting = (email) => {
  const first = /@phone\.invalid$/i.test(email || '') ? '' : (email || '').split('@')[0].split(/[._-]/)[0];
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date()));
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return first ? `${part}, ${first[0].toUpperCase()}${first.slice(1)}` : part;
};
const section = (id, title, ...kids) => h('section', { class: 'stack', 'aria-labelledby': id }, h('h2', { id, text: title }), ...kids);

/** Home: what needs you today, the things you do most, and where the company stands. */
export async function renderHome(main, ctx) {
  const { api, orgId, orgName, isManager, isAdmin, email, onHelp } = ctx;
  const sub = `Here is how ${orgName} is doing today.`;

  if (!isManager) {
    main.append(pageHeader({ icon: 'home', title: greeting(email), sub: `You are part of ${orgName}.` }),
      h('div', { class: 'card empty-state' }, tile('communicate', 56), h('b', { text: 'Your team’s answers, checklists and updates are in Stacked Chat' }),
        h('p', { text: 'Open it on your phone or here. Managers use this area to look after people, knowledge and settings.' }),
        h('a', { class: 'btn cta', href: '/chat/', text: 'Open Stacked Chat' })));
    return;
  }

  const draw = (data) => {
    clear(main);
    main.append(pageHeader({ icon: 'home', title: greeting(email), sub }));
    if (!data) { main.append(h('p', { class: 'muted', role: 'status', text: 'Loading…' })); return; }
    const { sites, members, billing, knowledge } = data;

    // 1. what needs doing
    const items = homeAttention(data);
    main.append(section('h-attn', 'Needs your attention', items.length
      ? h('div', null, h('ul', { class: 'attn', id: 'attn-list' }, items.map((i, n) => h('li', { class: `card attnitem ${i.tone} ${n >= 3 ? 'more' : ''}` }, tile(i.icon, 40),
        h('div', { class: 'sb' }, h('b', { text: i.title }), h('span', { class: 'muted', text: i.sub })), h('a', { class: 'btn line small', href: i.href, 'aria-label': `${i.cta}: ${i.title}`, text: i.cta })))),
        // on a phone only the first three show, so the page does not become a wall of cards
        items.length > 3 ? h('button', { class: 'lnk showmore', 'aria-expanded': 'false', 'aria-controls': 'attn-list', onclick: (e) => { const l = document.getElementById('attn-list'); const open = l.classList.toggle('all'); e.target.setAttribute('aria-expanded', String(open)); e.target.textContent = open ? 'Show fewer' : `Show ${items.length - 3} more`; } }, `Show ${items.length - 3} more`) : null)
      : h('div', { class: 'card pad allclear' }, h('span', { class: 'check', 'aria-hidden': 'true', text: '✓' }), h('div', { class: 'sb' }, h('b', { text: 'All clear' }), h('span', { class: 'muted', text: 'Nothing needs you right now.' })))));

    // 2. the things managers do most
    const go = (href, label, text, icon) => h('a', { class: 'card qacard', href }, tile(icon, 40), h('b', { text: label }), h('span', { class: 'muted', text }));
    main.append(section('h-do', 'Do something',
      h('div', { class: 'qa' },
        go('#/communicate', 'Send an update', 'Tell a venue, a team or everyone', 'communicate'),
        go('#/operations', 'Write a checklist', 'Opening, closing, anything', 'operations'),
        go('#/knowledge', 'Add knowledge', 'A document, a video or a photo', 'knowledge'),
        go('#/training', 'Create a course', 'Lessons and a quick quiz', 'training'),
        go('#/people', 'Add people', 'By mobile number, no email needed', 'people'),
        h('button', { class: 'card qacard', type: 'button', onclick: () => onHelp && onHelp() }, tile('settings', 40), h('b', { text: 'Get help' }), h('span', { class: 'muted', text: 'Message the Stacked team' })))));

    // 3. at a glance
    const live = members.filter((m) => m.status !== 'disabled'); const invited = live.filter((m) => m.status === 'invited').length;
    const stat = (icon, label, value, subtext, href) => h('a', { class: 'card pad stat', href, style: 'text-decoration:none' }, tile(icon, 44),
      h('div', { class: 'sb' }, h('span', { class: 'lbl', text: label }), h('span', { class: 'big', text: value }), subtext ? h('span', { class: 'sub2', text: subtext }) : null));
    const cards = [
      stat('people', 'People', String(live.length), invited ? `${invited} invited, not signed in yet` : 'All signed in', '#/people'),
      stat('operations', 'Venues', String(sites.length), sites.length === 1 ? '1 site' : `${sites.length} sites`, '#/people'),
      stat('knowledge', 'Knowledge', String(knowledge.filter((k) => k.status === 'published').length), `${knowledge.filter((k) => k.status === 'draft').length} drafts`, '#/knowledge'),
    ];
    if (isAdmin && billing) {
      const st = billing.state;
      const value = !billing.account ? 'Not started' : st.mode === 'full' && billing.account.status === 'trialing' ? `${st.trial_days_left} days left` : billing.account.status === 'active' ? 'Active' : st.mode === 'grace' ? 'Payment due' : 'Needs attention';
      cards.push(stat('billing', 'Billing', value, billing.account ? `${planName(billing.pricing)}, ${formatGbp(billing.pricing.total_pence)} / ${billing.account.interval}` : 'Start your free trial', '#/settings/billing'));
    }
    main.append(section('h-glance', 'At a glance', h('div', { class: 'glance' }, cards)));

    // 4. setting up: only until it is done
    const step = (done, title, text, href, cta) => h('li', { class: `step ${done ? 'done' : ''}` },
      h('span', { class: 'check', 'aria-hidden': 'true', text: done ? '✓' : '' }), h('div', { class: 'sb' }, h('b', { text: title }), done ? h('span', { class: 'sr', text: ' (done)' }) : null, h('span', { class: 'muted', text })),
      done ? null : h('a', { class: 'btn line small', href, text: cta }));
    const steps = [
      step(sites.length > 0, 'Add your venues', 'Each venue is one site, with its own people and teams.', '#/people', 'Add a venue'),
      step(live.length > 1, 'Add your team', 'Add their mobile numbers. They sign in with a texted code: no passwords, and no email needed.', '#/people', 'Add people'),
    ];
    if (isAdmin && billing) steps.push(step(!!billing.account, 'Start your free trial', '30 days free, no card needed. One price per venue, unlimited staff.', '#/settings/billing', 'Start trial'));
    steps.push(step(knowledge.length > 0, 'Add your knowledge', 'Write down policies and how-tos, or add videos, so the AI can answer from them.', '#/knowledge', 'Add knowledge'));
    const left = steps.filter((s) => !s.classList.contains('done')).length;
    if (left) main.append(section('h-setup', `Get set up (${steps.length - left} of ${steps.length} done)`, h('ul', { class: 'card steps', style: 'list-style:none;margin:0;padding:0' }, steps)));
  };

  draw(null);
  const get = (path, fallback) => api.get(path).catch(() => fallback);
  try {
    const [s, m, b, k, board, ups, tr, ins] = await Promise.all([
      api.get(`/api/v1/orgs/${orgId}/sites`), api.get(`/api/v1/orgs/${orgId}/members`),
      isAdmin ? get(`/api/v1/orgs/${orgId}/billing/summary`, null) : Promise.resolve(null),
      get(`/api/v1/orgs/${orgId}/knowledge`, { data: [] }),
      get(`/api/v1/orgs/${orgId}/checklists/board?days=1`, { sites: [], today: [], recent: [] }),
      get(`/api/v1/orgs/${orgId}/announcements`, { data: [] }),
      get(`/api/v1/orgs/${orgId}/training`, { data: [] }),
      get(`/api/v1/orgs/${orgId}/insights?days=30`, { unanswered: [] }),
    ]);
    const names = new Map((board.sites || []).map((x) => [x.id, x.name]));
    draw({ sites: s.data, members: m.data, billing: b, knowledge: k.data, board: board.today.map((t) => ({ ...t, siteName: (board.sites || []).length > 1 ? names.get(t.site_id) : null })), updates: ups.data, courses: tr.data, insights: ins });
  } catch (e) { clear(main); main.append(pageHeader({ icon: 'home', title: 'Home' }), h('div', { class: 'banner', role: 'alert', text: e.message })); }
}
