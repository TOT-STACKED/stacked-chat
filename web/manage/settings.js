import { clear, h, modal, toast } from './dom.js';
import { KEY_SCOPES, isHexColour, keyStatus, lastUsedText, scopeLabel, shortDate } from './lib.js';
import { pageHeader, tile } from './ui.js';
import { renderBilling } from './billing.js';

const SECTIONS = [['company', 'Company'], ['branding', 'Chat and branding'], ['tech-stack', 'Tech stack'], ['api-keys', 'API keys'], ['billing', 'Billing']];

/** Settings: company details, how the chat looks, API keys and billing. Owners and HQ admins only. */
export function renderSettings(main, ctx) {
  const section = SECTIONS.some(([k]) => k === ctx.section) ? ctx.section : 'company';
  clear(main);
  main.append(pageHeader({ icon: 'settings', title: 'Settings', sub: 'Company details, how your chat looks, API keys and billing.' }));
  const host = h('div', { class: 'stack' });
  main.append(h('div', { class: 'cols' },
    h('nav', { class: 'subnav', 'aria-label': 'Settings' }, SECTIONS.map(([k, label]) => h('a', { href: `#/settings/${k}`, class: k === section ? 'on' : '', 'aria-current': k === section ? 'page' : null, text: label })),
      h('span', { class: 'soonlink', text: 'Webhooks are coming soon' })), host));
  if (section === 'company') company(host, ctx);
  else if (section === 'branding') branding(host, ctx);
  else if (section === 'tech-stack') techStack(host, ctx);
  else if (section === 'api-keys') apiKeys(host, ctx);
  else renderBilling(host, { ...ctx, embedded: true });
}

const head = (title, sub) => h('div', { class: 'sechead' }, h('h2', { text: title }), sub ? h('span', { class: 'muted', text: sub }) : null);
const field = (label, id, control, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hint ? h('span', { class: 'hint', text: hint }) : null);
const input = (id, value, extra) => h('input', { type: 'text', id, value: value || '', ...(extra || {}) });

// ---- company ------------------------------------------------------------------------------------------------
async function company(host, ctx) {
  const { api, orgId } = ctx;
  host.append(head('Company', 'Your company name and venues.'), h('p', { class: 'muted', text: 'Loading…' }));
  let org; let sites;
  try { [org, sites] = await Promise.all([api.get(`/api/v1/orgs/${orgId}`), api.get(`/api/v1/orgs/${orgId}/sites`).then((r) => r.data)]); }
  catch (e) { clear(host); host.append(head('Company'), h('div', { class: 'banner', role: 'alert', text: e.message })); return; }
  clear(host); host.append(head('Company', 'Your company name and venues.'));

  const name = input('co-name', org.name, { maxlength: 80 });
  const save = h('button', { class: 'btn cta', onclick: async () => {
    const v = name.value.trim(); if (v === org.name) return toast('Nothing to change');
    save.disabled = true;
    try { org = await api.patch(`/api/v1/orgs/${orgId}`, { name: v }); toast('Company name saved'); ctx.onChange(); } catch (e) { toast(e.message); }
    save.disabled = false;
  } }, 'Save');
  host.append(h('div', { class: 'card pad stack' }, field('Company name', 'co-name', name, 'Shown in Manage and in invitation emails.'), h('div', { class: 'row', style: 'justify-content:flex-start' }, save)));

  host.append(h('h3', { text: 'Venues' }), h('div', { class: 'card scroll' }, h('table', { class: 'narrow' },
    h('thead', null, h('tr', null, ['Venue', ''].map((t) => h('th', { text: t })))),
    h('tbody', null, sites.map((s) => h('tr', null, h('td', null, h('span', { class: 'name', text: s.name })),
      h('td', { class: 'act' }, h('button', { class: 'lnk', onclick: () => rename(s) }, 'Rename'))))))),
    h('span', { class: 'muted', style: 'font-size:13px', text: 'Add venues from People. Venue size and on/off are under Billing.' }));

  function rename(site) {
    modal('Rename venue', (close) => {
      const n = input('site-name', site.name, { maxlength: 80 }); const err = h('div');
      const go = h('button', { class: 'btn cta', onclick: async () => {
        clear(err); go.disabled = true;
        try { await api.patch(`/api/v1/orgs/${orgId}/sites/${site.id}`, { name: n.value.trim() }); close(); toast('Venue renamed'); clear(host); company(host, ctx); }
        catch (e) { go.disabled = false; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      } }, 'Save');
      return h('div', { class: 'stack' }, field('Venue name', 'site-name', n), err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), go));
    });
  }
}

// ---- chat and branding --------------------------------------------------------------------------------------
async function branding(host, ctx) {
  const { api, orgId } = ctx;
  host.append(head('Chat and branding', 'How the chat looks to the people at each venue. Leave a field empty to use the Stacked default.'), h('p', { class: 'muted', text: 'Loading…' }));
  let rows;
  try { rows = (await api.get(`/api/v1/orgs/${orgId}/branding`)).data; }
  catch (e) { clear(host); host.append(head('Chat and branding'), h('div', { class: 'banner', role: 'alert', text: e.message })); return; }
  clear(host); host.append(head('Chat and branding', 'How the chat looks to the people at each venue. Leave a field empty to use the Stacked default.'));
  if (!rows.length) { host.append(h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text: 'No venues yet' }), h('p', { text: 'Add a venue in People first.' }))); return; }

  for (const row of rows) {
    const k = row.id.slice(0, 8);
    const bot = input(`b-bot-${k}`, row.bot_name, { maxlength: 40, placeholder: 'Stacked Chat' });
    const heading = input(`b-head-${k}`, row.welcome_heading, { maxlength: 80, placeholder: 'Your knowledge, on tap.' });
    const msg = h('textarea', { id: `b-msg-${k}`, maxlength: 300, placeholder: 'A short welcome for people opening the chat' }); msg.value = row.welcome_message || '';
    const hex = input(`b-hex-${k}`, row.primary_color, { maxlength: 7, placeholder: '#E87830', style: 'max-width:140px' });
    const swatch = h('input', { type: 'color', 'aria-label': 'Pick a colour', value: isHexColour(row.primary_color) ? row.primary_color : '#e87830', style: 'width:44px;height:42px;padding:2px;border:1px solid var(--line-strong);border-radius:10px;background:#fff' });
    swatch.addEventListener('input', () => { hex.value = swatch.value.toUpperCase(); preview(); });
    hex.addEventListener('input', () => { if (isHexColour(hex.value)) swatch.value = hex.value; preview(); });
    const logo = input(`b-logo-${k}`, row.logo_url, { placeholder: 'https://…/logo.png' });
    const prev = h('div', { class: 'brandprev' });
    const preview = () => {
      clear(prev);
      prev.append(h('span', { class: 'dotc', style: `background:${isHexColour(hex.value) ? hex.value : '#E87830'}` }), h('div', { class: 'pm' }, h('b', { text: bot.value.trim() || 'Stacked Chat' }), h('span', { class: 'sub2', text: msg.value.trim() || heading.value.trim() || 'Your knowledge, on tap.' })));
    };
    [bot, heading, msg].forEach((el) => el.addEventListener('input', preview)); preview();
    const err = h('div');
    const save = h('button', { class: 'btn cta', onclick: async () => {
      clear(err);
      if (hex.value.trim() && !isHexColour(hex.value)) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Use a colour like #E87830.' })); return; }
      save.disabled = true;
      try {
        await api.patch(`/api/v1/orgs/${orgId}/sites/${row.id}/branding`, { bot_name: bot.value.trim(), welcome_heading: heading.value.trim(), welcome_message: msg.value.trim(), primary_color: hex.value.trim(), logo_url: logo.value.trim() });
        toast(`Saved for ${row.name}`);
      } catch (e) { err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      save.disabled = false;
    } }, 'Save');
    host.append(h('div', { class: 'card pad stack' }, h('h3', { text: row.name }),
      h('div', { class: 'grid2' }, field('Chat name', `b-bot-${k}`, bot), field('Welcome heading', `b-head-${k}`, heading)),
      field('Welcome message', `b-msg-${k}`, msg, 'Plain text only.'),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: `b-hex-${k}`, text: 'Main colour' }), h('div', { class: 'actions' }, swatch, hex)), field('Logo link', `b-logo-${k}`, logo, 'A link to an image, starting with https://')),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Preview' }), prev), err, h('div', { class: 'row', style: 'justify-content:flex-start' }, save)));
  }
}

// ---- tech stack ---------------------------------------------------------------------------------------------
async function techStack(host, ctx) {
  const { api, orgId } = ctx;
  const intro = 'Tell us which systems each venue uses. The chat then gives answers for the right product, and never asks "which till do you use?".';
  host.append(head('Tech stack', intro), h('p', { class: 'muted', text: 'Loading…' }));
  let data;
  try { data = await api.get(`/api/v1/orgs/${orgId}/tech-stack`); }
  catch (e) { clear(host); host.append(head('Tech stack'), h('div', { class: 'banner', role: 'alert', text: e.message })); return; }
  clear(host); host.append(head('Tech stack', intro));
  if (!data.sites.length) { host.append(h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text: 'No venues yet' }), h('p', { text: 'Add a venue in People first.' }))); return; }
  for (const site of data.sites) {
    const k = site.id.slice(0, 8);
    const inputs = data.categories.map((c) => ({ c, el: input(`ts-${c.key}-${k}`, site.stack[c.key] || '', { maxlength: 60, placeholder: 'e.g. ' + ({ epos: 'Lightspeed', payments: 'Dojo', reservations: 'SevenRooms', rota: 'Deputy', ordering: 'Deliverect', loyalty: 'Stampede', inventory: 'Apicbase', pms: 'Mews', wifi: 'Purple Wi-Fi' }[c.key] || 'Product name') }) }));
    const err = h('div');
    const save = h('button', { class: 'btn cta', onclick: async () => {
      clear(err); save.disabled = true;
      try { await api.patch(`/api/v1/orgs/${orgId}/sites/${site.id}/tech-stack`, { stack: Object.fromEntries(inputs.map(({ c, el }) => [c.key, el.value.trim()])) }); toast(`Saved for ${site.name}`); }
      catch (e) { err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      save.disabled = false;
    } }, 'Save');
    host.append(h('div', { class: 'card pad stack' }, h('h3', { text: site.name }), h('div', { class: 'grid2' }, inputs.map(({ c, el }) => field(c.label, `ts-${c.key}-${k}`, el))), err, h('div', { class: 'row', style: 'justify-content:flex-start' }, save)));
  }
}

// ---- API keys -----------------------------------------------------------------------------------------------
async function apiKeys(host, ctx) {
  const { api, orgId } = ctx;
  const base = `/api/v1/orgs/${orgId}/api-keys`;
  async function load() {
    clear(host);
    host.append(h('div', { class: 'toolbar' }, head('API keys', 'Let your other systems talk to Stacked Chat. Each key gets only the access you choose, and you can switch it off at any time.'), h('button', { class: 'btn cta', onclick: openCreate }, 'Create key')), h('p', { class: 'muted', text: 'Loading…' }));
    let keys; let sites;
    try { [keys, sites] = await Promise.all([api.get(base).then((r) => r.data), api.get(`/api/v1/orgs/${orgId}/sites`).then((r) => r.data)]); }
    catch (e) { host.lastChild.replaceWith(h('div', { class: 'banner', role: 'alert', text: e.message })); return; }
    host.lastChild.remove();
    const siteName = (id) => (sites.find((s) => s.id === id) || {}).name || 'A site';
    host.append(keys.length ? h('div', { class: 'card scroll' }, h('table', null,
      h('thead', null, h('tr', null, ['Name', 'Key', 'Access', 'Last used', ''].map((t) => h('th', { text: t })))),
      h('tbody', null, keys.map((k) => { const status = keyStatus(k); const live = status === 'Active';
        return h('tr', null,
          h('td', null, h('span', { class: 'name', text: k.name }), h('span', { class: 'email', text: `Created ${shortDate(k.created_at)}${k.expires_at ? ', expires ' + shortDate(k.expires_at) : ''}` })),
          h('td', null, h('code', { class: 'keycode', text: k.key_prefix + '…' })),
          h('td', null, k.scopes.map((s) => h('span', { class: `chip ${live ? '' : 'dim'}`, text: scopeLabel(s) })), h('span', { class: `chip ${live ? '' : 'dim'}`, text: k.site_id ? siteName(k.site_id) + ' only' : 'All sites' }), !live ? h('span', { class: 'badge role-staff', text: status }) : null),
          h('td', { class: 'muted', text: lastUsedText(k.last_used_at) }),
          h('td', { class: 'act' }, live ? h('button', { class: 'lnk', onclick: () => revoke(k) }, 'Revoke') : null)); }))))
      : h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text: 'No keys yet' }), h('p', { text: 'Create a key to connect a rota system, an intranet or any other tool to your sites, teams, people and knowledge.' })),
      h('div', { class: 'card pad rule' }, h('h3', { text: 'A key is shown once' }), h('span', { class: 'muted', text: "When you create a key we show it a single time. We only keep a fingerprint, so if it's lost, create a new one." })));
    host._sites = sites;
  }

  function openCreate() {
    const sites = host._sites || [];
    modal('Create an API key', (close) => {
      const err = h('div'); const name = input('k-name', '', { maxlength: 80, placeholder: 'e.g. Rota system sync' });
      const checks = KEY_SCOPES.map(([k, label]) => h('label', null, h('input', { type: 'checkbox', value: k }), label));
      const site = h('select', { id: 'k-site' }, h('option', { value: '' }, 'All sites'), sites.map((s) => h('option', { value: s.id }, `${s.name} only`)));
      const go = h('button', { class: 'btn cta', onclick: async () => {
        clear(err);
        const scopes = checks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
        if (!name.value.trim()) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Give the key a name.' })); return; }
        if (!scopes.length) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Choose at least one thing it can do.' })); return; }
        go.disabled = true;
        try { const r = await api.post(base, { name: name.value.trim(), scopes, site_id: site.value || null }, { 'Idempotency-Key': crypto.randomUUID() }); close(); showKey(r.key, r.api_key.name); await load(); }
        catch (e) { go.disabled = false; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
      } }, 'Create key');
      return h('div', { class: 'stack' }, field('Name', 'k-name', name), h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'What can it do?' }), h('div', { class: 'checks' }, checks)),
        field('Which sites?', 'k-site', site), err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), go));
    });
  }

  function showKey(key, name) {
    modal('Copy your key now', (close) => {
      const copy = h('button', { class: 'btn line small', onclick: async () => { try { await navigator.clipboard.writeText(key); copy.textContent = 'Copied'; } catch { toast('Select the key and copy it by hand'); } } }, 'Copy');
      return h('div', { class: 'stack' },
        h('div', { class: 'banner info', role: 'status', text: `This is the only time we will show the key for "${name}". Store it somewhere safe. If you lose it, create a new one.` }),
        h('code', { class: 'keybox', text: key }), h('div', { class: 'row' }, copy, h('button', { class: 'btn cta', onclick: close }, 'Done')));
    });
  }

  function revoke(k) {
    modal('Revoke this key?', (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted', style: 'margin:0', text: `"${k.name}" will stop working straight away. Anything using it will lose access.` }),
      h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Keep it'),
        h('button', { class: 'btn danger', onclick: async () => { try { await api.del(`${base}/${k.id}`); close(); toast('Key revoked'); await load(); } catch (e) { toast(e.message); } } }, 'Revoke'))));
  }

  load();
}
