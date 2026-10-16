import { clear, h, modal, toast } from '/manage/dom.js';
import { createAuth } from '/manage/auth.js';
import { createApi } from '/manage/api.js';
import { avatar, logo, pageHeader, tile } from '/manage/ui.js';
import { asksText, barPercent, formatGbp, shortDate } from '/manage/lib.js';
import { labelTables } from '/manage/responsive.js';

const root = document.getElementById('app');
labelTables(root);
let cfg; let auth; let api; let main; let crumb;
const st = { days: 30, email: '' };

const NAV = [['overview', 'Overview', 'insights'], ['customers', 'Customers', 'people'], ['vendors', 'Vendors', 'operations'], ['gaps', 'Gaps', 'knowledge']];
/** append to the page, skipping anything empty (null would print as the word "null") */
const put = (...nodes) => main.append(...nodes.filter(Boolean));
const STATUS = { trialing: 'Trial', active: 'Active', past_due: 'Past due', paused: 'Paused', canceled: 'Cancelled' };
const statusChip = (b) => h('span', { class: `statuschip ${b.status || ''}`, text: b.status ? STATUS[b.status] : 'Not billed' });
const flags = (list) => h('div', { class: 'flagrow' }, list.length ? list.map((f) => h('span', { class: 'flag', text: f })) : [h('span', { class: 'flag ok', text: 'All good' })]);

// ---- sign in ----------------------------------------------------------------------------------------------------
function showSignIn(note) {
  clear(root); let email = '';
  const box = h('div', { class: 'box' }); root.append(h('div', { class: 'signin' }, box));
  const emailStep = () => {
    clear(box);
    const input = h('input', { type: 'email', id: 'em', autocomplete: 'email', placeholder: 'you@wearestacked.io', value: email }); const err = h('div'); const go = h('button', { class: 'btn cta', onclick: submit }, 'Email me a code');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      email = input.value.trim().toLowerCase(); clear(err);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Enter a valid email address.' })); return; }
      go.disabled = true; go.textContent = 'Sending…';
      try { await auth.sendCode(email); codeStep(); } catch (e) { go.disabled = false; go.textContent = 'Email me a code'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    box.append(logo(), h('h1', { text: 'Stacked Console' }), note ? h('div', { class: 'banner', text: note }) : null, h('p', { class: 'muted', text: 'For Stacked staff only. Sign in with your work email and we will send you a one-time code.' }),
      h('div', { class: 'field' }, h('label', { for: 'em', text: 'Email address' }), input), err, go,
      cfg.dev ? h('div', { class: 'devbox' }, h('span', { class: 'mono', text: 'Local preview: sign in as' }), h('div', { class: 'chips' }, [['owner', 'Staff (owner@example.com)'], ['mgr', 'A customer']].map(([r, l]) => h('button', { class: 'pill', onclick: async () => { auth.devSignIn(r); await enter(); } }, l)))) : null);
    input.focus();
  };
  const codeStep = () => {
    clear(box);
    const input = h('input', { type: 'text', id: 'cd', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456' }); const err = h('div'); const go = h('button', { class: 'btn cta', onclick: submit }, 'Sign in');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      clear(err); const code = input.value.replace(/\s+/g, '');
      if (code.length < 6) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Enter the code from your email.' })); return; }
      go.disabled = true; go.textContent = 'Checking…';
      try { await auth.verifyCode(email, code); await enter(); } catch (e) { go.disabled = false; go.textContent = 'Sign in'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    box.append(logo(), h('h1', { text: 'Check your email' }), h('p', { class: 'muted', text: `We sent a code to ${email}.` }), h('div', { class: 'field' }, h('label', { for: 'cd', text: 'Code' }), input), err, go, h('button', { class: 'lnk', onclick: emailStep }, 'Use a different email'));
    input.focus();
  };
  emailStep();
}

async function enter() {
  try { const me = await api.get('/api/v1/console/me'); st.email = me.email; }
  catch (e) { if (e.status === 403) { showNotStaff(); return; } if (e.status !== 401) showSignIn('Something went wrong. Please try again.'); return; }
  drawShell(); route();
}
function showNotStaff() {
  clear(root);
  root.append(h('div', { class: 'signin' }, h('div', { class: 'box' }, logo(), h('h1', { text: 'Not authorised' }), h('p', { class: 'muted', text: `${auth.email()} isn't on the Stacked staff list. If you should have access, ask for your email to be added.` }), h('button', { class: 'btn line', onclick: signOut }, 'Sign out'))));
}
function signOut() { auth.signOut(); showSignIn(); }

function drawShell() {
  clear(root); main = h('main', { class: 'main', id: 'main' }); crumb = h('span', { class: 'crumbs' });
  root.append(h('div', { class: 'shell' },
    h('aside', { class: 'side staff' }, h('div', { style: 'display:flex;align-items:center' }, logo(), h('span', { class: 'stafftag', text: 'Console' })),
      h('nav', { class: 'nav', 'aria-label': 'Console' }, h('span', { class: 'navlabel', text: 'Stacked staff' }), NAV.map(([k, label, icon]) => h('a', { href: '#/' + k, id: 'nav-' + k }, tile(icon, 28), label))), h('div', { class: 'grow' }), h('button', { class: 'btn line small mobsignout', onclick: signOut }, 'Sign out')),
    h('div', { class: 'content' }, h('header', { class: 'top' }, crumb, h('div', { class: 'userbox' }, h('div', { class: 'who' }, h('b', { text: st.email }), h('span', { text: 'Stacked staff' })), avatar(st.email), h('button', { class: 'btn line small', onclick: signOut }, 'Sign out'))), main)));
}

const periodPills = (rerender) => h('div', { class: 'chips', role: 'group', 'aria-label': 'Time period' }, [[7, '7 days'], [30, '30 days'], [90, '90 days']].map(([d, label]) => h('button', { class: `pill ${st.days === d ? 'on' : ''}`, onclick: () => { st.days = d; rerender(); } }, label)));
const loading = () => h('p', { class: 'muted', text: 'Loading…' });
const failure = (e, retry) => h('div', { class: 'banner', role: 'alert' }, (e.message || 'Something went wrong') + ' ', h('button', { class: 'lnk', onclick: retry }, 'Try again'));

// ---- views ------------------------------------------------------------------------------------------------------
async function overview() {
  clear(main); put(pageHeader({ icon: 'insights', title: 'Overview', sub: 'Customers, billing health and usage across Stacked Chat.', actions: periodPills(overview) }), loading());
  let d; try { d = await api.get(`/api/v1/console/overview?days=${st.days}`); } catch (e) { clear(main); put(pageHeader({ icon: 'insights', title: 'Overview' }), failure(e, overview)); return; }
  const kpi = (label, value, sub) => h('div', { class: 'card kpi' }, h('span', { class: 'l', text: label }), h('span', { class: 'v', text: value }), sub ? h('span', { class: 's', text: sub }) : null);
  const b = d.billing; const rate = d.usage.questions ? Math.round(((d.usage.questions - d.usage.unanswered) / d.usage.questions) * 100) + '%' : 'None yet';
  clear(main);
  put(pageHeader({ icon: 'insights', title: 'Overview', sub: 'Customers, billing health and usage across Stacked Chat.', actions: periodPills(overview) }),
    h('div', { class: 'kpis' },
      kpi('Customers', String(d.customers), `${d.venues} venues, ${d.people} people`),
      kpi('Monthly revenue', formatGbp(b.mrr_pence), `${b.by_status.active} paying, excl. VAT`),
      kpi('Trial pipeline', formatGbp(b.trial_pipeline_pence), `${b.by_status.trialing} on trial, per month`),
      kpi('Questions', d.usage.questions.toLocaleString('en-GB'), `last ${d.days} days, ${d.usage.active_customers} active customers`),
      kpi('Answered', rate, `${d.usage.unanswered} unanswered`)),
    h('div', { class: 'chips', 'aria-label': 'Billing status' }, Object.entries(b.by_status).filter(([, n]) => n).map(([k, n]) => h('span', { class: `statuschip ${k}`, text: `${n} ${k === 'unmanaged' ? 'not billed' : STATUS[k].toLowerCase()}` }))),
    h('div', { class: 'cols' },
      h('section', { class: 'stack qcol' }, h('h2', { text: 'Needs attention' }), h('div', { class: 'card' }, d.attention.length ? d.attention.map((a) => h('div', { class: 'qrow' }, h('a', { class: 'lnk', href: `#/customers/${a.id}`, text: a.name }), flags(a.flags))) : h('p', { class: 'empty', text: 'Nothing needs attention.' }))),
      h('section', { class: 'stack qcol' }, h('h2', { text: 'Growth' }), h('div', { class: 'card pad miniBars' }, (() => { const max = Math.max(1, ...d.growth.map((g) => g.customers + g.venues)); return d.growth.map((g) => h('div', { class: 'barrow' }, h('span', { class: 'bl', style: 'width:70px', text: g.month }), h('div', { class: 'bar', role: 'img', 'aria-label': `${g.month}: ${g.customers} customers, ${g.venues} venues` }, h('div', { style: `width:${barPercent(g.customers + g.venues, max)}%` })), h('span', { class: 'muted br', style: 'width:130px', text: `${g.customers} new, ${g.venues} venues` }))); })()))),
    d.usage.truncated ? h('p', { class: 'muted', style: 'font-size:13px', text: 'Usage figures cover the most recent 5,000 conversations in this period.' }) : null);
}

let custFilter = { q: '', flagged: false };
async function customers() {
  clear(main); put(pageHeader({ icon: 'people', title: 'Customers', sub: 'Every company on Stacked Chat.', actions: periodPills(customers) }), loading());
  let d; try { d = await api.get(`/api/v1/console/customers?days=${st.days}`); } catch (e) { clear(main); put(pageHeader({ icon: 'people', title: 'Customers' }), failure(e, customers)); return; }
  clear(main);
  const body = h('div', { class: 'card scroll' });
  const search = h('input', { class: 'filter search', type: 'search', placeholder: 'Search customers', 'aria-label': 'Search', value: custFilter.q });
  const only = h('button', { class: `pill ${custFilter.flagged ? 'on' : ''}`, onclick: () => { custFilter.flagged = !custFilter.flagged; only.classList.toggle('on', custFilter.flagged); drawRows(); } }, 'Needs attention');
  search.addEventListener('input', () => { custFilter.q = search.value; drawRows(); });
  put(pageHeader({ icon: 'people', title: 'Customers', sub: `${d.data.length} ${d.data.length === 1 ? 'company' : 'companies'}`, actions: [periodPills(customers), h('button', { class: 'btn cta', onclick: addCustomer }, 'Add customer')] }), h('div', { class: 'toolbar' }, h('div', { class: 'chips' }, only), search), body);
  function drawRows() {
    clear(body);
    const rows = d.data.filter((c) => (!custFilter.flagged || c.flags.length) && c.name.toLowerCase().includes(custFilter.q.trim().toLowerCase()));
    if (!rows.length) { body.append(h('p', { class: 'empty', text: 'No customers match.' })); return; }
    body.append(h('table', null, h('thead', null, h('tr', null, ['Customer', 'Plan', 'Per month', 'Venues', 'People', `Questions (${d.days}d)`, 'Last asked'].map((t) => h('th', { text: t })))),
      h('tbody', null, rows.map((c) => h('tr', { class: 'click', tabindex: 0, onclick: () => { location.hash = `#/customers/${c.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/customers/${c.id}`; } },
        h('td', null, h('div', { class: 'person' }, avatar(c.name, { square: true }), h('div', { class: 'pm' }, h('span', { class: 'name', text: c.name }), h('span', { class: 'email', text: `Joined ${shortDate(c.created_at)}` }), c.flags.length ? h('div', { style: 'margin-top:4px' }, flags(c.flags)) : null))),
        h('td', null, statusChip(c.billing), c.billing.status === 'trialing' && c.billing.trial_ends_at ? h('span', { class: 'email', text: `ends ${shortDate(c.billing.trial_ends_at)}` }) : null),
        h('td', { text: c.billing.status ? formatGbp(c.billing.monthly_pence) : `(${formatGbp(c.would_pay_monthly_pence)})` }),
        h('td', { text: String(c.venues) }), h('td', { text: String(c.people) }), h('td', null, c.questions ? [h('span', { text: String(c.questions) }), h('span', { class: 'email', text: `${c.unanswered} unanswered` })] : h('span', { class: 'muted', text: '–' })),
        h('td', { class: 'muted', text: c.last_question_at ? shortDate(c.last_question_at) : '–' }))))));
  }
  drawRows();
}

/** Add a customer: company, first venue and owner (who is invited by email). */
function addCustomer() {
  modal('Add a customer', (close) => {
    const field = (label, id, input, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
    const company = h('input', { type: 'text', id: 'ac-co', maxlength: 80, placeholder: 'e.g. Bistro Group' });
    const venue = h('input', { type: 'text', id: 'ac-venue', maxlength: 80, placeholder: 'Same as the company name' });
    const email = h('input', { type: 'email', id: 'ac-email', placeholder: 'owner@theircompany.com', autocomplete: 'off' });
    const name = h('input', { type: 'text', id: 'ac-name', maxlength: 60, placeholder: 'Optional' });
    const trial = h('input', { type: 'checkbox', id: 'ac-trial', checked: true });
    const err = h('div'); const key = crypto.randomUUID();
    const go = h('button', { class: 'btn cta', onclick: submit }, 'Create customer');
    async function submit() {
      clear(err);
      if (company.value.trim().length < 2) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Enter the company name.' })); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { err.append(h('div', { class: 'banner', role: 'alert', text: "Enter the owner's email address." })); return; }
      go.disabled = true; go.textContent = 'Creating…';
      try {
        const r = await api.post('/api/v1/console/customers', { company_name: company.value.trim(), venue_name: venue.value.trim() || null, owner_email: email.value.trim(), owner_name: name.value.trim() || null, start_trial: trial.checked }, { 'Idempotency-Key': key });
        close();
        const bits = [r.invite === 'sent' ? `Invitation emailed to ${email.value.trim().toLowerCase()}` : 'Created, but the invitation email was not sent. They can still sign in with that email address', r.trial === 'started' ? '30-day trial started' : r.trial === 'not_available' ? 'billing is not switched on, so no trial was started' : r.trial === 'failed' ? 'the trial could not be started, do it from their Billing page' : null].filter(Boolean);
        toast(bits.join('. ') + '.'); location.hash = `#/customers/${r.org_id}`;
      } catch (e) { go.disabled = false; go.textContent = 'Create customer'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    return h('div', { class: 'stack' },
      field('Company name', 'ac-co', company), field('First venue', 'ac-venue', venue, 'More venues can be added later in People.'),
      field("Owner's email", 'ac-email', email, 'They get an invitation and sign in with a one-time code. They become the company owner.'), field("Owner's name", 'ac-name', name),
      h('label', { class: 'radio', style: 'display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer' }, trial, h('span', null, h('b', { text: 'Start their 30-day free trial' }), h('span', { class: 'hint', text: ' No card needed. Untick to leave them unbilled for now.' }))),
      err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), go));
  });
}

async function customerDetail(id) {
  clear(main); put(loading());
  let c; try { c = await api.get(`/api/v1/console/customers/${id}?days=${st.days}`); } catch (e) { clear(main); put(h('a', { class: 'backlink', href: '#/customers', text: '← Customers' }), failure(e, () => customerDetail(id))); return; }
  clear(main);
  const stat = (label, value, sub) => h('div', { class: 'card kpi' }, h('span', { class: 'l', text: label }), h('span', { class: 'v', style: 'font-size:22px', text: value }), sub ? h('span', { class: 's', text: sub }) : null);
  const acc = c.account;
  put(h('a', { class: 'backlink', href: '#/customers', text: '← Customers' }),
    pageHeader({ icon: 'people', title: c.name, sub: `Joined ${shortDate(c.created_at)}`, actions: periodPills(() => customerDetail(id)) }), flags(c.flags),
    h('div', { class: 'kpis' }, stat('Plan', c.billing.status ? STATUS[c.billing.status] : 'Not billed yet', acc ? `${acc.interval === 'year' ? 'Yearly' : 'Monthly'}${acc.has_card ? ', card on file' : ', no card'}` : `would be ${formatGbp(c.would_pay_monthly_pence)} / month`),
      stat('Per month', c.billing.status ? formatGbp(c.billing.monthly_pence) : '–', 'excl. VAT'), stat('Venues', `${c.venues}`, c.venues_total !== c.venues ? `${c.venues_total - c.venues} switched off` : null), stat('People', String(c.people)), stat(`Questions (${c.days || st.days}d)`, String(c.questions), `${c.unanswered} unanswered`)),
    acc && acc.trial_ends_at && acc.status === 'trialing' ? h('div', { class: 'banner info', text: `Trial ends ${shortDate(acc.trial_ends_at)}.` }) : null,
    acc && acc.past_due_since ? h('div', { class: 'banner', text: `Payment first failed ${shortDate(acc.past_due_since)}.` }) : null,
    h('h2', { text: 'Venues' }), h('div', { class: 'card scroll' }, h('table', { class: 'narrow' }, h('thead', null, h('tr', null, ['Venue', 'Size', 'AI questions this month', 'Active staff', 'Questions'].map((t) => h('th', { text: t })))),
      h('tbody', null, c.sites.map((s) => h('tr', null, h('td', null, h('span', { class: 'name', text: s.name }), !s.active ? h('span', { class: 'chip dim', text: 'Off' }) : null), h('td', { text: s.billing_tier === 'large' ? 'Large' : 'Standard' }), h('td', { text: s.ai_questions_month.toLocaleString('en-GB') }), h('td', { text: String(s.active_staff) }), h('td', { text: String(s.questions) })))))),
    h('h2', { text: 'People' }), h('div', { class: 'card scroll' }, c.members.length ? h('table', null, h('thead', null, h('tr', null, ['Name', 'Role', 'Venue', 'Status'].map((t) => h('th', { text: t })))),
      h('tbody', null, c.members.map((m) => h('tr', null, h('td', null, h('span', { class: 'name', text: m.name || m.email.split('@')[0] }), h('span', { class: 'email', text: m.email })), h('td', { text: m.role.replace('_', ' ') }), h('td', { text: m.site || 'Whole company' }), h('td', { text: m.status }))))) : h('p', { class: 'empty', text: 'No people yet.' })),
    h('h2', { text: 'Questions the AI could not answer' }), h('div', { class: 'card' }, c.top_unanswered.length ? c.top_unanswered.map((u, i) => h('div', { class: 'qrow' }, h('span', { class: 'qleft' }, h('span', { class: 'rank', text: String(i + 1) }), h('span', { class: 'qtext' }, h('b', { text: u.question }))), h('span', { class: 'muted', text: asksText(u.count) }))) : h('p', { class: 'empty', text: 'None in this period.' })));
}

async function vendors() {
  clear(main); put(pageHeader({ icon: 'operations', title: 'Vendors', sub: 'What operators say about each technology partner, across all customers. Aggregated and anonymised.', actions: periodPills(vendors) }), loading());
  let d; try { d = await api.get(`/api/v1/console/vendors?days=${st.days}`); } catch (e) { clear(main); put(pageHeader({ icon: 'operations', title: 'Vendors' }), failure(e, vendors)); return; }
  clear(main);
  put(pageHeader({ icon: 'operations', title: 'Vendors', sub: `${d.data.length} partners mentioned or rated, ${d.ratings} ratings in ${d.days} days.`, actions: periodPills(vendors) }));
  if (!d.data.length) { put(h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text: 'Nothing yet' }), h('p', { text: 'Vendors appear here once staff ask about them or rate them.' }))); return; }
  put(h('div', { class: 'stack' }, d.data.map((v) => h('div', { class: 'card vcard2' },
    h('div', { class: 'vhead' }, h('span', null, h('b', { text: v.vendor }), h('span', { class: 'vmeta', text: `  ${v.category}` })), h('span', { class: 'vmeta', text: `${v.mentions} mentions, ${v.conversations} conversations` })),
    v.nps ? h('div', { class: 'flagrow' }, h('span', { class: `statuschip ${v.nps.nps >= 30 ? 'active' : v.nps.nps < 0 ? 'past_due' : ''}`, text: `NPS ${v.nps.nps}` }), h('span', { class: 'vmeta', text: `average ${v.nps.avg} from ${v.nps.count} ratings (${v.nps.promoters} promoters, ${v.nps.passive} passive, ${v.nps.detractors} detractors)` })) : null,
    v.problems.length ? h('div', { class: 'chips', style: 'background:none;padding:0' }, v.problems.map((p) => h('span', { class: 'chip', text: `${p.label} ${p.count}` }))) : null,
    v.samples.length ? h('details', null, h('summary', { text: 'Example questions' }), h('ul', { class: 'examples' }, v.samples.map((s) => h('li', { text: s })))) : null))));
}

async function gaps() {
  clear(main); put(pageHeader({ icon: 'knowledge', title: 'Gaps', sub: 'Questions the AI could not answer, across all customers.', actions: periodPills(gaps) }), loading());
  let d; try { d = await api.get(`/api/v1/console/gaps?days=${st.days}`); } catch (e) { clear(main); put(pageHeader({ icon: 'knowledge', title: 'Gaps' }), failure(e, gaps)); return; }
  clear(main);
  put(pageHeader({ icon: 'knowledge', title: 'Gaps', sub: `${d.total} unanswered questions in ${d.days} days. What to teach the vendor playbook next.`, actions: periodPills(gaps) }),
    h('div', { class: 'card' }, d.data.length ? d.data.map((g, i) => h('div', { class: 'qrow' }, h('span', { class: 'qleft' }, h('span', { class: 'rank', text: String(i + 1) }), h('span', { class: 'qtext' }, h('b', { text: g.question }), h('span', { class: 'sub2', text: `${g.customers} ${g.customers === 1 ? 'customer' : 'customers'}, last ${shortDate(g.last_asked)}` }))), h('span', { class: 'muted', text: asksText(g.count) }))) : h('p', { class: 'empty', text: 'Every question was answered in this period.' })));
}

function route() {
  if (!main) return;
  const parts = location.hash.replace('#/', '').split('?')[0].split('/'); const key = parts[0] || 'overview';
  const view = NAV.some(([k]) => k === key) ? key : 'overview';
  document.querySelectorAll('.nav a').forEach((a) => { a.classList.toggle('on', a.id === 'nav-' + view); if (a.id === 'nav-' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  clear(crumb); crumb.append(h('span', { text: 'Console' }), h('span', { text: '/' }), h('b', { text: NAV.find(([k]) => k === view)[1] }));
  window.scrollTo(0, 0);
  if (view === 'customers' && parts[1]) customerDetail(parts[1]); else ({ overview, customers, vendors, gaps })[view]();
}

async function boot() {
  try { cfg = await (await fetch('/console/config.json')).json(); } catch (e) { root.textContent = 'Could not load. Please refresh.'; return; }
  auth = createAuth(cfg); api = createApi(auth, () => showSignIn('Your session ended. Please sign in again.'));
  window.addEventListener('hashchange', route);
  if (await auth.token()) await enter(); else showSignIn();
}
boot();
