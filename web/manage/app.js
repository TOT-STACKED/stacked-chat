import { clear, h, modal, toast } from './dom.js';
import { signInForm } from './signin.js';
import { createAuth } from './auth.js';
import { createApi } from './api.js';
import { renderPeople } from './people.js';
import { renderSettings } from './settings.js';
import { renderHome } from './home.js';
import { renderKnowledge } from './knowledge.js';
import { renderInsights } from './insights.js';
import { renderOperations } from './operations.js';
import { renderCommunicate } from './communicate.js';
import { renderTraining } from './training.js';
import { ICONS, avatar, logo, pageHeader, tile } from './ui.js';
import { ROLE_LABEL, atLeast, bestRole, isManagerAnywhere } from './lib.js';
import { labelTables } from './responsive.js';

const root = document.getElementById('app');
labelTables(root);
let cfg; let auth; let api;
const state = { memberships: [], orgs: [], orgId: null };

const NAV = [['home', 'Home'], ['knowledge', 'Knowledge'], ['people', 'People'], ['insights', 'Insights'], ['operations', 'Operations'], ['communicate', 'Communicate'], ['training', 'Training'], ['settings', 'Settings']];
/** The phone's bottom bar is narrow: a few items use a shorter word there. */
const SHORT = { communicate: 'Updates', operations: 'Ops' };
const SOON_NAV = [];

// ---- sign in -------------------------------------------------------------------------------
function showSignIn(message) {
  clear(root);
  const box = h('div', { class: 'box' });
  root.append(h('div', { class: 'signin' }, box));
  const devBox = () => h('div', { class: 'devbox' }, h('span', { class: 'mono', text: 'Local preview: sign in as' }),
    h('div', { class: 'chips' }, [['owner', 'Owner'], ['hq', 'HQ admin'], ['mgr', 'Site manager'], ['staff', 'Staff']].map(([r, label]) =>
      h('button', { class: 'pill', onclick: async () => { auth.devSignIn(r); await enter(); } }, label))));
  signInForm({
    auth, box, brand: logo(), title: 'Sign in to Manage', note: message, defaultMode: 'email', btn: 'btn cta',
    noteNode: (t) => h('div', { class: 'result', text: t }), errNode: (t) => h('div', { class: 'banner', role: 'alert', text: t }),
    extras: () => [h('p', { class: 'muted', style: 'font-size:13.5px;margin:0' }, 'Run a hospitality business and new to Stacked Chat? ', h('a', { href: '/start/', text: 'Start your free trial' })), cfg.dev ? devBox() : null].filter(Boolean),
    done: () => enter(),
  });
}

// ---- Get help: a message to Stacked support, straight to the team's Slack, answered by email --------------------
function openHelp() {
  modal('Get help', (close) => {
    let kind = 'question';
    const kinds = [['problem', 'Something is not working'], ['question', 'A question'], ['idea', 'An idea']];
    const chips = h('div', { class: 'days', role: 'radiogroup', 'aria-label': 'What is this about?' }, kinds.map(([k, label]) =>
      h('button', { type: 'button', role: 'radio', class: `pill ${kind === k ? 'on' : ''}`, 'aria-checked': String(kind === k), onclick: (e) => { kind = k; chips.querySelectorAll('.pill').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); } }, label)));
    const text = h('textarea', { id: 'help-msg', rows: 6, maxlength: 2000, placeholder: 'Tell us what you need. If something is not working, say what you were doing and what you saw.', style: 'min-height:140px' });
    const err = h('div'); const send = h('button', { class: 'btn cta', onclick: submit }, 'Send to Stacked support');
    const body = h('div', { class: 'stack' });
    async function submit() {
      clear(err);
      if (text.value.trim().length < 3) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Tell us a little about what you need.' })); return; }
      send.disabled = true; send.textContent = 'Sending…';
      try {
        await api.post('/api/v1/support', { message: text.value.trim(), kind, org_id: state.orgId, page: location.hash || '#/home', source: 'manage', device: `${navigator.platform || ''} · ${navigator.userAgent}`.slice(0, 300) });
        clear(body); body.append(h('div', { class: 'empty-state', style: 'padding:24px 8px' }, h('b', { text: 'Sent. We have it.' }), h('p', { text: `Someone from Stacked will email you back at ${auth.email()}.` })), h('div', { class: 'row' }, h('button', { class: 'btn cta', onclick: close }, 'Done')));
      } catch (e) { send.disabled = false; send.textContent = 'Send to Stacked support'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    body.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'What is this about?' }), chips), h('div', { class: 'field' }, h('label', { for: 'help-msg', text: 'Your message' }), text),
      h('span', { class: 'hint', text: `It goes straight to the Stacked team, who reply by email to ${auth.email()}.` }), err, h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: close }, 'Cancel'), send));
    return body;
  });
}

// ---- after sign in ---------------------------------------------------------------------------
async function enter() {
  try {
    const me = await api.get('/api/v1/me');
    state.memberships = (me.memberships || []).map((m) => ({
      orgId: m.organisation.id, orgName: m.organisation.name, siteId: m.site ? m.site.id : null, siteName: m.site ? m.site.name : null, role: m.role,
    }));
    state.orgs = [...new Map(state.memberships.map((m) => [m.orgId, m.orgName || 'Your company'])).entries()].map(([id, name]) => ({ id, name }));
  } catch (e) { if (e.status !== 401) showSignIn('Something went wrong signing you in. Please try again.'); return; }
  const saved = localStorage.getItem('stacked_manage_org');
  state.orgId = state.orgs.some((o) => o.id === saved) ? saved : (state.orgs[0] || {}).id || null;
  if (!state.orgId) { showNoAccess(); return; }
  drawShell(); route();
}

function showNoAccess() {
  clear(root);
  root.append(h('div', { class: 'signin' }, h('div', { class: 'box' },
    logo(),
    h('h1', { text: 'No access yet' }),
    h('p', { class: 'muted', text: `${auth.email() || 'This email address'} isn't part of a company yet. Ask your company's admin to invite you, then sign in again.` }),
    h('button', { class: 'btn line', onclick: signOut }, 'Sign out'))));
}

/** After a rename: reload the names Manage shows (switcher, sidebar) and redraw. */
async function refreshOrgs() {
  try {
    const me = await api.get('/api/v1/me');
    state.memberships = (me.memberships || []).map((m) => ({ orgId: m.organisation.id, orgName: m.organisation.name, siteId: m.site ? m.site.id : null, siteName: m.site ? m.site.name : null, role: m.role }));
    state.orgs = [...new Map(state.memberships.map((m) => [m.orgId, m.orgName || 'Your company'])).entries()].map(([id, name]) => ({ id, name }));
    const keep = location.hash; drawShell(); location.hash = keep; route();
  } catch (e) { /* the name is saved; it will show on the next load */ }
}

function signOut() { auth.signOut(); showSignIn(); }

let main; let crumb;
const chevron = () => { const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); for (const [k, v] of Object.entries({ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'chev', 'aria-hidden': 'true' })) svg.setAttribute(k, v); const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M4 6l4 4 4-4'); svg.append(p); return svg; };

function drawShell() {
  clear(root);
  const org = state.orgs.find((o) => o.id === state.orgId);
  const role = bestRole(state.memberships, state.orgId, null);
  const best = role || (state.memberships.find((m) => m.orgId === state.orgId) || {}).role;
  const orgBox = h('div', { class: 'org' }, avatar(org.name, { square: true }),
    h('div', { class: 'meta' }, h('b', { text: org.name }), h('span', { text: best ? ROLE_LABEL[best] : '' })),
    state.orgs.length > 1 ? chevron() : null,
    state.orgs.length > 1 ? h('select', { 'aria-label': 'Switch company', onchange: (e) => { state.orgId = e.target.value; localStorage.setItem('stacked_manage_org', state.orgId); drawShell(); route(); } },
      state.orgs.map((o) => h('option', { value: o.id, selected: o.id === state.orgId }, o.name))) : null);
  main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  crumb = h('span', { class: 'crumbs' });
  root.append(h('div', { class: 'shell' },
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to main content'),
    h('aside', { class: 'side' },
      h('a', { href: '#/home', 'aria-label': 'Stacked Manage home' }, logo()),
      orgBox,
      h('nav', { class: 'nav', 'aria-label': 'Main' }, h('span', { class: 'navlabel', text: 'Workspace' }),
        NAV.map(([k, label]) => h('a', { href: '#/' + k, id: 'nav-' + k }, tile(k, 28), SHORT[k] ? [h('span', { class: 'lg', text: label }), h('span', { class: 'sh', text: SHORT[k] })] : label))),
      SOON_NAV.length ? h('nav', { class: 'nav soonwrap', 'aria-label': 'Coming next', style: 'margin-top:8px' }, h('span', { class: 'navlabel', text: 'Coming next' }),
        SOON_NAV.map(([k, label]) => h('span', { class: 'soonitem' }, tile(k, 28), label, h('span', { class: 'tag', text: 'Soon' })))) : null,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn line small helpside', 'aria-label': 'Get help', title: 'Get help', onclick: openHelp }, h('span', { class: 'hl', text: 'Get help' })),
      h('button', { class: 'btn line small mobsignout', onclick: signOut }, 'Sign out')),
    h('div', { class: 'content' },
      h('header', { class: 'top' }, crumb,
        h('div', { class: 'userbox' }, h('div', { class: 'who' }, h('b', { text: auth.email() }), h('span', { text: org.name })),
          h('button', { class: 'btn line small', onclick: openHelp }, 'Get help'), avatar(auth.email() || '?'), h('button', { class: 'btn line small', onclick: signOut }, 'Sign out'))),
      main)));
}

const SOON = {
  insights: ['Insights', 'What people ask most, what the AI could not answer, and usage by site and team.', 'What your teams ask, and what the AI could not answer.'],
};
const TITLES = { home: 'Home', knowledge: 'Knowledge', people: 'People', insights: 'Insights', operations: 'Operations', communicate: 'Communicate', training: 'Training', settings: 'Settings' };

function route() {
  if (!main) return;
  const key = (location.hash.replace('#/', '') || 'home').split('?')[0].split('/')[0];
  const view = NAV.some(([k]) => k === key) ? key : 'home';
  document.querySelectorAll('.nav a').forEach((a) => { a.classList.toggle('on', a.id === 'nav-' + view); if (a.id === 'nav-' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const onNav = document.querySelector('.nav a.on'); if (onNav && onNav.scrollIntoView) onNav.scrollIntoView({ inline: 'center', block: 'nearest' }); // the phone's bar scrolls sideways
  clear(main);
  const org = state.orgs.find((o) => o.id === state.orgId);
  const orgRole = bestRole(state.memberships, state.orgId, null);
  clear(crumb); crumb.append(h('span', { text: org.name }), h('span', { text: '/' }), h('b', { text: TITLES[view] }));
  document.title = `${TITLES[view]} · ${org.name} · Stacked Manage`;
  window.scrollTo(0, 0);
  if (state.routed) main.focus({ preventScroll: true }); // keyboard and screen reader users start at the top of the new screen
  state.routed = true;

  const restricted = (title, icon, lead, text) => main.append(pageHeader({ icon, title, sub: lead }),
    h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text }), h('p', { text: 'If you should have access, ask your company admin to change your role.' })));

  if (view === 'home') { renderHome(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name, isManager: isManagerAnywhere(state.memberships, state.orgId), isAdmin: atLeast(orgRole, 'hq_admin'), email: auth.email(), onHelp: openHelp }); return; }
  if (view === 'people') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('People', 'people', 'Invite people and choose what they can do.', 'This area is for managers'); return; }
    renderPeople(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name });
    return;
  }
  if (view === 'settings') {
    if (!atLeast(orgRole, 'hq_admin')) { restricted('Settings', 'settings', 'Company details, chat, API keys and billing.', 'This area is for company admins'); return; }
    const section = (location.hash.replace('#/', '').split('?')[0].split('/')[1]) || 'company';
    renderSettings(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name, section, onChange: refreshOrgs });
    return;
  }
  if (view === 'knowledge') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('Knowledge', 'knowledge', 'Handbooks, documents and media.', 'This area is for managers'); return; }
    renderKnowledge(main, { api, memberships: state.memberships, orgId: state.orgId });
    return;
  }
  if (view === 'insights') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('Insights', 'insights', 'What your teams ask.', 'This area is for managers'); return; }
    renderInsights(main, { api, memberships: state.memberships, orgId: state.orgId });
    return;
  }
  if (view === 'training') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('Training', 'training', 'Courses and sign-offs.', 'This area is for managers'); return; }
    renderTraining(main, { api, memberships: state.memberships, orgId: state.orgId });
    return;
  }
  if (view === 'communicate') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('Communicate', 'communicate', 'Updates to your team.', 'This area is for managers'); return; }
    renderCommunicate(main, { api, memberships: state.memberships, orgId: state.orgId });
    return;
  }
  if (view === 'operations') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('Operations', 'operations', 'Checklists and who has done them.', 'This area is for managers'); return; }
    renderOperations(main, { api, memberships: state.memberships, orgId: state.orgId });
    return;
  }
  const [title, , lead] = SOON[view];
  main.append(pageHeader({ icon: view, title, sub: lead }),
    h('div', { class: 'card empty-state' }, tile(view, 72), h('span', { class: 'badge role-staff', text: 'Coming soon' }), h('h2', { text: `${title} is on its way` }), h('p', { text: SOON[view][1] }),
      h('a', { class: 'btn line', href: '#/people', text: 'Go to People' })));
}

async function boot() {
  try { cfg = await (await fetch('config.json')).json(); }
  catch (e) { root.textContent = 'Could not load. Please refresh.'; return; }
  auth = createAuth(cfg);
  api = createApi(auth, () => showSignIn('Your session ended. Please sign in again.'));
  window.addEventListener('hashchange', route);
  if (await auth.token()) await enter(); else showSignIn();
}
boot();
