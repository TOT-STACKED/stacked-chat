import { clear, h, toast } from './dom.js';
import { createAuth } from './auth.js';
import { createApi } from './api.js';
import { renderPeople } from './people.js';
import { renderBilling } from './billing.js';
import { renderHome } from './home.js';
import { renderKnowledge } from './knowledge.js';
import { renderInsights } from './insights.js';
import { ICONS, avatar, logo, pageHeader, tile } from './ui.js';
import { ROLE_LABEL, atLeast, bestRole, isManagerAnywhere } from './lib.js';

const root = document.getElementById('app');
let cfg; let auth; let api;
const state = { memberships: [], orgs: [], orgId: null };

const NAV = [['home', 'Home'], ['knowledge', 'Knowledge'], ['people', 'People'], ['insights', 'Insights'], ['settings', 'Billing']];
const SOON_NAV = [['communicate', 'Communicate'], ['training', 'Training'], ['operations', 'Operations']];

// ---- sign in -------------------------------------------------------------------------------
function showSignIn(message) {
  clear(root);
  let email = '';
  const box = h('div', { class: 'box' });
  const brand = logo();
  root.append(h('div', { class: 'signin' }, box));

  function stepEmail(note) {
    clear(box);
    const input = h('input', { type: 'email', id: 'si-email', autocomplete: 'email', placeholder: 'you@company.com', value: email });
    const err = h('div');
    const go = h('button', { class: 'btn cta', onclick: submit }, 'Email me a code');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      email = input.value.trim().toLowerCase(); clear(err);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Enter a valid email address.' })); return; }
      go.disabled = true; go.textContent = 'Sending…';
      try { await auth.sendCode(email); stepCode(); }
      catch (e) { go.disabled = false; go.textContent = 'Email me a code'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    box.append(...[brand, h('h1', { text: 'Sign in to Manage' }),
      note ? h('div', { class: 'result', text: note }) : null,
      h('p', { class: 'muted', text: "Use the email address your company invited. We'll send you a one-time code, so there's no password to remember." }),
      h('div', { class: 'field' }, h('label', { for: 'si-email', text: 'Email address' }), input), err, go,
      cfg.dev ? devBox() : null].filter(Boolean));
    input.focus();
  }

  function stepCode() {
    clear(box);
    const input = h('input', { type: 'text', id: 'si-code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456' });
    const err = h('div');
    const go = h('button', { class: 'btn cta', onclick: submit }, 'Sign in');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      clear(err); const code = input.value.replace(/\s+/g, '');
      if (code.length < 6) { err.append(h('div', { class: 'banner', role: 'alert', text: 'Enter the code from your email.' })); return; }
      go.disabled = true; go.textContent = 'Checking…';
      try { await auth.verifyCode(email, code); await enter(); }
      catch (e) { go.disabled = false; go.textContent = 'Sign in'; err.append(h('div', { class: 'banner', role: 'alert', text: e.message })); }
    }
    box.append(brand, h('h1', { text: 'Check your email' }),
      h('p', { class: 'muted', text: `We sent a code to ${email}. It can take a minute to arrive.` }),
      h('div', { class: 'field' }, h('label', { for: 'si-code', text: 'Code' }), input), err, go,
      h('button', { class: 'lnk', style: 'align-self:flex-start', onclick: () => stepEmail() }, 'Use a different email'));
    input.focus();
  }

  function devBox() {
    return h('div', { class: 'devbox' }, h('span', { class: 'mono', text: 'Local preview: sign in as' }),
      h('div', { class: 'chips' }, [['owner', 'Owner'], ['hq', 'HQ admin'], ['mgr', 'Site manager'], ['staff', 'Staff']].map(([r, label]) =>
        h('button', { class: 'pill', onclick: async () => { auth.devSignIn(r); await enter(); } }, label))));
  }

  stepEmail(message);
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
  main = h('main', { class: 'main', id: 'main' });
  crumb = h('span', { class: 'crumbs' });
  root.append(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('a', { href: '#/home', 'aria-label': 'Stacked Manage home' }, logo()),
      orgBox,
      h('nav', { class: 'nav', 'aria-label': 'Main' }, h('span', { class: 'navlabel', text: 'Workspace' }),
        NAV.map(([k, label]) => h('a', { href: '#/' + k, id: 'nav-' + k }, tile(k, 28), label))),
      h('nav', { class: 'nav soonwrap', 'aria-label': 'Coming next', style: 'margin-top:8px' }, h('span', { class: 'navlabel', text: 'Coming next' }),
        SOON_NAV.map(([k, label]) => h('span', { class: 'soonitem' }, tile(k, 28), label, h('span', { class: 'tag', text: 'Soon' })))),
      h('div', { class: 'grow' })),
    h('div', { class: 'content' },
      h('header', { class: 'top' }, crumb,
        h('div', { class: 'userbox' }, h('div', { class: 'who' }, h('b', { text: auth.email() }), h('span', { text: org.name })),
          avatar(auth.email() || '?'), h('button', { class: 'btn line small', onclick: signOut }, 'Sign out'))),
      main)));
}

const SOON = {
  insights: ['Insights', 'What people ask most, what the AI could not answer, and usage by site and team.', 'What your teams ask, and what the AI could not answer.'],
};
const TITLES = { home: 'Home', knowledge: 'Knowledge', people: 'People', insights: 'Insights', settings: 'Billing' };

function route() {
  if (!main) return;
  const key = (location.hash.replace('#/', '') || 'home').split('?')[0].split('/')[0];
  const view = NAV.some(([k]) => k === key) ? key : 'home';
  document.querySelectorAll('.nav a').forEach((a) => { a.classList.toggle('on', a.id === 'nav-' + view); if (a.id === 'nav-' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  clear(main);
  const org = state.orgs.find((o) => o.id === state.orgId);
  const orgRole = bestRole(state.memberships, state.orgId, null);
  clear(crumb); crumb.append(h('span', { text: org.name }), h('span', { text: '/' }), h('b', { text: TITLES[view] }));
  window.scrollTo(0, 0);

  const restricted = (title, icon, lead, text) => main.append(pageHeader({ icon, title, sub: lead }),
    h('div', { class: 'card empty-state' }, tile('empty', 56), h('b', { text }), h('p', { text: 'If you should have access, ask your company admin to change your role.' })));

  if (view === 'home') { renderHome(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name, isManager: isManagerAnywhere(state.memberships, state.orgId), isAdmin: atLeast(orgRole, 'hq_admin'), email: auth.email() }); return; }
  if (view === 'people') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) { restricted('People', 'people', 'Invite people and choose what they can do.', 'This area is for managers'); return; }
    renderPeople(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name });
    return;
  }
  if (view === 'settings') {
    if (!atLeast(orgRole, 'hq_admin')) { restricted('Billing', 'settings', 'Plan, venues and invoices.', 'This area is for company admins'); return; }
    renderBilling(main, { api, orgId: state.orgId, orgName: org.name });
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
