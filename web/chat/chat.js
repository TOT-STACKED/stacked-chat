import { clear, h } from '/manage/dom.js';
import { createAuth } from '/manage/auth.js';
import { createApi } from '/manage/api.js';
import { parseBlocks, readableOn, youtubeThumb } from './render.js';

const root = document.getElementById('app');
let cfg; let auth; let api;
const st = { ctx: null, site: null, conversationId: null, messages: [], sending: false, error: null, npsShown: false };
const SITE_KEY = 'stacked_chat_site';

const svg = (d, size = 20, extra = {}) => {
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...extra })) s.setAttribute(k, v);
  for (const p of [].concat(d)) { const e = document.createElementNS(ns, 'path'); e.setAttribute('d', p); s.append(e); }
  return s;
};
const ICON = { send: 'M5 12h14M13 6l6 6-6 6', history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'], plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18' };
const logoSrc = '/manage/assets/logo-stacked.png';
const isHttps = (u) => /^https:\/\//i.test(String(u || ''));

// ---- sign in -----------------------------------------------------------------------------------------------
function showSignIn(note) {
  document.documentElement.style.removeProperty('--brand'); document.documentElement.style.removeProperty('--brand-ink');
  clear(root); let email = '';
  const box = h('div', { class: 'box' }); root.append(h('div', { class: 'signin' }, box));
  const emailStep = () => {
    clear(box);
    const input = h('input', { type: 'email', id: 'em', autocomplete: 'email', placeholder: 'you@company.com', value: email });
    const err = h('div'); const go = h('button', { class: 'btn', onclick: submit }, 'Email me a code');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      email = input.value.trim().toLowerCase(); clear(err);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.append(h('div', { class: 'err', role: 'alert', text: 'Enter a valid email address.' })); return; }
      go.disabled = true; go.textContent = 'Sending…';
      try { await auth.sendCode(email); codeStep(); } catch (e) { go.disabled = false; go.textContent = 'Email me a code'; err.append(h('div', { class: 'err', role: 'alert', text: e.message })); }
    }
    box.append(h('img', { src: logoSrc, alt: 'Stacked' }), h('h1', { text: 'Ask anything about work' }), note ? h('div', { class: 'err', text: note }) : null,
      h('p', { class: 'muted', text: "Sign in with the email address your company invited. We'll send you a one-time code, so there is no password to remember." }),
      h('div', null, h('label', { for: 'em', text: 'Email address' }), input), err, go,
      h('p', { class: 'muted', style: 'font-size:13.5px;margin:0' }, 'Own the business? ', h('a', { href: '/start/', text: 'Start a free trial' })),
      cfg.dev ? h('div', { class: 'devbox' }, h('span', { text: 'Local preview: sign in as' }), h('div', null, [['staff', 'Staff'], ['mgr', 'Site manager'], ['owner', 'Owner']].map(([r, l]) => h('button', { onclick: async () => { auth.devSignIn(r); await enter(); } }, l)))) : null);
    input.focus();
  };
  const codeStep = () => {
    clear(box);
    const input = h('input', { type: 'text', id: 'cd', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456' });
    const err = h('div'); const go = h('button', { class: 'btn', onclick: submit }, 'Sign in');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      clear(err); const code = input.value.replace(/\s+/g, '');
      if (code.length < 6) { err.append(h('div', { class: 'err', role: 'alert', text: 'Enter the code from your email.' })); return; }
      go.disabled = true; go.textContent = 'Checking…';
      try { await auth.verifyCode(email, code); await enter(); } catch (e) { go.disabled = false; go.textContent = 'Sign in'; err.append(h('div', { class: 'err', role: 'alert', text: e.message })); }
    }
    box.append(h('img', { src: logoSrc, alt: 'Stacked' }), h('h1', { text: 'Check your email' }), h('p', { class: 'muted', text: `We sent a code to ${email}. It can take a minute.` }),
      h('div', null, h('label', { for: 'cd', text: 'Code' }), input), err, go, h('button', { class: 'lnk', onclick: emailStep }, 'Use a different email'));
    input.focus();
  };
  emailStep();
}

// ---- after sign in -----------------------------------------------------------------------------------------
async function enter() {
  try { st.ctx = await api.get('/api/v1/chat/context'); }
  catch (e) { if (e.status !== 401) showSignIn('Something went wrong signing you in. Please try again.'); return; }
  if (!st.ctx.sites.length) { showNoAccess(); return; }
  // a venue link (/chat/<venue>) opens that venue's chat; otherwise the one used last
  const wanted = decodeURIComponent((location.pathname.replace(/^\/chat\/?/, '').split('/')[0] || '')).toLowerCase();
  const saved = localStorage.getItem(SITE_KEY);
  st.site = st.ctx.sites.find((s) => wanted && s.slug.toLowerCase().startsWith(wanted)) || st.ctx.sites.find((s) => s.site_id === saved) || st.ctx.sites[0];
  resetChat(); draw();
}
function showNoAccess() {
  clear(root);
  root.append(h('div', { class: 'nochat' }, h('img', { src: logoSrc, alt: 'Stacked', height: 32 }), h('h1', { text: 'No access yet', style: 'margin:0;font-size:24px' }),
    h('p', { class: 'muted', style: 'margin:0', text: `${auth.email() || 'This email address'} isn't part of a company yet. Ask your manager to invite you, then sign in again.` }),
    h('button', { class: 'btn', onclick: signOut }, 'Sign out')));
}
function signOut() { auth.signOut(); st.ctx = null; showSignIn(); }
function resetChat() { st.conversationId = null; st.messages = []; st.error = null; st.npsShown = false; }

function brandName() { return (st.site.branding.bot_name || 'Stacked Chat'); }
function applyBrand() {
  const c = /^#[0-9a-fA-F]{6}$/.test(st.site.branding.primary_color || '') ? st.site.branding.primary_color : '#E87830';
  document.documentElement.style.setProperty('--brand', c); document.documentElement.style.setProperty('--brand-ink', readableOn(c));
  document.title = brandName();
}

// ---- the chat screen ---------------------------------------------------------------------------------------
let thread; let input; let sendBtn;
function draw() {
  applyBrand(); clear(root);
  const b = st.site.branding; const sites = st.ctx.sites;
  const venue = sites.length > 1 ? h('select', { class: 'venue', 'aria-label': 'Venue', onchange: (e) => { st.site = sites.find((s) => s.site_id === e.target.value); localStorage.setItem(SITE_KEY, st.site.site_id); resetChat(); draw(); } },
    sites.map((s) => h('option', { value: s.site_id, selected: s.site_id === st.site.site_id }, sites.filter((x) => x.org_id === s.org_id).length < sites.length ? `${s.org_name}: ${s.site_name}` : s.site_name))) : null;
  thread = h('div', { class: 'thread', id: 'thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  input = h('textarea', { id: 'q', rows: 1, placeholder: 'Ask a question…', 'aria-label': 'Your question', maxlength: 2000 });
  sendBtn = h('button', { class: 'send', type: 'submit', 'aria-label': 'Send' }, svg(ICON.send));
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; sendBtn.disabled = st.sending || !input.value.trim(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } }, input, sendBtn);
  root.append(h('div', { class: 'app' },
    h('header', { class: 'bar' },
      h('button', { class: 'iconbtn', 'aria-label': 'Your conversations', onclick: openHistory }, svg(ICON.history)),
      h('div', { class: 'brand' }, isHttps(b.logo_url) ? h('img', { src: b.logo_url, alt: '' }) : null, h('b', { text: brandName() })),
      venue, h('button', { class: 'iconbtn', 'aria-label': 'New chat', onclick: () => { resetChat(); draw(); input.focus(); } }, svg(ICON.plus)),
      h('button', { class: 'avatar', title: `Sign out ${auth.email()}`, 'aria-label': `Sign out ${auth.email()}`, style: 'border:0;cursor:pointer', onclick: signOut }, (auth.email()[0] || '?').toUpperCase())),
    thread,
    h('div', { class: 'composer' }, form, h('p', { class: 'fine', text: 'Answers come from your company’s knowledge. For anything safety-critical, such as allergens, check with your manager.' }))));
  sendBtn.disabled = true; drawThread(); input.focus();
}

function hello() {
  const b = st.site.branding; const first = brandName()[0].toUpperCase();
  return h('div', { class: 'hello' }, h('div', { class: 'dotbig', 'aria-hidden': 'true', text: first }),
    h('h1', { text: b.welcome_heading || 'Ask anything about work' }),
    h('p', { text: b.welcome_message || 'Handbooks, procedures and how things work here. Ask in your own words.' }),
    h('div', { class: 'chipsrow' }, st.site.suggestions.map((q) => h('button', { class: 'suggest', onclick: () => send(q) }, q))));
}

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

function npsCard(m) {
  const card = h('div', { class: 'nps', role: 'group', 'aria-label': `Rate ${m.vendor}` });
  let score = null;
  const draw = (done) => {
    clear(card);
    if (done) { card.append(h('p', { class: 'npsthanks', text: done })); return; }
    const err = h('div'); const comment = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Anything you want to add? (optional)', 'aria-label': 'Comment' });
    const send = h('button', { class: 'btn small', disabled: true, onclick: async () => {
      send.disabled = true; clear(err);
      try { await api.post('/api/v1/chat/nps', { site_id: st.site.site_id, vendor: m.vendor, score, comment: comment.value.trim() || null }); draw('Thanks, that helps other venues choose.'); }
      catch (e) { send.disabled = false; err.append(h('div', { class: 'err', role: 'alert', text: e.message })); }
    } }, 'Send');
    const scale = h('div', { class: 'scale', role: 'radiogroup', 'aria-label': 'Score from 0 to 10' }, Array.from({ length: 11 }, (_, i) => h('button', { class: 'sc', role: 'radio', 'aria-checked': 'false', onclick: (e) => { score = i; send.disabled = false; scale.querySelectorAll('.sc').forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-checked', String(k === i)); }); } }, String(i))));
    card.append(h('b', { text: `How likely are you to recommend ${titleCase(m.vendor)} to another hospitality business?` }), scale, h('div', { class: 'scalehint' }, h('span', { text: 'Not likely' }), h('span', { text: 'Very likely' })), comment, err,
      h('div', { class: 'row' }, h('button', { class: 'lnk', onclick: () => draw('No problem.') }, 'Skip'), send));
  };
  draw();
  return h('div', { class: 'msg bot' }, h('div', { class: 'face', 'aria-hidden': 'true', text: brandName()[0].toUpperCase() }), h('div', { class: 'bubble' }, card));
}

/** "Ask my manager" (and, for technology faults, "Ask Stacked support") under the latest answer. */
function helpBlock(m) {
  const box = h('div', { class: 'helpbox' });
  const sentence = (list) => (list.length <= 1 ? list[0] || '' : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
  const done = (text) => { m.helpDone = text; clear(box); box.append(h('p', { class: 'helpdone', role: 'status', text })); };
  const idle = () => {
    clear(box);
    // a sensitive topic makes "Ask my manager" the main thing to do next, not a quiet link
    // (Element.append would print the word "null" for an empty slot, so only real buttons go in)
    const buttons = [m.sensitive ? h('button', { class: 'btn small', onclick: () => form('manager') }, 'Ask my manager') : h('button', { class: 'lnk', onclick: () => form('manager') }, 'Ask my manager'), m.support ? h('button', { class: 'lnk', onclick: () => form('stacked') }, 'Ask Stacked support') : null].filter(Boolean);
    box.append(...buttons);
  };
  const form = (target) => {
    clear(box);
    const note = h('textarea', { rows: 2, maxlength: 500, placeholder: target === 'manager' ? 'Add a note for your manager (optional)' : 'Tell support what you have tried (optional)', 'aria-label': 'Note' }); const err = h('div');
    const send = h('button', { class: 'btn small', onclick: async () => {
      send.disabled = true; clear(err);
      try {
        const r = await api.post('/api/v1/chat/help', { site_id: st.site.site_id, conversation_id: st.conversationId, target, note: note.value.trim() || null });
        done(target === 'stacked'
          ? (r.notified.length ? 'Sent to Stacked support. They will be in touch by email.' : 'Logged for Stacked support.')
          : r.notified.length ? `Sent to ${sentence(r.notified)}. They can reply to you by email.` : "We've logged this, but there is no manager with an email on file yet. Ask your company admin to invite one.");
      } catch (e) { send.disabled = false; err.append(h('div', { class: 'err', role: 'alert', text: e.message })); }
    } }, 'Send');
    box.append(h('b', { text: target === 'manager' ? (m.sensitive && m.sensitive.mode === 'manager' ? 'Send this to your manager? They will reply to you by email.' : 'Send this question to your manager?') : 'Send this to Stacked support?' }), note, err, h('div', { class: 'row' }, h('button', { class: 'lnk', onclick: idle }, 'Cancel'), send));
  };
  if (m.helpDone) done(m.helpDone); else idle();
  return box;
}

function botBubble(m, last) {
  const parts = [];
  if (m.sensitive && m.sensitive.mode === 'manager') parts.push(h('span', { class: 'sens', text: 'This one needs a person' }));
  else if (m.sensitive) parts.push(h('span', { class: 'sens soft', text: 'Check before you serve' }));
  if (m.unanswered) parts.push(h('span', { class: 'notin', text: 'Not in your knowledge base yet' }));
  for (const blk of parseBlocks(m.content)) {
    const inl = (ps) => ps.map((p) => (p.t === 'b' ? h('strong', { text: p.v }) : document.createTextNode(p.v)));
    if (blk.type === 'p') parts.push(h('p', null, inl(blk.parts)));
    else parts.push(h(blk.type, null, blk.items.map((it) => h('li', null, inl(it)))));
  }
  if (m.sources && m.sources.length) parts.push(h('div', { class: 'sources' }, m.sources.map((s) => h('span', { class: 'src', text: s.title }))));
  const media = [];
  for (const v of m.videos || []) if (isHttps(v.url)) { const t = youtubeThumb(v.url); media.push(h('a', { class: 'vcard', href: v.url, target: '_blank', rel: 'noopener noreferrer' }, t ? h('img', { src: t, alt: '' }) : h('span', { class: 'ph', 'aria-hidden': 'true', text: '▶' }), h('div', null, h('b', { text: v.title }), h('span', { text: 'Watch video' })))); }
  for (const i of m.images || []) if (isHttps(i.url)) media.push(h('img', { class: 'pic', src: i.url, alt: i.title }));
  if (media.length) parts.push(h('div', { class: 'media' }, media));
  if (m.support && isHttps(m.support.url)) parts.push(h('a', { class: 'support', href: m.support.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { text: 'Vendor support' }), h('b', { text: titleCase(m.support.vendor) })));
  if (last && st.conversationId) parts.push(helpBlock(m));
  return h('div', { class: 'msg bot' }, h('div', { class: 'face', 'aria-hidden': 'true', text: brandName()[0].toUpperCase() }), h('div', { class: 'bubble' }, parts));
}

function drawThread() {
  clear(thread);
  const col = h('div', { class: 'col' });
  if (!st.messages.length && !st.sending) col.append(hello());
  const lastBot = st.messages.map((m) => m.role).lastIndexOf('assistant');
  st.messages.forEach((m, i) => col.append(m.role === 'user' ? h('div', { class: 'msg user' }, h('div', { class: 'bubble', text: m.content })) : m.role === 'nps' ? npsCard(m) : botBubble(m, i === lastBot && !st.sending)));
  if (st.sending) col.append(h('div', { class: 'msg bot' }, h('div', { class: 'face', 'aria-hidden': 'true', text: brandName()[0].toUpperCase() }), h('div', { class: 'bubble', role: 'status', 'aria-label': 'Thinking' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')))));
  if (st.error) col.append(h('div', { class: 'err', role: 'alert', text: st.error }));
  thread.append(col); thread.scrollTop = thread.scrollHeight;
}

function submit() { const t = input.value.trim(); if (t) { input.value = ''; input.style.height = 'auto'; send(t); } }

async function send(text) {
  if (st.sending) return;
  st.error = null; st.messages.push({ role: 'user', content: text }); st.sending = true; drawThread(); if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await api.post('/api/v1/chat', { site_id: st.site.site_id, message: text, ...(st.conversationId ? { conversation_id: st.conversationId } : {}) });
    st.conversationId = r.conversation_id;
    st.messages.push({ role: 'assistant', content: r.reply, unanswered: r.unanswered, sources: r.sources, videos: r.videos, images: r.images, support: r.support, sensitive: r.sensitive || null });
    // a rating card: always when they asked to rate; otherwise once, after a couple of questions about a vendor
    const userTurns = st.messages.filter((m) => m.role === 'user').length;
    if (r.nps && (r.nps.forced || (!st.npsShown && userTurns >= 2))) { if (!r.nps.forced) st.npsShown = true; setTimeout(() => { st.messages.push({ role: 'nps', vendor: r.nps.vendor }); drawThread(); }, 900); }
  } catch (e) {
    if (e.status === 401) return;
    st.error = e.message || 'Something went wrong. Please try again.';
    st.messages.pop(); // let them send it again
    if (input && !input.value) input.value = text;
  }
  st.sending = false; drawThread(); if (sendBtn) sendBtn.disabled = !input.value.trim(); if (input) input.focus();
}

// ---- history -------------------------------------------------------------------------------------------------
async function openHistory() {
  const scrim = h('div', { class: 'scrim' }); const list = h('div', { class: 'list' }, h('p', { class: 'muted', style: 'padding:12px', text: 'Loading…' }));
  const close = () => { scrim.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your conversations' },
    h('header', null, h('h2', { text: 'Your conversations' }), h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, svg(ICON.close))),
    h('button', { class: 'newchat', onclick: () => { close(); resetChat(); draw(); } }, 'New chat'), list);
  scrim.addEventListener('click', close); document.addEventListener('keydown', onKey); document.body.append(scrim, drawer);
  try {
    const rows = (await api.get(`/api/v1/chat/conversations?site_id=${st.site.site_id}`)).data; clear(list);
    if (!rows.length) list.append(h('p', { class: 'muted', style: 'padding:12px', text: 'Nothing yet. Ask your first question.' }));
    for (const c of rows) list.append(h('button', { class: `conv ${c.id === st.conversationId ? 'on' : ''}`, onclick: async () => { close(); await load(c.id); } },
      h('b', { text: c.title }), h('span', { text: new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) })));
  } catch (e) { clear(list); list.append(h('div', { class: 'err', style: 'margin:12px', text: e.message })); }
}
async function load(id) {
  try {
    const c = await api.get(`/api/v1/chat/conversations/${id}?site_id=${st.site.site_id}`);
    st.conversationId = c.id; st.messages = c.messages.map((m) => ({ role: m.role, content: m.content })); st.error = null; draw();
  } catch (e) { st.error = e.message; drawThread(); }
}

async function boot() {
  try { cfg = await (await fetch('/chat/config.json')).json(); } catch (e) { root.textContent = 'Could not load. Please refresh.'; return; }
  auth = createAuth(cfg); api = createApi(auth, () => showSignIn('Your session ended. Please sign in again.'));
  if (await auth.token()) await enter(); else showSignIn();
}
boot();
