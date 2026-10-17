import { clear, h } from '/manage/dom.js';
import { logo, tile } from '/manage/ui.js';

const root = document.getElementById('app');
const openedAt = Date.now();

/** The most helpful message in an error body: the first specific validation problem if there is one. */
function explain(data) {
  const e = data && data.error;
  if (!e) return 'Something went wrong. Please try again.';
  const first = Array.isArray(e.details) && e.details[0] && e.details[0].message;
  return e.code === 'validation_error' && first ? first : e.message || 'Something went wrong. Please try again.';
}

async function signUp(body) {
  const res = await fetch('/api/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(explain(data));
}

const point = (icon, title, text) => h('div', { class: 'point' }, tile(icon, 40), h('div', null, h('b', { text: title }), h('span', { text })));

function pitch() {
  return h('div', { class: 'pitch' },
    logo(),
    h('h1', { text: 'Start your 30-day free trial' }),
    h('p', { class: 'lead', text: 'Put your handbooks, allergen guides and how-tos in once. Your team asks in plain English and gets the answer back, with the source.' }),
    h('div', { class: 'points' },
      point('knowledge', 'Only your words', 'Answers come only from the documents you publish. Nothing is guessed or invented.'),
      point('people', 'Set up in an afternoon', 'Invite your team by email. No passwords and no IT team needed.'),
      point('billing', 'Nothing to pay up front', '30 days free with no card. After that £45 per venue per month, or £39 each from five venues. Unlimited staff.')));
}

function form() {
  const field = (label, id, extra, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }), h('input', { type: 'text', id, ...extra }), hint ? h('span', { class: 'hint', text: hint }) : null);
  const company = field('Company name', 'su-company', { autocomplete: 'organization', maxlength: 80, placeholder: 'e.g. The Old Crown Group' });
  const venue = field('Your first venue', 'su-venue', { maxlength: 80, placeholder: 'e.g. The Old Crown, Leeds' }, 'Optional. Leave it blank to use your company name. You can add more venues later.');
  const name = field('Your name', 'su-name', { autocomplete: 'name', maxlength: 60 });
  const email = field('Work email', 'su-email', { type: 'email', autocomplete: 'email', placeholder: 'you@company.com' });
  const trap = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'su-website', text: 'Leave this empty' }), h('input', { type: 'text', id: 'su-website', name: 'website', tabindex: '-1', autocomplete: 'off' }));
  const err = h('div');
  const go = h('button', { class: 'btn cta', type: 'submit' }, 'Start my free trial');

  const el = h('form', { class: 'formcard', novalidate: '', onsubmit: async (e) => {
    e.preventDefault(); clear(err);
    const v = { company: company.querySelector('input').value.trim(), venue: venue.querySelector('input').value.trim(), name: name.querySelector('input').value.trim(), email: email.querySelector('input').value.trim().toLowerCase() };
    const bad = (m) => { err.append(h('div', { class: 'banner', role: 'alert', text: m })); };
    if (v.company.length < 2) return bad('Enter your company name.');
    if (v.name.length < 2) return bad('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return bad('Enter a valid work email address.');
    go.disabled = true; go.textContent = 'Setting things up…';
    try {
      await signUp({ company_name: v.company, venue_name: v.venue || null, owner_name: v.name, owner_email: v.email, website: trap.querySelector('input').value, elapsed_ms: Date.now() - openedAt });
      done(v.email);
    } catch (ex) { go.disabled = false; go.textContent = 'Start my free trial'; bad(ex.message); }
  } },
    h('h2', { text: 'Create your account' }), company, venue, name, email, trap, err, go,
    h('p', { class: 'fine', text: 'No card needed. We will email you a link to sign in with a one-time code, so there is no password to remember.' }),
    h('div', { class: 'signinlinks' }, h('span', { text: 'Already using Stacked Chat?' }), h('a', { href: '/manage/', text: 'Owners and managers sign in' }), h('a', { href: '/chat/', text: 'Staff chat' })));
  return el;
}

function done(email) {
  const card = document.querySelector('.formcard');
  const next = h('div', { class: 'formcard' },
    h('div', { class: 'done', role: 'status' },
      h('div', { class: 'tick', 'aria-hidden': 'true', text: '✓' }),
      h('h2', { text: 'Check your inbox' }),
      h('p', { text: `We have sent a welcome email to ${email}. Open it, sign in with the one-time code, and your 30-day trial is ready.` }),
      h('a', { class: 'btn cta', href: '/manage/', text: 'Go to sign in' }),
      h('p', { class: 'fine', text: 'Nothing arrived? Check your spam folder. If this address already has a Stacked Chat account there is no new email: just sign in.' })));
  card.replaceWith(next);
}

root.replaceChildren();
root.append(h('main', { class: 'start' }, pitch(), form()));
