import { clear, h, toast } from './dom.js';
import { createAuth } from './auth.js';
import { createApi } from './api.js';
import { renderPeople } from './people.js';
import { ROLE_LABEL, bestRole, isManagerAnywhere } from './lib.js';

const root = document.getElementById('app');
let cfg; let auth; let api;
const state = { memberships: [], orgs: [], orgId: null };

const ICONS = {
  home: 'M2 7.5 8 2l6 5.5V14H2z',
  knowledge: 'M3 2.5h8a2 2 0 0 1 2 2V13.5H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h8',
  people: 'M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 3.2a2.2 2.2 0 0 1 0 4.2M12.5 9.7c1.3.5 2 1.7 2 3.8',
  insights: 'M3 13V8M8 13V3M13 13V6',
  settings: 'M2 4h5M10 4h4M2 8h2M7 8h7M2 12h8M13 12h1',
};
const NAV = [['home', 'Home'], ['knowledge', 'Knowledge'], ['people', 'People'], ['insights', 'Insights'], ['settings', 'Settings']];

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name]); svg.append(p);
  return svg;
}

// ---- sign in -------------------------------------------------------------------------------
function showSignIn(message) {
  clear(root);
  let email = '';
  const box = h('div', { class: 'box' });
  const brand = h('div', { class: 'brand' }, h('b', { text: 'Stacked' }), h('span', { text: 'Manage' }));
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
    box.append(...[brand, h('h1', { class: 'disp', text: 'Sign in' }),
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
    box.append(brand, h('h1', { class: 'disp', text: 'Check your email' }),
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
    h('div', { class: 'brand' }, h('b', { text: 'Stacked' }), h('span', { text: 'Manage' })),
    h('h1', { class: 'disp', text: 'No access yet' }),
    h('p', { class: 'muted', text: `${auth.email() || 'This email address'} isn't part of a company yet. Ask your company's admin to invite you, then sign in again.` }),
    h('button', { class: 'btn line', onclick: signOut }, 'Sign out'))));
}

function signOut() { auth.signOut(); showSignIn(); }

let main;
function drawShell() {
  clear(root);
  const org = state.orgs.find((o) => o.id === state.orgId);
  const role = bestRole(state.memberships, state.orgId, null);
  const best = role || (state.memberships.find((m) => m.orgId === state.orgId) || {}).role;
  const orgControl = state.orgs.length > 1
    ? h('select', { 'aria-label': 'Company', onchange: (e) => { state.orgId = e.target.value; localStorage.setItem('stacked_manage_org', state.orgId); drawShell(); route(); } },
      state.orgs.map((o) => h('option', { value: o.id, selected: o.id === state.orgId }, o.name)))
    : h('span', { style: 'font-weight:700;font-size:15px', text: org.name });
  main = h('main', { class: 'main', id: 'main' });
  root.append(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('b', { text: 'Stacked' }), h('span', { text: 'Manage' })),
      h('div', { class: 'scope' }, h('span', { class: 'mono', text: 'Viewing' }), orgControl, h('span', { style: 'font-size:13px;color:#B9B4A8', text: best ? ROLE_LABEL[best] : '' })),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(([k, label]) => h('a', { href: '#/' + k, id: 'nav-' + k }, icon(k), label))),
      h('div', { class: 'soon' }, h('span', { class: 'mono', text: 'Coming next' }), h('span', { text: 'Communicate' }), h('span', { text: 'Training' }), h('span', { text: 'Operations' })),
      h('div', { class: 'me' }, h('span', { text: auth.email() }), h('button', { class: 'lnk onDark', onclick: signOut }, 'Sign out'))),
    main));
}

const SOON = {
  home: ['Home', 'A single place for what needs your attention: questions the AI could not answer, drafts to review, pending invites.'],
  knowledge: ['Knowledge', 'Handbooks, documents and media in one list, aimed at the company, a site, a team or a role.'],
  insights: ['Insights', 'What people ask most, what the AI could not answer, and usage by site and team.'],
  settings: ['Settings', 'Company details, chat branding, API keys and webhooks.'],
};

function route() {
  if (!main) return;
  const key = (location.hash.replace('#/', '') || 'people').split('?')[0];
  const view = NAV.some(([k]) => k === key) ? key : 'people';
  document.querySelectorAll('.nav a').forEach((a) => { a.classList.toggle('on', a.id === 'nav-' + view); if (a.id === 'nav-' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  clear(main);
  const org = state.orgs.find((o) => o.id === state.orgId);
  if (view === 'people') {
    if (!isManagerAnywhere(state.memberships, state.orgId)) {
      main.append(h('div', { class: 'head' }, h('div', { class: 't' }, h('span', { class: 'mono', text: org.name }), h('h1', { class: 'disp', text: 'People' }))),
        h('div', { class: 'card pad rule' }, h('b', { text: 'This area is for managers' }), h('span', { class: 'muted', text: 'Staff use the Stacked Chat app to ask questions. If you should be able to manage people, ask your company admin to change your role.' })));
      return;
    }
    renderPeople(main, { api, memberships: state.memberships, orgId: state.orgId, orgName: org.name });
    return;
  }
  const [title, blurb] = SOON[view];
  main.append(h('div', { class: 'head' }, h('div', { class: 't' }, h('span', { class: 'mono', text: org.name }), h('h1', { class: 'disp', text: title }))),
    h('div', { class: 'card pad rule' }, h('b', { text: 'Coming soon' }), h('span', { class: 'muted', text: blurb }), h('a', { class: 'lnk', href: '#/people', style: 'align-self:flex-start;text-decoration:none', text: 'Go to People' })));
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
