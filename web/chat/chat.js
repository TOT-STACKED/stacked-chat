import { clear, h } from '/manage/dom.js';
import { createAuth } from '/manage/auth.js';
import { createApi } from '/manage/api.js';
import { parseBlocks, readableOn, youtubeThumb } from './render.js';

const root = document.getElementById('app');
let cfg; let auth; let api;
const st = { ctx: null, site: null, conversationId: null, messages: [], sending: false, error: null, npsShown: false, shown: new Set() };
const SITE_KEY = 'stacked_chat_site';
// Ratings already given or skipped are remembered for 30 days, so a vendor is not asked about again and again.
const RATED_KEY = 'stacked_chat_rated'; const RATED_DAYS = 30;
const ratedMap = () => { try { return JSON.parse(localStorage.getItem(RATED_KEY) || '{}') || {}; } catch { return {}; } };
const recentlyRated = (v) => { const t = ratedMap()[String(v).toLowerCase()]; return !!t && Date.now() - t < RATED_DAYS * 864e5; };
const markRated = (v) => { try { const m = ratedMap(); m[String(v).toLowerCase()] = Date.now(); localStorage.setItem(RATED_KEY, JSON.stringify(m)); } catch { /* private mode: fine */ } };

const svg = (d, size = 20, extra = {}) => {
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...extra })) s.setAttribute(k, v);
  for (const p of [].concat(d)) { const e = document.createElementNS(ns, 'path'); e.setAttribute('d', p); s.append(e); }
  return s;
};
const ICON = { send: 'M5 12h14M13 6l6 6-6 6', history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'], plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18', mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'], stop: 'M7 7h10v10H7z', list: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M9 3h6v4H9z', 'M9 13l2 2 4-4'], tick: 'M5 12l5 5L20 7' };
const logoSrc = '/manage/assets/logo-stacked.png';
const markSrc = '/manage/assets/favicon-192.png'; // the Stacked mark: the chat wears it unless a venue brings its own logo
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
function resetChat() { st.conversationId = null; st.messages = []; st.error = null; st.npsShown = false; st.shown = new Set(); }

const ownLogo = () => isHttps(st.site.branding.logo_url);
/** The assistant's picture: the Stacked mark, or the first letter in the venue's colour when they use their own logo. */
const faceBits = () => (ownLogo() ? { text: brandName()[0].toUpperCase() } : null);
const faceImg = () => h('img', { src: markSrc, alt: '', width: 64, height: 64, draggable: 'false' });
function face(cls) { return h('div', { class: cls, 'aria-hidden': 'true', ...(faceBits() || {}) }, ownLogo() ? null : faceImg()); }
function brandName() { return (st.site.branding.bot_name || 'Stacked Chat'); }
function applyBrand() {
  const c = /^#[0-9a-fA-F]{6}$/.test(st.site.branding.primary_color || '') ? st.site.branding.primary_color : '#E87830';
  document.documentElement.style.setProperty('--brand', c); document.documentElement.style.setProperty('--brand-ink', readableOn(c));
  document.title = brandName();
}

// ---- voice -------------------------------------------------------------------------------------------------
// Speech to text through the browser (Chrome, Edge, Safari). The words land in the box so they can be checked, then sent.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;
function micButton() {
  if (!Recognition) return null; // e.g. Firefox: no button rather than a broken one
  const btn = h('button', { class: 'mic', type: 'button', 'aria-label': 'Ask by voice', title: 'Ask by voice' }, svg(ICON.mic));
  const setState = (on) => { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.setAttribute('aria-label', on ? 'Stop listening' : 'Ask by voice'); btn.replaceChildren(svg(on ? ICON.stop : ICON.mic)); };
  // Tap once to start, tap again to stop. The browser ends a session after every pause, so we quietly start the next one
  // until the person taps stop (or nothing has been said for IDLE_MS, so the mic never stays open by accident).
  const IDLE_MS = 30000; let wanted = false; let idle;
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => { wanted = false; if (listening) listening.stop(); else finish(); }, IDLE_MS); };
  const finish = () => { wanted = false; clearTimeout(idle); setState(false); input.focus(); };
  const begin = () => {
    const rec = new Recognition(); const before = input.value.trim();
    rec.lang = 'en-GB'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = [...e.results].map((r) => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      input.value = (before ? before + ' ' : '') + said; input.dispatchEvent(new Event('input'));
      armIdle();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wanted = false; st.error = 'Allow the microphone in your browser to ask by voice.'; drawThread(); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') { wanted = false; st.error = 'Voice did not work just now. You can type instead.'; drawThread(); }
    };
    rec.onend = () => { listening = null; if (wanted) { try { begin(); return; } catch { /* fall through and stop */ } } finish(); };
    st.error = null; rec.start(); listening = rec;
  };
  btn.addEventListener('click', () => {
    if (listening || wanted) { wanted = false; if (listening) listening.stop(); else finish(); return; }
    try { wanted = true; begin(); setState(true); armIdle(); } catch { finish(); }
  });
  return btn;
}

// ---- the chat screen ---------------------------------------------------------------------------------------
let thread; let input; let sendBtn; let checkBtn;
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
  checkBtn = h('button', { class: 'iconbtn chkbtn', hidden: true, 'aria-label': 'Checklists', title: 'Checklists', onclick: openChecklists }, svg(ICON.list), h('i', { class: 'chkdot', hidden: true }));
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } }, input, micButton(), sendBtn);
  root.append(h('div', { class: 'app' },
    h('header', { class: 'bar' },
      h('button', { class: 'iconbtn', 'aria-label': 'Your conversations', onclick: openHistory }, svg(ICON.history)),
      h('div', { class: 'brand' }, ownLogo() ? h('img', { src: b.logo_url, alt: '' }) : h('img', { class: 'mark', src: markSrc, alt: '', width: 32, height: 32 }), h('b', { text: brandName() })),
      venue, checkBtn, h('button', { class: 'iconbtn', 'aria-label': 'New chat', onclick: () => { resetChat(); draw(); input.focus(); } }, svg(ICON.plus)),
      h('button', { class: 'avatar', title: `Sign out ${auth.email()}`, 'aria-label': `Sign out ${auth.email()}`, style: 'border:0;cursor:pointer', onclick: signOut }, (auth.email()[0] || '?').toUpperCase())),
    thread,
    h('div', { class: 'composer' }, form, h('p', { class: 'fine', text: 'Answers come from your company’s knowledge. For anything safety-critical, such as allergens, check with your manager.' }))));
  sendBtn.disabled = true; drawThread(); input.focus();
  refreshChecklists();
}

function hello() {
  const b = st.site.branding;
  return h('div', { class: 'hello' }, face('dotbig'),
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
    if (done) { m.done = true; markRated(m.vendor); card.append(h('p', { class: 'npsthanks', text: done })); return; }
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
  return h('div', { class: 'msg bot' }, face('face'), h('div', { class: 'bubble' }, card));
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
  if (m.unanswered && !(m.videos && m.videos.length)) parts.push(h('span', { class: 'notin', text: 'Not in your knowledge base yet' }));
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
  return h('div', { class: 'msg bot' }, face('face'), h('div', { class: 'bubble' }, parts));
}

function drawThread() {
  clear(thread);
  const col = h('div', { class: 'col' });
  if (!st.messages.length && !st.sending) col.append(hello());
  const lastBot = st.messages.map((m) => m.role).lastIndexOf('assistant');
  st.messages.forEach((m, i) => col.append(m.role === 'user' ? h('div', { class: 'msg user' }, h('div', { class: 'bubble', text: m.content })) : m.role === 'nps' ? npsCard(m) : botBubble(m, i === lastBot && !st.sending)));
  if (st.sending) col.append(h('div', { class: 'msg bot' }, face('face'), h('div', { class: 'bubble', role: 'status', 'aria-label': 'Thinking' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')))));
  if (st.error) col.append(h('div', { class: 'err', role: 'alert', text: st.error }));
  thread.append(col); thread.scrollTop = thread.scrollHeight;
}

function submit() { const t = input.value.trim(); if (t) { input.value = ''; input.style.height = 'auto'; send(t); } }

async function send(text) {
  if (st.sending) return;
  st.error = null; st.messages.push({ role: 'user', content: text }); st.sending = true; drawThread(); if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await api.post('/api/v1/chat', { site_id: st.site.site_id, message: text, ...(st.conversationId ? { conversation_id: st.conversationId } : {}), ...(st.shown.size ? { shown_media: [...st.shown] } : {}) });
    st.conversationId = r.conversation_id;
    for (const x of [...(r.videos || []), ...(r.images || [])]) st.shown.add(x.id); // so it is not offered again on every follow-up
    st.messages.push({ role: 'assistant', content: r.reply, unanswered: r.unanswered, sources: r.sources, videos: r.videos, images: r.images, support: r.support, sensitive: r.sensitive || null });
    // a rating card: always when they asked to rate; otherwise once, after a couple of questions about a vendor
    const userTurns = st.messages.filter((m) => m.role === 'user').length;
    // One card at a time, and never again for a product already rated or skipped. Asking to rate always works; a nudge only once per chat.
    const open = r.nps && st.messages.some((x) => x.role === 'nps' && !x.done && x.vendor === r.nps.vendor);
    const show = r.nps && !open && (r.nps.forced || (!st.npsShown && userTurns >= 2 && !recentlyRated(r.nps.vendor)));
    if (show) { st.npsShown = true; setTimeout(() => { st.messages.push({ role: 'nps', vendor: r.nps.vendor }); drawThread(); }, 900); }
  } catch (e) {
    if (e.status === 401) return;
    st.error = e.message || 'Something went wrong. Please try again.';
    st.messages.pop(); // let them send it again
    if (input && !input.value) input.value = text;
  }
  st.sending = false; drawThread(); if (sendBtn) sendBtn.disabled = !input.value.trim(); if (input) input.focus();
}

// ---- checklists: today's opening / closing lists for this venue --------------------------------------------------
st.lists = [];
const clTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const clWho = (email) => String(email || '').split('@')[0];
/** Fetch quietly: a venue with no checklists (or no checklist tables yet) simply never shows the button. */
async function refreshChecklists() {
  try { st.lists = (await api.get(`/api/v1/chat/checklists?site_id=${st.site.site_id}`)).data; } catch { st.lists = []; }
  paintCheckBtn();
}
function paintCheckBtn() {
  if (!checkBtn || !checkBtn.isConnected) return;
  checkBtn.hidden = st.lists.length === 0;
  const open = st.lists.filter((l) => !l.run.completed_at).length;
  const dot = checkBtn.querySelector('.chkdot'); if (dot) { dot.hidden = open === 0; dot.textContent = open ? String(open) : ''; }
}
async function openChecklists() {
  const scrim = h('div', { class: 'scrim' }); const body = h('div', { class: 'list chklist' });
  const close = () => { scrim.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); paintCheckBtn(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Checklists' },
    h('header', null, h('h2', { text: 'Checklists for today' }), h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, svg(ICON.close))), body);
  scrim.addEventListener('click', close); document.addEventListener('keydown', onKey); document.body.append(scrim, drawer);
  const replace = (t) => { const i = st.lists.findIndex((x) => x.checklist.id === t.checklist.id); if (i >= 0) st.lists[i] = { ...t, askNote: false, err: null }; };
  const toggle = async (l, item) => {
    const on = !l.run.ticks[item.id]; const before = { ...l.run.ticks };
    if (on) l.run.ticks[item.id] = { by: 'you', at: new Date().toISOString() }; else delete l.run.ticks[item.id];
    l.run.done = Object.keys(l.run.ticks).length; l.err = null; paint();
    try { replace(await api.post(`/api/v1/chat/checklists/${l.checklist.id}/tick`, { site_id: st.site.site_id, item_id: item.id, done: on })); }
    catch (e) { l.run.ticks = before; l.run.done = Object.keys(before).length; l.err = e.message; }
    paint();
  };
  const finish = async (l, note) => {
    l.err = null;
    try { replace(await api.post(`/api/v1/chat/checklists/${l.checklist.id}/complete`, { site_id: st.site.site_id, note: note || null })); }
    catch (e) { l.err = e.message; }
    paint();
  };
  function paint() {
    clear(body);
    if (!st.lists.length) { body.append(h('p', { class: 'muted', style: 'padding:12px', text: 'No checklists for your venue today.' })); return; }
    for (const l of st.lists) {
      const done = !!l.run.completed_at; const all = l.run.done >= l.run.total;
      const note = h('textarea', { rows: 2, maxlength: 600, placeholder: 'Why were some items skipped?', 'aria-label': 'Note' });
      body.append(h('section', { class: `chk ${done ? 'done' : ''}` },
        h('header', null, h('b', { text: l.checklist.title }), h('span', { class: 'chkcount', text: `${l.run.done} of ${l.run.total}` })),
        ...l.checklist.items.map((it) => {
          const t = l.run.ticks[it.id];
          return h('button', { class: `chkitem ${t ? 'on' : ''}`, role: 'checkbox', 'aria-checked': String(!!t), disabled: done, onclick: () => toggle(l, it) },
            h('span', { class: 'cbox' }, t ? svg(ICON.tick, 14, { 'stroke-width': 3 }) : null), h('span', { class: 'ctext', text: it.text }),
            t && t.by !== 'you' ? h('small', { text: `${clWho(t.by)} ${clTime(t.at)}` }) : null);
        }),
        l.err ? h('div', { class: 'err', role: 'alert', text: l.err }) : null,
        done ? h('p', { class: 'chkdone', text: `Done by ${clWho(l.run.completed_by)} at ${clTime(l.run.completed_at)}${l.run.note ? `. Note: ${l.run.note}` : ''}` })
          : l.askNote ? h('div', { class: 'chknote' }, note, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => finish(l, note.value.trim()) }, 'Finish with this note'), h('button', { class: 'lnk', onclick: () => { l.askNote = false; paint(); } }, 'Cancel')))
          : h('button', { class: 'btn small chkfinish', onclick: () => { if (all) finish(l, null); else { l.askNote = true; paint(); } } }, 'Mark as done')));
    }
    paintCheckBtn();
  }
  paint();
  await refreshChecklists(); paint();
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
