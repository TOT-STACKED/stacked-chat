import { clear, h, toast } from './dom.js';
import { pageHeader, tile } from './ui.js';
import { INTERVAL_WORD, bannerFor, formatGbp, planName, usageRatio, venueCountText } from './lib.js';

const PRICES = { standard: [45, 450], group: [39, 390], large: [79, 790] };

/** Settings > Billing: plan and price, venues and tiers, trial countdown, fair use. Owners and HQ admins only. */
export async function renderBilling(main, ctx) {
  const { api, orgId } = ctx;
  const st = { data: null, error: null, busy: false, interval: 'month' };

  async function load() {
    st.error = null;
    try { st.data = await api.get(`/api/v1/orgs/${orgId}/billing/summary`); if (st.data.account) st.interval = st.data.account.interval; }
    catch (e) { st.error = e; }
    draw();
  }

  async function go(label, fn) {
    if (st.busy) return; st.busy = true; draw();
    try { await fn(); }
    catch (e) { toast(e.message || 'Something went wrong'); }
    st.busy = false; await load(); void label;
  }
  const redirect = (url) => { window.location.href = url; };
  const addCard = () => go('card', async () => {
    const r = await api.post(`/api/v1/orgs/${orgId}/billing/checkout`, { interval: st.interval });
    if (r.action === 'redirect') redirect(r.url);
  });
  const portal = () => go('portal', async () => { redirect((await api.post(`/api/v1/orgs/${orgId}/billing/portal`)).url); });
  const startTrial = () => go('trial', async () => { await api.post(`/api/v1/orgs/${orgId}/billing/checkout`, { interval: st.interval }); toast('Your 30-day free trial has started'); });
  const setSite = (siteId, patch) => go('site', async () => { await api.patch(`/api/v1/orgs/${orgId}/sites/${siteId}/billing`, patch); toast('Saved. Your bill is updated.'); });

  function draw() {
    clear(main);
    const d = st.data;
    main.append(pageHeader({ icon: 'billing', title: 'Billing', sub: 'One price per venue. Unlimited staff.' }));
    const body = h('div', { class: 'stack' });
    main.append(body);
    if (st.error) {
      const off = st.error.status === 503;
      body.append(h('div', { class: off ? 'card pad rule' : 'banner', role: off ? null : 'alert' },
        off ? [h('b', { text: 'Billing is not switched on yet' }), h('span', { class: 'muted', text: 'Nothing is charged and nothing is restricted. Stacked will let you know when billing is ready.' })]
          : [st.error.message + ' ', h('button', { class: 'lnk', onclick: load }, 'Try again')]));
      return;
    }
    if (!d) { body.append(h('p', { class: 'muted', text: 'Loading…' })); return; }

    const banner = bannerFor(d.state);
    if (banner) body.append(h('div', { class: banner.tone === 'warn' ? 'banner' : 'banner info', role: 'status' }, banner.text));

    // h() drops empty children, but body.append() would print "false": filter first
    body.append(...(d.account ? onPlan(d, banner) : noPlan(d)).filter(Boolean));
    body.append(priceCard(d));
  }

  function subnav() {
    return h('nav', { class: 'subnav', 'aria-label': 'Settings' },
      h('a', { href: '#/settings/billing', class: 'on', 'aria-current': 'page', text: 'Billing' }),
      h('span', { class: 'soonlink', text: 'Company, chat, API keys and webhooks are coming soon' }));
  }

  function intervalToggle() {
    const pill = (v, label) => h('button', { class: `pill ${st.interval === v ? 'on' : ''}`, onclick: () => { st.interval = v; draw(); } }, label);
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'Billing period' }, pill('month', 'Monthly'), pill('year', 'Yearly, 2 months free'));
  }

  function noPlan(d) {
    const per = st.interval === 'year' ? 'year' : 'month';
    const preview = d.pricing;
    return [
      h('div', { class: 'card pad rule' },
        h('b', { text: 'Start your free trial' }),
        h('span', { class: 'muted', text: '30 days free, no card needed. We ask for a card before the trial ends, and nothing is charged until then.' }),
        intervalToggle(),
        preview.active_venues
          ? h('span', { text: `Your ${venueCountText(preview.active_venues)} would cost ` }, h('b', { text: formatGbp(previewTotal(d)) }), ` a ${per}, excluding VAT.`)
          : h('span', { class: 'muted', text: 'Add a venue first, then you can start your trial.' }),
        h('div', { class: 'actions' }, h('button', { class: 'btn cta', disabled: st.busy || !preview.active_venues, onclick: startTrial }, 'Start free trial'))),
    ];
  }
  // the server previews the monthly price; yearly is exactly ten months
  const previewTotal = (d) => (st.interval === 'year' ? d.pricing.total_pence * 10 : d.pricing.total_pence);

  function onPlan(d, banner) {
    const acc = d.account; const per = INTERVAL_WORD[acc.interval];
    const cards = h('div', { class: 'grid3' },
      stat('Plan', planName(d.pricing)),
      stat(acc.status === 'trialing' ? 'After your trial' : 'Next invoice', d.next_invoice_pence === null ? 'None' : `${formatGbp(d.next_invoice_pence)} / ${per}`, 'Excluding VAT'),
      stat(acc.status === 'trialing' ? 'Trial' : 'Status', acc.status === 'trialing' ? (d.state.trial_days_left === 0 ? 'Ended' : `${d.state.trial_days_left} days left`) : statusWord(acc.status), acc.has_card ? 'Card on file' : 'No card yet'));
    const buttons = h('div', { class: 'actions' },
      !acc.has_card && h('button', { class: 'btn cta', disabled: st.busy, onclick: addCard }, 'Add card'),
      h('button', { class: acc.has_card ? 'btn cta' : 'btn line', disabled: st.busy, onclick: portal }, 'Manage billing'));
    void banner;

    const lines = h('div', { class: 'card scroll' }, h('table', { class: 'narrow' },
      h('thead', null, h('tr', null, ['Rate', 'Venues', `Price each / ${per}`, `Total / ${per}`].map((t) => h('th', { text: t })))),
      h('tbody', null, d.pricing.lines.map((l) => h('tr', null, h('td', null, h('span', { class: 'name', text: l.label })), h('td', { text: String(l.quantity) }), h('td', { text: formatGbp(l.unit_pence) }), h('td', { text: formatGbp(l.total_pence) }))),
        d.pricing.lines.length ? h('tr', null, h('td', null, h('b', { text: 'Total' })), h('td'), h('td'), h('td', null, h('b', { text: formatGbp(d.pricing.total_pence) }))) : h('tr', null, h('td', { class: 'empty', colspan: 4, text: 'No active venues' })))));

    return [cards, buttons,
      d.pricing.group_rate && h('div', { class: 'result', text: 'You have 5 or more venues, so your standard venues are on the Group rate of £39 each. It moves back automatically if you drop below 5.' }),
      h('h3', { text: 'What you pay' }), lines,
      h('h3', { text: 'Your venues' }), venuesTable(d),
      h('h3', { text: 'Fair use' }), fairUse(d)];
  }

  const statusWord = (s) => ({ active: 'Active', past_due: 'Payment overdue', paused: 'Paused', canceled: 'Cancelled', trialing: 'Trial' })[s] || s;
  const STAT_ICON = { Plan: 'box', Trial: 'jar', Status: 'shield', 'After your trial': 'till', 'Next invoice': 'till' };
  const stat = (label, value, sub) => h('div', { class: 'card pad stat' }, tile(STAT_ICON[label] || 'box', 44),
    h('div', { class: 'sb' }, h('span', { class: 'lbl', text: label }), h('b', { class: 'big', text: value }), sub && h('span', { class: 'sub2', text: sub })));

  function venuesTable(d) {
    const canEdit = true;
    return h('div', { class: 'card scroll' }, h('table', { class: 'narrow' },
      h('thead', null, h('tr', null, ['Venue', 'Size', 'Status'].map((t) => h('th', { text: t })))),
      h('tbody', null, d.sites.map((s) => h('tr', null,
        h('td', null, h('span', { class: 'name', text: s.name })),
        h('td', null, h('select', { 'aria-label': `Size of ${s.name}`, disabled: st.busy || !canEdit, onchange: (e) => setSite(s.id, { billing_tier: e.target.value }) },
          h('option', { value: 'standard', selected: s.billing_tier === 'standard' }, 'Standard (up to ~75 staff)'),
          h('option', { value: 'large', selected: s.billing_tier === 'large' }, 'Large venue (75+ staff)'))),
        h('td', { class: 'act' }, h('button', { class: 'lnk', disabled: st.busy, onclick: () => setSite(s.id, { active: !s.active }) }, s.active ? 'Switch off' : 'Switch on'),
          !s.active && h('span', { class: 'chip dim', text: 'Off, not charged' })))))));
  }

  function fairUse(d) {
    const f = d.fair_use;
    const rows = f.venues.filter((v) => v.active);
    return h('div', { class: 'stack' },
      h('span', { class: 'muted', text: `Staff are unlimited. As a guide, a standard venue has up to about ${f.staff_per_venue} active staff and ${f.ai_questions_per_month.toLocaleString('en-GB')} AI questions a month. Going over never stops anyone: we just flag it so we can talk about the right plan.` }),
      f.any_over && h('div', { class: 'result', text: 'One or more venues are over a fair-use guide this month. Nothing is blocked. We may get in touch.' }),
      h('div', { class: 'card pad stack' }, rows.length ? rows.map((v) => h('div', { class: 'usage' },
        h('div', { class: 'usagehead' }, h('b', { text: v.name }), (v.over_ai || v.over_staff) && h('span', { class: 'chip', text: 'Over guide' })),
        meter('AI questions this month', v.ai_questions, f.ai_questions_per_month, v.over_ai),
        h('span', { class: 'muted', text: `${v.active_staff} active staff${v.tier === 'large' ? ' (large venue)' : ` of about ${f.staff_per_venue}`}` })))
        : h('span', { class: 'muted', text: 'No active venues.' })));
  }
  function meter(label, used, cap, over) {
    const bar = h('div', { class: `bar ${over ? 'over' : ''}`, role: 'img', 'aria-label': `${label}: ${used} of ${cap}` }, h('div', { style: `width:${Math.round(usageRatio(used, cap) * 100)}%` }));
    return h('div', { class: 'meter' }, h('div', { class: 'metermeta' }, h('span', { text: label }), h('span', { class: 'muted', text: `${used.toLocaleString('en-GB')} / ${cap.toLocaleString('en-GB')}` })), bar);
  }

  function priceCard() {
    const row = (name, who, p) => h('div', { class: 'price' }, h('b', { text: name }), h('span', { class: 'big', text: `£${p[st.interval === 'year' ? 1 : 0]}` }),
      h('span', { class: 'muted', text: `per venue, per ${st.interval}` }), h('span', { class: 'muted', text: who }));
    return h('div', { class: 'card pad stack' },
      h('b', { text: 'Our pricing' }),
      h('div', { class: 'grid3' }, row('Venue', '1 to 4 venues, up to about 75 staff each', PRICES.standard), row('Group', '5 or more venues. Applies automatically', PRICES.group), row('Large venue', 'Any venue with 75+ staff, such as hotels', PRICES.large)),
      h('span', { class: 'muted', text: 'All prices exclude VAT. Staff numbers are unlimited, subject to fair use. Yearly is 2 months free.' }));
  }

  // coming back from Stripe Checkout
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (q.get('card') === 'added') toast('Card saved. Thank you.');
  if (q.get('card') === 'cancelled') toast('No card was added.');
  if (q.get('card')) history.replaceState(null, '', location.pathname + '#/settings/billing');

  draw(); await load();
}
