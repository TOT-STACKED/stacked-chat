// Sign-in with a one-time code by text (our own, for staff) or email (Supabase Auth). No passwords. The session lives in
// localStorage and is refreshed automatically. In local preview ("dev" config) you can pick a role.
const KEY = 'stacked_manage_session';

export function createAuth(cfg) {
  const base = cfg.supabaseUrl.replace(/\/$/, '') + '/auth/v1';
  const headers = { 'Content-Type': 'application/json', apikey: cfg.anonKey };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));

  async function post(path, body) {
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function refresh(s) {
    const { ok, data } = await post('/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (!ok || !data.access_token) { localStorage.removeItem(KEY); return null; }
    const next = { ...s, access_token: data.access_token, refresh_token: data.refresh_token || s.refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
    save(next); return next;
  }

  return {
    email: () => (load() || {}).email || '',
    /** a phone session is ours, not Supabase's: it lasts 60 days and is renewed quietly once it is more than half used */
    async token() {
      let s = load();
      if (!s) return null;
      if (s.dev) return s.access_token;
      if (s.phone) {
        if (Date.now() > (s.expires_at || 0)) { localStorage.removeItem(KEY); return null; }
        if (Date.now() > (s.expires_at || 0) - 30 * 86400000) {
          try {
            const res = await fetch('/api/v1/auth/phone/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token } });
            if (res.ok) { const d = await res.json(); s = { ...s, access_token: d.access_token, expires_at: d.expires_at }; save(s); }
            else if (res.status === 401) { localStorage.removeItem(KEY); return null; }
          } catch (e) { /* offline: keep using the one we have */ }
        }
        return s.access_token;
      }
      if (Date.now() > (s.expires_at || 0) - 60000) s = await refresh(s);
      return s ? s.access_token : null;
    },
    async sendPhoneCode(phone) {
      const res = await fetch('/api/v1/auth/phone/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d.error && d.error.message) || 'We could not send a code. Check the number and try again.');
    },
    async verifyPhoneCode(phone, code) {
      const res = await fetch('/api/v1/auth/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.access_token) throw new Error((d.error && d.error.message) || "That code didn't work. Check it, or ask for a new one.");
      save({ phone: true, access_token: d.access_token, expires_at: d.expires_at, email: d.phone.replace(/^\+44(\d{4})(\d{6})$/, '0$1 $2') });
    },
    async sendCode(email) {
      const { ok, data } = await post('/otp', { email, create_user: true });
      if (!ok) throw new Error(data.msg || data.error_description || 'We could not send a code. Check the address and try again.');
    },
    async verifyCode(email, code) {
      // New people verify as 'signup', returning people as 'email': try both.
      for (const type of ['email', 'signup', 'magiclink']) {
        const { ok, data } = await post('/verify', { email, token: code, type });
        if (ok && data.access_token) {
          save({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000, email });
          return;
        }
      }
      throw new Error("That code didn't work. Check it and try again, or ask for a new one.");
    },
    devSignIn(role) { save({ dev: true, access_token: 'dev-' + role, email: role + '@example.com' }); },
    signOut() { localStorage.removeItem(KEY); },
  };
}
