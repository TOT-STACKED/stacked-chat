import { clear, h } from './dom.js';

const MODE_KEY = 'stacked_signin_mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };
const saveMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode: fine */ } };

/**
 * The sign-in form shared by Chat and Manage. Staff use their mobile number and a texted code; managers can use that or email.
 * opts: auth, box (the element to draw in), brand (node), title, note, errNode(text), btn (button class), defaultMode ('phone' | 'email'),
 *       extras() (nodes under the form), done() (called once signed in), phone (is sign-in by mobile number switched on? without it, email only).
 */
export function signInForm(opts) {
  const { auth, box } = opts;
  const phoneOn = opts.phone !== false;
  let mode = !phoneOn ? 'email' : readMode() === 'email' || readMode() === 'phone' ? readMode() : opts.defaultMode;
  let email = ''; let phone = '';
  const fail = (err, text) => { clear(err); err.append(opts.errNode(text)); };

  function tabs() {
    const tab = (m, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === m), class: `signtab ${mode === m ? 'on' : ''}`, onclick: () => { mode = m; saveMode(m); start(); } }, label);
    if (!phoneOn) return null; // email only until mobile sign-in is switched on for this server
    return h('div', { class: 'signtabs', role: 'tablist', 'aria-label': 'How do you want to sign in?' }, tab('phone', 'Mobile number'), tab('email', 'Email'));
  }
  const top = (heading, ...more) => [opts.brand, h('h1', { text: heading }), opts.note ? opts.noteNode(opts.note) : null, ...more].filter(Boolean);

  function start() {
    clear(box);
    const err = h('div');
    const isPhone = mode === 'phone';
    const input = isPhone
      ? h('input', { type: 'tel', id: 'si-id', autocomplete: 'tel', inputmode: 'tel', placeholder: '07700 900123', value: phone })
      : h('input', { type: 'email', id: 'si-id', autocomplete: 'email', placeholder: 'you@company.com', value: email });
    const label = isPhone ? 'Text me a code' : 'Email me a code';
    const go = h('button', { class: opts.btn, onclick: submit }, label);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      clear(err);
      if (isPhone) {
        phone = input.value.trim();
        if (phone.replace(/\D/g, '').length < 10) return fail(err, 'Enter your mobile number, for example 07700 900123.');
      } else {
        email = input.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(err, 'Enter a valid email address.');
      }
      go.disabled = true; go.textContent = 'Sending…';
      try { await (isPhone ? auth.sendPhoneCode(phone) : auth.sendCode(email)); code(); }
      catch (e) { go.disabled = false; go.textContent = label; fail(err, e.message); }
    }
    box.append(...top(opts.title, tabs(),
      h('p', { class: 'muted', text: isPhone ? "Use the mobile number your manager gave us. We'll text you a one-time code, so there is no password to remember." : "Use the email address your company invited. We'll send you a one-time code, so there is no password to remember." }),
      h('div', { class: 'field' }, h('label', { for: 'si-id', text: isPhone ? 'Mobile number' : 'Email address' }), input), err, go,
      ...(opts.extras ? opts.extras() : [])));
    input.focus();
  }

  function code() {
    clear(box);
    const isPhone = mode === 'phone';
    const input = h('input', { type: 'text', id: 'si-code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', maxlength: 10 });
    const err = h('div');
    const go = h('button', { class: opts.btn, onclick: submit }, 'Sign in');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    async function submit() {
      clear(err); const c = input.value.replace(/\s+/g, '');
      if (c.length < 6) return fail(err, isPhone ? 'Enter the 6-digit code from your text.' : 'Enter the code from your email.');
      go.disabled = true; go.textContent = 'Checking…';
      try { await (isPhone ? auth.verifyPhoneCode(phone, c) : auth.verifyCode(email, c)); await opts.done(); }
      catch (e) { go.disabled = false; go.textContent = 'Sign in'; fail(err, e.message); }
    }
    const again = h('button', { class: 'lnk', style: 'align-self:flex-start', onclick: async () => { clear(err); again.disabled = true; try { await auth.sendPhoneCode(phone); again.textContent = 'Sent. Give it a minute.'; } catch (e) { again.disabled = false; fail(err, e.message); } } }, 'Text me a new code');
    box.append(...top(isPhone ? 'Check your texts' : 'Check your email',
      h('p', { class: 'muted', text: isPhone ? `If ${phone} has been added by your manager, a text with a code is on its way. Nothing after a minute? Check the number, or ask your manager to add you.` : `We sent a code to ${email}. It can take a minute to arrive.` }),
      h('div', { class: 'field' }, h('label', { for: 'si-code', text: 'Code' }), input), err, go,
      isPhone ? again : null,
      h('button', { class: 'lnk', style: 'align-self:flex-start', onclick: start }, isPhone ? 'Use a different number' : 'Use a different email')));
    input.focus();
  }

  start();
}
