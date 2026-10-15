// Sign-in with a one-time email code (Supabase Auth). No passwords. The session lives in
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
    async token() {
      let s = load();
      if (!s) return null;
      if (s.dev) return s.access_token;
      if (Date.now() > (s.expires_at || 0) - 60000) s = await refresh(s);
      return s ? s.access_token : null;
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
