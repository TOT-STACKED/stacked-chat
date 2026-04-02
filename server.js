const http = require('http');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuzlfocqovwhqdpitvxj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';

const KNOWLEDGE_BASE = `
You have access to a comprehensive knowledge base of hospitality technology vendor guides.
The knowledge base docs injected below are your PRIMARY source - always use them.

CRITICAL: Never tell a user you lack information about a product if it appears in the docs below.
The knowledge base covers Pepper, URocked, Sona, Holisto, Tabology, Pickpad, DNA Payments,
Embargo Loyalty, Opsyte, TISSL, Slerp, Nutritics, Yumpingo, Fydelia, PassEntry, Square,
Lightspeed, Deputy, Tenzo, Fourth, Airship, OpenTable, Bizimply, Stampede, SumUp, SevenRooms,
ResDiary, Collins, Zonal, Zettle, Worldpay, Stripe, Tevalis, EPOS Now, Deliverect, Nory,
Crunchtime, Apicbase, growyze, Giftpro, Workforce.com, Planday, Sona, Rezcontrol, and more.

General troubleshooting:
- Restart the affected device first
- Check internet/network connection
- Contact vendor support with account number ready

PSP contacts: Worldpay 0330 333 3967, SumUp 020 3510 0160, Square support.squareup.com/en/gb, Stripe 0800 041 8604, Zettle 020 3455 0690
`;

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const https = require('https');
  const url = new URL(`${SUPABASE_URL}${path}`);
  const body = opts.body ? JSON.stringify(opts.body) : null;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
    ...opts.headers
  };
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: opts.method || 'GET', headers
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res({ status: r.statusCode, data: JSON.parse(d || '[]') }); }
        catch { res({ status: r.statusCode, data: d }); }
      });
    });
    req.on('error', rej);
    if (body) req.write(body);
    req.end();
  });
}

async function getAnalytics() {
  try {
    const [convsR, ticketsR, docsR] = await Promise.all([
      sbFetch('/rest/v1/conversations?select=id,email,name,venue,messages,created_at&order=created_at.desc&limit=200'),
      sbFetch('/rest/v1/tickets?select=id,email,name,venue,issue,status,created_at&order=created_at.desc&limit=50'),
      sbFetch('/rest/v1/documents?select=filename,created_at&order=created_at.desc&limit=1000'),
    ]);
    const convs = Array.isArray(convsR.data) ? convsR.data : [];
    const tickets = Array.isArray(ticketsR.data) ? ticketsR.data : [];
    const docs = Array.isArray(docsR.data) ? docsR.data : [];
    const allMessages = [];
    convs.forEach(c => {
      if (c.messages && Array.isArray(c.messages)) {
        c.messages.filter(m => m.role === 'user').forEach(m => allMessages.push(m.content.toLowerCase()));
      }
    });
    const topicKeywords = {
      'EPOS / Till system': ['epos','till','pos','register','touchscreen','terminal crashed','system down'],
      'Payment terminals': ['payment','card','contactless','worldpay','sumup','square','stripe','zettle'],
      'WiFi / Network': ['wifi','wi-fi','internet','network','broadband','connectivity','offline'],
      'Kitchen printers': ['kitchen','printer','kds','order not printing','print'],
      'Login / Access': ['login','log in','password','pin','access','locked out'],
      'Slow performance': ['slow','lagging','freezing','frozen','unresponsive'],
      'Bookings / Reservations': ['booking','reservation','resy','opentable','sevenrooms'],
      'Payroll / HR': ['payroll','hr','rota','deputy','rotaready','workforce'],
    };
    const topicCounts = {};
    Object.keys(topicKeywords).forEach(topic => {
      topicCounts[topic] = 0;
      allMessages.forEach(msg => { if (topicKeywords[topic].some(kw => msg.includes(kw))) topicCounts[topic]++; });
    });
    const vendors = ['lightspeed','square','zonal','epos now','tevalis','vita mojo','yoello','worldpay','sumup','stripe','zettle','deputy','rotaready','sevenrooms','opentable','resy','nutritics'];
    const vendorCounts = {};
    vendors.forEach(v => { vendorCounts[v] = allMessages.filter(m => m.includes(v)).length; });
    const topTopics = Object.entries(topicCounts).sort((a,b) => b[1]-a[1]).filter(([,c]) => c > 0);
    const topVendors = Object.entries(vendorCounts).sort((a,b) => b[1]-a[1]).filter(([,c]) => c > 0);
    const uniqueDocs = [...new Map(docs.map(d => [d.filename, d])).values()];
    return {
      totalConvs: convs.length, totalMessages: allMessages.length,
      openTickets: tickets.filter(t => t.status === 'open').length, totalDocs: uniqueDocs.length,
      topTopics, topVendors, recentConvs: convs.slice(0, 10), tickets, docs: uniqueDocs
    };
  } catch(e) { console.error('Analytics error:', e); return { error: e.message }; }
}

// ─── STACKED CHAT PAGE ────────────────────────────────────────────────────
// Gate has venue autocomplete: user types, dropdown shows matching venues,
// they pick one (joins) or hit "Create new venue" (creates).
const STACKED_CHAT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Stacked Chat</title>
<link rel="icon" type="image/png" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEwODBweCIgaGVpZ2h0PSIyMzFweCIgdmlld0JveD0iNjAgNDg0IDEwODAgMjMxIiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsgdGV4dC1yZW5kZXJpbmc6Z2VvbWV0cmljUHJlY2lzaW9uOyBpbWFnZS1yZW5kZXJpbmc6b3B0aW1pemVRdWFsaXR5OyBmaWxsLXJ1bGU6ZXZlbm9kZDsgY2xpcC1ydWxlOmV2ZW5vZGQiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iIzBiOTZmYSIgZD0iTSA5NzAuNSw1MTkuNSBDIDk2OS4yMDksNTE5LjI2MyA5NjguMjA5LDUxOS41OTYgOTY3LjUsNTIwLjVDIDk2MS43MjYsNTIwLjIgOTU4LjcyNiw1MjIuODY3IDk1OC41LDUyOC41QyA5NjAuMzk3LDU0MC4xMSA5NjEuNzMsNTUxLjc3NyA5NjIuNSw1NjMuNSBaIE0gNTgxLjUsNTU0LjUgQyA1ODQuODUsNTU0LjUwNiA1ODcuODUsNTU1LjUwNiA1OTAuNSw1NTcuNSBaIi8+PC9nPjwvc3ZnPgo=">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,900&family=Righteous&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --cream: #eef4fb; --cream-dark: #d4e6f7;
    --orange: #0F9BFF; --orange-light: #3db0ff;
    --brown: #0d2540; --brown-mid: #3a6080;
    --white: #ffffff; --green: #2a9d5c; --red: #d64545;
    --shadow: 0 2px 16px rgba(15,155,255,0.10);
    --shadow-lg: 0 8px 32px rgba(15,155,255,0.15);
  }
  html { height: 100%; height: 100dvh; overflow-x: hidden; overflow-y: hidden; }
  body { height: 100%; height: 100dvh; background: var(--cream); font-family: 'DM Sans', sans-serif; color: var(--brown); overflow: hidden; overscroll-behavior: none; touch-action: pan-y; max-width: 100vw; }

  /* ─── GATE ─── */
  #gate { position: fixed; inset: 0; background: var(--cream); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 24px; overflow-y: auto; }
  #gate.hidden { display: none; }
  .gate-card { background: var(--white); border-radius: 24px; padding: 40px 32px; width: 100%; max-width: 420px; box-shadow: var(--shadow-lg); text-align: center; }
  .gate-logo { height: 44px; max-width: 240px; object-fit: contain; margin-bottom: 4px; }
  .gate-sub { font-size: 13px; color: var(--brown-mid); margin-bottom: 28px; font-weight: 400; letter-spacing: 0.02em; }
  .gate-card h2 { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .gate-card p { font-size: 14px; color: var(--brown-mid); margin-bottom: 24px; line-height: 1.5; }
  .gate-input { width: 100%; padding: 13px 16px; border: 1.5px solid var(--cream-dark); border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 15px; color: var(--brown); background: var(--cream); margin-bottom: 12px; outline: none; transition: border-color 0.2s; }
  .gate-input:focus { border-color: var(--orange); background: var(--white); }
  .gate-input::placeholder { color: var(--brown-mid); opacity: 0.6; }
  .gate-btn { width: 100%; padding: 14px; background: var(--orange); color: #fff; border: none; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 4px; transition: background 0.2s, transform 0.1s; }
  .gate-btn:hover { background: var(--orange-light); }
  .gate-btn:active { transform: scale(0.98); }
  .gate-error { font-size: 13px; color: var(--red); margin-top: -6px; margin-bottom: 8px; display: none; }

  /* ─── VENUE AUTOCOMPLETE ─── */
  .venue-wrap { position: relative; margin-bottom: 12px; }
  .venue-wrap .gate-input { margin-bottom: 0; }
  .venue-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--white); border: 1.5px solid var(--cream-dark);
    border-radius: 12px; box-shadow: var(--shadow-lg); z-index: 200;
    overflow: hidden; display: none;
  }
  .venue-dropdown.open { display: block; }
  .venue-option {
    padding: 12px 16px; font-size: 14px; font-family: 'DM Sans', sans-serif;
    color: var(--brown); cursor: pointer; text-align: left;
    border-bottom: 1px solid var(--cream-dark); transition: background 0.1s;
    display: flex; align-items: center; gap: 10px;
  }
  .venue-option:last-child { border-bottom: none; }
  .venue-option:hover { background: var(--cream); }
  .venue-option .venue-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }
  .venue-option .venue-dot.new { background: var(--green); }
  .venue-option strong { font-weight: 600; }
  .venue-option span { font-size: 12px; color: var(--brown-mid); }
  .venue-confirmed {
    background: rgba(42,157,92,0.08); border: 1.5px solid rgba(42,157,92,0.3);
    border-radius: 12px; padding: 10px 14px; margin-bottom: 12px;
    display: none; align-items: center; gap: 10px; font-size: 14px; font-weight: 500;
    color: var(--brown); text-align: left;
  }
  .venue-confirmed.show { display: flex; }
  .venue-confirmed .vc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .venue-confirmed .vc-change { margin-left: auto; font-size: 12px; color: var(--orange); cursor: pointer; font-weight: 600; }

  /* ─── APP SHELL ─── */
  #app { display: flex; flex-direction: column; height: 100%; height: 100dvh; width: 100%; max-width: 100vw; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: var(--white); border-bottom: 1px solid var(--cream-dark); flex-shrink: 0; box-shadow: 0 1px 8px rgba(15,155,255,0.06); width: 100%; max-width: 100vw; }
  .header-logo { height: 28px; max-width: 180px; object-fit: contain; }
  .header-actions { display: flex; gap: 8px; align-items: center; }
  .icon-btn { background: none; border: none; cursor: pointer; padding: 8px; border-radius: 10px; color: var(--brown-mid); font-size: 18px; transition: background 0.15s, color 0.15s; display: flex; align-items: center; justify-content: center; }
  .icon-btn:hover { background: var(--cream); color: var(--brown); }
  .user-chip { display: flex; align-items: center; gap: 8px; background: var(--cream); border-radius: 20px; padding: 6px 12px 6px 8px; font-size: 13px; font-weight: 500; color: var(--brown); }
  .user-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
  main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  #messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 20px 16px 8px; display: flex; flex-direction: column; gap: 16px; scroll-behavior: smooth; width: 100%; }
  .welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; padding: 32px 16px; gap: 12px; text-align: center; }
  .welcome-wordmark { height: 52px; margin-bottom: 0px; max-width: 320px; object-fit: contain; }
  .welcome h2 { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; line-height: 1.2; }
  .welcome p { font-size: 14px; color: var(--brown-mid); margin-bottom: 8px; }
  .quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; max-width: 380px; }
  .quick-btn { background: var(--white); border: 2px solid var(--cream-dark); border-radius: 16px; padding: 18px 14px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 700; color: var(--brown); cursor: pointer; text-align: left; transition: border-color 0.2s, box-shadow 0.2s, transform 0.1s; line-height: 1.25; min-height: 90px; display: flex; flex-direction: column; justify-content: flex-end; }
  .quick-btn:hover { border-color: var(--orange); box-shadow: 0 4px 16px rgba(15,155,255,0.15); transform: translateY(-1px); }
  .quick-btn .emoji { font-size: 24px; display: block; margin-bottom: 8px; }
  .msg { display: flex; align-items: flex-start; gap: 10px; max-width: 100%; }
  .msg.user { flex-direction: row-reverse; }
  .msg-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: var(--cream-dark); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: var(--brown); overflow: hidden; }
  .msg-avatar img { width: 100%; height: 100%; object-fit: contain; }
  .msg-bubble { background: var(--white); border-radius: 18px 18px 18px 4px; padding: 12px 16px; font-size: 15px; line-height: 1.55; max-width: min(calc(100vw - 90px), 520px); box-shadow: var(--shadow); white-space: pre-wrap; word-wrap: break-word; }
  .msg-bubble a { color: var(--orange); font-weight: 600; text-decoration: underline; }
  .msg-bubble strong { font-weight: 700; }
  .msg.user .msg-bubble { background: var(--orange); color: #fff; border-radius: 18px 18px 4px 18px; box-shadow: 0 2px 12px rgba(15,155,255,0.25); }
  .ticket-row { display: flex; justify-content: center; margin-top: -4px; }
  .ticket-btn { background: var(--white); border: 1.5px solid var(--cream-dark); border-radius: 20px; padding: 8px 16px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--brown-mid); cursor: pointer; display: flex; align-items: center; gap: 6px; transition: border-color 0.2s, color 0.2s; }
  .ticket-btn:hover { border-color: var(--orange); color: var(--orange); }
  .link-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: -4px; padding-left: 42px; }
  .link-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--orange); border: none; border-radius: 20px; padding: 8px 14px; font-size: 13px; font-weight: 600; color: #fff; text-decoration: none; transition: all 0.15s; white-space: nowrap; box-shadow: 0 2px 8px rgba(15,155,255,0.25); }
  .link-pill:hover { background: #0d7acc; transform: translateY(-1px); }
  .typing-bubble { display: flex; align-items: flex-start; gap: 10px; }
  .dots { display: flex; gap: 4px; align-items: center; background: var(--white); border-radius: 18px; padding: 12px 16px; box-shadow: var(--shadow); }
  .dot-anim { width: 8px; height: 8px; border-radius: 50%; background: var(--brown-mid); animation: bounce 1.2s infinite; }
  .dot-anim:nth-child(2) { animation-delay: 0.2s; }
  .dot-anim:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
  .input-bar { padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background: var(--white); border-top: 1px solid var(--cream-dark); flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end; min-width: 0; }
  #input { flex: 1; min-width: 0; padding: 11px 14px; background: var(--cream); border: 1.5px solid var(--cream-dark); border-radius: 20px; font-family: 'DM Sans', sans-serif; font-size: 15px; color: var(--brown); resize: none; outline: none; max-height: 120px; line-height: 1.4; transition: border-color 0.2s; }
  #input:focus { border-color: var(--orange); background: #fff; }
  #input::placeholder { color: var(--brown-mid); opacity: 0.6; }
  #mic { width: 44px; height: 44px; border-radius: 50%; background: var(--cream); border: 1.5px solid var(--cream-dark); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; color: var(--brown-mid); }
  #mic:hover { border-color: var(--orange); color: var(--orange); }
  #mic.listening { background: var(--orange); border-color: var(--orange); color: #fff; animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(15,155,255,0.4); } 50% { box-shadow: 0 0 0 8px rgba(15,155,255,0); } }
  #send { width: 44px; height: 44px; border-radius: 50%; background: var(--orange); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, transform 0.1s; box-shadow: 0 2px 12px rgba(15,155,255,0.35); }
  #send:hover { background: var(--orange-light); }
  #send:active { transform: scale(0.93); }
  #send svg { width: 18px; height: 18px; fill: #fff; }
  #send:disabled { opacity: 0.5; cursor: default; }
  .drawer-overlay { position: fixed; inset: 0; background: rgba(13,37,64,0.4); z-index: 50; opacity: 0; pointer-events: none; transition: opacity 0.25s; }
  .drawer-overlay.open { opacity: 1; pointer-events: all; }
  .drawer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--white); border-radius: 24px 24px 0 0; z-index: 51; max-height: 70vh; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
  .drawer.open { transform: translateY(0); }
  .drawer-handle { width: 40px; height: 4px; background: var(--cream-dark); border-radius: 2px; margin: 12px auto 0; }
  .drawer-header { padding: 16px 20px 12px; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 700; border-bottom: 1px solid var(--cream-dark); display: flex; align-items: center; justify-content: space-between; }
  .drawer-close { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--brown-mid); padding: 4px; }
  .drawer-body { overflow-y: auto; padding: 16px 20px; flex: 1; }
  .history-item { padding: 14px 0; border-bottom: 1px solid var(--cream-dark); cursor: pointer; }
  .history-item:last-child { border-bottom: none; }
  .history-item:hover .history-preview { color: var(--orange); }
  .history-date { font-size: 11px; color: var(--brown-mid); margin-bottom: 4px; }
  .history-preview { font-size: 14px; font-weight: 500; color: var(--brown); transition: color 0.15s; }
  .history-count { font-size: 12px; color: var(--brown-mid); margin-top: 2px; }
  .empty-history { text-align: center; padding: 32px 0; color: var(--brown-mid); font-size: 14px; }
  .topics-list { display: flex; flex-direction: column; gap: 8px; }
  .topic-chip { background: var(--cream); border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 12px 16px; font-size: 14px; font-weight: 500; color: var(--brown); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px; transition: border-color 0.15s; }
  .topic-chip:hover { border-color: var(--orange); }
  .modal-overlay { position: fixed; inset: 0; background: rgba(13,37,64,0.5); z-index: 200; display: flex; align-items: flex-end; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .modal-overlay.open { opacity: 1; pointer-events: all; }
  .modal { background: var(--white); border-radius: 24px 24px 0 0; padding: 24px 24px calc(24px + env(safe-area-inset-bottom)); width: 100%; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal h3 { font-family: 'Fraunces', serif; font-size: 20px; margin-bottom: 6px; }
  .modal p { font-size: 14px; color: var(--brown-mid); margin-bottom: 20px; }
  .modal textarea { width: 100%; border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 12px 14px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--brown); background: var(--cream); resize: none; height: 100px; outline: none; margin-bottom: 14px; transition: border-color 0.2s; }
  .modal textarea:focus { border-color: var(--orange); background: #fff; }
  .modal-actions { display: flex; gap: 10px; }
  .modal-cancel { flex: 1; padding: 13px; background: var(--cream); border: none; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500; cursor: pointer; color: var(--brown); }
  .modal-submit { flex: 2; padding: 13px; background: var(--orange); border: none; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; color: #fff; transition: background 0.15s; }
  .modal-submit:hover { background: var(--orange-light); }
  .toast { position: fixed; bottom: calc(80px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%) translateY(20px); background: var(--brown); color: #fff; border-radius: 20px; padding: 10px 20px; font-size: 14px; font-weight: 500; opacity: 0; transition: all 0.3s; z-index: 300; white-space: nowrap; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.green { background: var(--green); }
  .social-proof { display: flex; align-items: center; gap: 6px; background: var(--white); border-radius: 20px; padding: 6px 14px; font-size: 12px; font-weight: 600; color: var(--brown-mid); box-shadow: var(--shadow); margin-bottom: 4px; }
  .social-proof .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; animation: pulse-green 2s infinite; }
  @keyframes pulse-green { 0%,100% { box-shadow: 0 0 0 0 rgba(42,157,92,0.4); } 50% { box-shadow: 0 0 0 5px rgba(42,157,92,0); } }
  .predict-section { width: 100%; max-width: 380px; margin-top: 4px; }
  .predict-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brown-mid); opacity: 0.6; margin-bottom: 8px; text-align: left; padding-left: 2px; }
  .predict-grid { display: flex; flex-direction: column; gap: 8px; }
  .predict-btn { background: var(--white); border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 10px 14px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--brown); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px; transition: border-color 0.2s, box-shadow 0.2s; width: 100%; }
  .predict-btn:hover { border-color: var(--orange); box-shadow: 0 2px 12px rgba(15,155,255,0.12); }
  .predict-btn .predict-icon { font-size: 16px; flex-shrink: 0; }
  .predict-tag { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: var(--orange); color: #fff; border-radius: 8px; padding: 2px 7px; flex-shrink: 0; }
  .qr-section { margin-top: 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .qr-box { background: var(--white); border-radius: 16px; padding: 12px; box-shadow: var(--shadow); cursor: pointer; }
  .qr-box canvas, .qr-box img { display: block; border-radius: 4px; }
  .qr-label { font-size: 11px; color: var(--brown-mid); font-weight: 500; text-align: center; opacity: 0.7; }
  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-track { background: transparent; }
  #messages::-webkit-scrollbar-thumb { background: var(--cream-dark); border-radius: 2px; }
  .logo-strip { flex-shrink: 0; overflow: hidden; background: var(--white); border-bottom: 1px solid var(--cream-dark); padding: 12px 0; position: relative; }
  .logo-strip::before, .logo-strip::after { content: ''; position: absolute; top: 0; bottom: 0; width: 48px; z-index: 2; pointer-events: none; }
  .logo-strip::before { left: 0; background: linear-gradient(to right, var(--white), transparent); }
  .logo-strip::after { right: 0; background: linear-gradient(to left, var(--white), transparent); }
  .logo-track { display: flex; align-items: center; gap: 44px; width: max-content; animation: logoScroll 30s linear infinite; }
  .logo-track:hover { animation-play-state: paused; }
  .logo-text { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--brown); opacity: 0.3; white-space: nowrap; flex-shrink: 0; user-select: none; }
  .logo-dot { width: 4px; height: 4px; background: var(--brown); border-radius: 50%; opacity: 0.15; flex-shrink: 0; }
  .strip-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brown-mid); opacity: 0.45; white-space: nowrap; flex-shrink: 0; }
  @keyframes logoScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  .video-row{display:flex;flex-direction:column;gap:8px;margin-top:-4px;padding-left:42px}
  .chat-video-card{background:var(--white);border:1.5px solid var(--cream-dark);border-radius:16px;overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;max-width:320px}
  .chat-video-card:hover{box-shadow:0 4px 16px rgba(15,155,255,0.15);border-color:var(--orange)}
  .chat-video-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--cream-dark);display:block}
  .chat-video-thumb-empty{width:100%;aspect-ratio:16/9;background:var(--cream-dark);display:flex;align-items:center;justify-content:center;font-size:32px}
  .chat-video-info{padding:10px 12px}
  .chat-video-title{font-size:13px;font-weight:600;color:var(--brown);margin-bottom:2px}
  .chat-video-sub{font-size:11px;color:var(--brown-mid)}
  .cv-modal{position:fixed;inset:0;background:rgba(13,37,64,.85);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px}
  .cv-modal-box{background:var(--white);border-radius:16px;overflow:hidden;width:100%;max-width:640px}
  .cv-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--cream-dark)}
  .cv-modal-title{font-size:14px;font-weight:600;color:var(--brown);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px}
  .cv-modal-close{background:none;border:none;font-size:22px;cursor:pointer;color:var(--brown-mid);padding:4px;line-height:1}
  .cv-modal-body{background:#000}
  .cv-modal-body iframe,.cv-modal-body video{display:block;width:100%;aspect-ratio:16/9}
  .video-pill{display:inline-flex;align-items:center;gap:8px;background:var(--orange);color:#fff;border:none;border-radius:20px;padding:10px 16px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px;transition:background 0.15s;box-shadow:0 2px 12px rgba(15,155,255,0.3)}
  .video-pill:hover{background:var(--orange-light)}
  .video-pill-row{display:flex;padding-left:42px;margin-top:-4px}
</style>
</head>
<body>

<!-- ─── GATE ─── -->
<div id="gate">
  <div class="gate-card">
    <img class="gate-logo" id="gateWordmark" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEwODBweCIgaGVpZ2h0PSIyMzFweCIgdmlld0JveD0iNjAgNDg0IDEwODAgMjMxIiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj48ZyBmaWxsPSIjMGI5NmZhIj48cGF0aCBkPSJNIDk3MCw1MjAgQyA5NjIsNTIxIDk1OSw1MjMgOTU5LDUyOSBDIDk2MSw1NDEgOTYyLDU1MiA5NjMsNTY0IEMgOTQ0LDU2NCA5MjUsNTY0IDkwNiw1NjQgQyA5MDIsNTY4IDkwMiw1NzEgOTA2LDU3NSBDIDkyNCw1NzUgOTQyLDU3NiA5NjAsNTc3IEMgOTYzLDU4MSA5NjMsNjA3IDk2Miw2MjAgQyA5NjAsNjIyIDk1OCw2MjMgOTU3LDYyMyBDIDk0MSw2MjMgOTI0LDYyNCA5MDcsMzI0IEMgOTAyLDYyNyA5MDIsNjMxIDkwNSw2MzUgQyA5MjYsNjM1IDk0Nyw2MzYgOTY3LDYzNyBDIDk3MSw2NDEgOTcxLDY3MSA5NzAsNjg3IEMgOTY5LDY4OSA5NjcsNjkxIDk2Nyw2OTEgQyA5MjEsNjkyIDg3Niw2OTIgODMwLDY5MCBDIDgyOSw2ODkgODI4LDU1NSA4MjgsNTU1IEMgODE5LDU2OCA4MDYsNTk3IDgwNiw2MDIgQyA4MjEsNjIxIDgyMyw2MzAgODIxLDY5MSBDIDc5MSw2OTcgNzM5LDY4OCBDIDQ3LDY4MiA3NDMsNjM0IDczNiw2MjUgQyA3MzIsNjI1IDczMiw2MjkgNzI1LDY3NSBBIDQ5OSw2ODIgNjU1LDY3NSBDIDY1Miw2NzMgNjUyLDY2NyA2NTMsNjUyIEMgNjM3LDY2NCA2MTksNjcxIDU5OSw2NzIgQyA1NzQsNjc1IDU1Miw2NzAgNTMxLDY1OCBBIDQ2NSw3MDIgNTM5LDY4MyBDIDUxNCw2OTUgNDY1LDcwMiBDIDQ1OCw3MDAgNDUwLDY2OCBDIDQ0OSw2NjUgNDQ0LDY2NCA0MzQsNjY4IEMgNDM0LDcwMiA0MzMsNzA1IDQzMSw3MDYgQyA0MDUsNzEwIDM1NCw3MTUgQyAzNTIsNzEzIDM1Miw3MDggMzU3LDYyNSBDIDM0NSw2MjYgMzM3LDYzMCAzMzcsNjg0IEMgMzMzLDY5MCAyNjgsNjkwIEMgMjYzLDY4OSAyNjIsNjg0IDI2MCw2MjggQyAyNTksMzI2IDI0Niw2MjUgQyAyMjYsNjIxIDIyNiw2MDUgQyAyMDcsNjA0IDIyNiw2MDUgQyAxNzAsNjAyIEMgMTYxLDU4OSAxNDcsNTg4IEMgMTQ0LDU5MyAxNDUsNTk3IDE1MSw1OTkgQyAxODgsNjA4IDIwNiw2MTQgQyAyMzUsNjI4IDI0NCw2NTAgMjMwLDY4MSBDIDE5Myw3MDYgMTY0LDcxMiAxMDksNzAzIEMgNzQsNjg5IDU4LDY2NCA2MCw2MjggQyA4NCw2MjYgMTMwLDYyOSBDIDEzOCw2NDIgMTQ1LDY0NSAxNTUsNjQyIEMgMTU3LDYzOSAxNTcsNjM3IDE1NCw2MzQgQyAxMzQsNjI3IDEwNCw2MjAgQyA2NCw2MDYgNTUsNTgxIDc0LDU0NSBDIDQ3MCw1MjIgMTQzLDUxOCAxOTAsNTI3IEMgMjA0LDUzMiAyMTYsNTQwIDIyNiw1NTIgQyAyMjYsNTEwIEMgMjc2LDUwNyAzNzAsNTA3IEMgMzc3LDUxNiAzNzIsNTI5IEMgNDA2LDUyNCA0NzMsNTE0IEMgNDc4LDUxNSA0ODIsNTIyIEMgNDk2LDU2MiBDIDUwMSw1MTcgNTI1LDQ5MSA1NjksNDg0IEMgNjA2LDQ4MyA2NDksNTAxIDY2OSw1NDkgQyA2NzIsNTMyIDY3OCw0OTggQyA2ODUcA0093IDc0OCw1MDQgQyA3NTEsNTA4IDc1MSw1MTEgQyA3NDQsNTU2IEMgNzQ5LDU1OSBDIDc2Niw1MTUgQyA3NzYsNTA3IDgyOSw1MTYgQyA4MzMsNTA4IDk2Niw1MDggQyA5NzAsNTExIDk3Miw1MTUgOTcwLDUyMCBaIi8+PC9nPjwvc3ZnPgo=" alt="Stacked">
    <p class="gate-sub">Hospitality tech support, powered by AI</p>
    <h2>Welcome &mdash; let's get you sorted</h2>
    <p>Drop your details below and we'll have you chatting in seconds.</p>
    <input class="gate-input" type="text" id="gateName" placeholder="Your name" autocomplete="given-name">

    <!-- Venue autocomplete -->
    <div class="venue-wrap">
      <input class="gate-input" type="text" id="gateVenueInput" placeholder="Venue / group name" autocomplete="off"
        oninput="handleVenueInput(this.value)" onfocus="handleVenueInput(this.value)" onblur="delayCloseDropdown()">
      <div class="venue-dropdown" id="venueDropdown"></div>
    </div>
    <div class="venue-confirmed" id="venueConfirmed">
      <div class="vc-dot"></div>
      <span id="venueConfirmedName"></span>
      <span class="vc-change" onclick="resetVenue()">Change</span>
    </div>

    <input class="gate-input" type="tel" id="gatePhone" placeholder="Phone number" autocomplete="tel">
    <input class="gate-input" type="email" id="gateEmail" placeholder="Email address" autocomplete="email">
    <div class="gate-error" id="gateError">Please fill in all fields with a valid email.</div>
    <button class="gate-btn" onclick="submitGate()">Start chatting &rarr;</button>
  </div>
</div>

<!-- ─── APP ─── -->
<div id="app">
  <header>
    <a href="https://wearestacked.io" target="_blank" rel="noopener" style="display:flex;flex-direction:column;align-items:flex-start;text-decoration:none;gap:2px;">
      <img class="header-logo" id="headerIcon" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEwODBweCIgaGVpZ2h0PSIyMzFweCIgdmlld0JveD0iNjAgNDg0IDEwODAgMjMxIiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj48ZyBmaWxsPSIjMGI5NmZhIj48cGF0aCBkPSJNIDk3MCw1MjAgQyA5NjIsNTIxIDk1OSw1MjMgOTU5LDUyOSBaIi8+PC9nPjwvc3ZnPgo=" alt="Stacked">
      <span style="font-family:'Righteous',sans-serif;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:var(--orange);padding-left:1px;margin-top:2px;">CHAT</span>
    </a>
    <div class="header-actions">
      <div class="user-chip"><div class="dot"></div><span id="userLabel">You</span></div>
      <button class="icon-btn" onclick="openHistory()" title="Chat history">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/></svg>
      </button>
      <button class="icon-btn" onclick="openTopics()" title="Topics">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </header>

  <div class="logo-strip">
    <div class="logo-track">
      <span class="logo-text">Lightspeed</span><span class="logo-dot"></span>
      <span class="logo-text">Square</span><span class="logo-dot"></span>
      <span class="logo-text">Fourth</span><span class="logo-dot"></span>
      <span class="logo-text">Sky Business</span><span class="logo-dot"></span>
      <span class="logo-text">Deputy</span><span class="logo-dot"></span>
      <span class="logo-text">OpenTable</span><span class="logo-dot"></span>
      <span class="logo-text">Deliverect</span><span class="logo-dot"></span>
      <span class="logo-text">Bizimply</span><span class="logo-dot"></span>
      <span class="logo-text">Tevalis</span><span class="logo-dot"></span>
      <span class="logo-text">Tenzo</span><span class="logo-dot"></span>
      <span class="logo-text">Airship</span><span class="logo-dot"></span>
      <span class="logo-text">Planday</span><span class="logo-dot"></span>
      <span class="logo-text">Crunchtime</span><span class="logo-dot"></span>
      <span class="logo-text">Nory</span><span class="logo-dot"></span>
      <span class="logo-text">Sona</span><span class="logo-dot"></span>
      <span class="logo-text">Stampede</span><span class="logo-dot"></span>
      <span class="logo-text">Apicbase</span><span class="logo-dot"></span>
      <span class="logo-text">Giftpro</span><span class="logo-dot"></span>
      <span class="strip-label">+ 80 more partners</span><span class="logo-dot"></span>
      <span class="logo-text">Lightspeed</span><span class="logo-dot"></span>
      <span class="logo-text">Square</span><span class="logo-dot"></span>
      <span class="logo-text">Fourth</span><span class="logo-dot"></span>
      <span class="logo-text">Sky Business</span><span class="logo-dot"></span>
      <span class="logo-text">Deputy</span><span class="logo-dot"></span>
      <span class="logo-text">OpenTable</span><span class="logo-dot"></span>
      <span class="logo-text">Deliverect</span><span class="logo-dot"></span>
      <span class="logo-text">Bizimply</span><span class="logo-dot"></span>
      <span class="logo-text">Tevalis</span><span class="logo-dot"></span>
      <span class="logo-text">Tenzo</span><span class="logo-dot"></span>
      <span class="logo-text">Airship</span><span class="logo-dot"></span>
      <span class="logo-text">Planday</span><span class="logo-dot"></span>
      <span class="logo-text">Crunchtime</span><span class="logo-dot"></span>
      <span class="logo-text">Nory</span><span class="logo-dot"></span>
      <span class="logo-text">Sona</span><span class="logo-dot"></span>
      <span class="logo-text">Stampede</span><span class="logo-dot"></span>
      <span class="logo-text">Apicbase</span><span class="logo-dot"></span>
      <span class="logo-text">Giftpro</span><span class="logo-dot"></span>
      <span class="strip-label">+ 80 more partners</span><span class="logo-dot"></span>
    </div>
  </div>

  <main>
    <div id="messages">
      <div class="welcome" id="welcome">
        <img class="welcome-wordmark" id="welcomeWordmark" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEwODBweCIgaGVpZ2h0PSIyMzFweCIgdmlld0JveD0iNjAgNDg0IDEwODAgMjMxIiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj48ZyBmaWxsPSIjMGI5NmZhIj48cGF0aCBkPSJNIDk3MCw1MjAgQyA5NjIsNTIxIDk1OSw1MjMgOTU5LDUyOSBaIi8+PC9nPjwvc3ZnPgo=" alt="Stacked">
        <div style="font-family:'Righteous',sans-serif;font-size:22px;letter-spacing:0.05em;text-transform:uppercase;color:var(--orange);margin-top:2px;margin-bottom:8px;">CHAT</div>
        <div class="social-proof"><div class="pulse"></div><span id="socialProofText">Loading&hellip;</span></div>
        <h2>Got a tech problem?<br>Let's fix it.</h2>
        <p id="welcomeVenue">Ask anything about your hospitality tech.</p>
        <div class="predict-section" id="predictSection" style="display:none">
          <div class="predict-label" id="predictLabel">Trending right now</div>
          <div class="predict-grid" id="predictGrid"></div>
        </div>
        <div class="quick-grid" id="quickGrid" style="margin-top:8px;"></div>
        <div class="qr-section" id="qrSection">
          <div class="qr-box" id="qrCode" title="Share this with your team"></div>
          <div class="qr-label">Share with your team &mdash; scan to open</div>
        </div>
      </div>
    </div>
  </main>

  <div class="input-bar">
    <textarea id="input" placeholder="Describe your tech issue&hellip;" rows="1" onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
    <button id="mic" onclick="toggleMic()" title="Voice input">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/></svg>
    </button>
    <button id="send" onclick="sendMessage()" title="Send">
      <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
    </button>
  </div>
</div>

<!-- ─── HISTORY DRAWER ─── -->
<div class="drawer-overlay" id="histOverlay" onclick="closeHistory()"></div>
<div class="drawer" id="histDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Chat history</span><button class="drawer-close" onclick="closeHistory()">&times;</button></div>
  <div class="drawer-body" id="histBody"><div class="empty-history">No previous chats yet.</div></div>
</div>

<!-- ─── TOPICS DRAWER ─── -->
<div class="drawer-overlay" id="topicOverlay" onclick="closeTopics()"></div>
<div class="drawer" id="topicDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Common topics</span><button class="drawer-close" onclick="closeTopics()">&times;</button></div>
  <div class="drawer-body">
    <div class="topics-list">
      <button class="topic-chip" onclick="quickSend('EPOS system frozen or crashed'); closeTopics()">&#x1F4BB; EPOS frozen or crashed</button>
      <button class="topic-chip" onclick="quickSend('Payment terminal offline or not processing'); closeTopics()">&#x1F4B3; Payment terminal issues</button>
      <button class="topic-chip" onclick="quickSend('WiFi or network connectivity problem'); closeTopics()">&#x1F4F6; WiFi / network down</button>
      <button class="topic-chip" onclick="quickSend('Kitchen printer not printing or offline'); closeTopics()">&#x1F5A8;&#xFE0F; Kitchen printer offline</button>
      <button class="topic-chip" onclick="quickSend('Contactless payments not working'); closeTopics()">&#x1F4F1; Contactless not working</button>
      <button class="topic-chip" onclick="quickSend('EPOS running slowly or lagging'); closeTopics()">&#x1F40C; EPOS slow or lagging</button>
      <button class="topic-chip" onclick="quickSend('Staff cannot log in to the system'); closeTopics()">&#x1F512; Login / access issues</button>
      <button class="topic-chip" onclick="quickSend('Card reader not connecting to EPOS'); closeTopics()">&#x1F517; Card reader not connecting</button>
    </div>
  </div>
</div>

<!-- ─── TICKET MODAL ─── -->
<div class="modal-overlay" id="ticketOverlay">
  <div class="modal">
    <h3>Raise a support ticket</h3>
    <p>We'll look into this and get back to you. Add any extra detail below.</p>
    <textarea id="ticketNote" placeholder="Any extra context that might help&hellip;"></textarea>
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeTicket()">Cancel</button>
      <button class="modal-submit" onclick="submitTicket()">Submit ticket</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="cv-modal" id="cvModal" style="display:none" onclick="if(event.target===this)closeCvModal()">
  <div class="cv-modal-box">
    <div class="cv-modal-hdr"><span class="cv-modal-title" id="cvModalTitle"></span><button class="cv-modal-close" onclick="closeCvModal()">&#x2715;</button></div>
    <div class="cv-modal-body" id="cvModalBody"></div>
  </div>
</div>

<script>
// ─── CONFIG ───────────────────────────────────────────────────────────────
const SERVER_URL = 'https://toast-support-bot.onrender.com';
const SUPABASE_URL = 'https://yuzlfocqovwhqdpitvxj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';
const ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iODgiIHZpZXdCb3g9IjAgMCA1NiA4OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNTUuNDE1MiA2Mi45OTM1QzU1LjQzMzQgNjYuNzMxNyA1NC45MDYxIDcwLjA4MDkgNTMuODQwNyA3My4wMzM2QzUyLjc3MTYgNzUuOTkgNTEuMTA5NyA3OC41MjQ2IDQ4Ljg1NTIgODAuNjQxQzQ2LjU5NyA4Mi43NTc0IDQzLjczNTEgODQuMzc5MiA0MC4yNjIzIDg1LjQ5OTJDMzYuNzg5NiA4Ni42MTkyIDMyLjY1NSA4Ny4xOTAyIDI3Ljg2MjIgODcuMjEyQzIzLjA2OTQgODcuMjMwMiAxOC45MTY2IDg2LjY5NTYgMTUuNDExMSA4NS42MDQ3QzExLjkwMiA4NC41MTM4IDkuMDI1NjEgODIuOTE3NCA2Ljc3ODMxIDgwLjgxOTJDNC41MzEwMSA3OC43MjQ2IDIuODU4MjYgNzYuMjAwOSAxLjc2NzM0IDczLjI1NTRDMC42NzY0MjEgNzAuMzEgMC4xMjAwNTEgNjYuOTY4MSAwLjEwNTUwNiA2My4yMjk5TDQuOTgxNDVlLTA1IDQ5Ljk4NjFDLTAuMDA3MjIzIDQ4LjQwNDMgMC43ODE4NzcgNDcuNjExNSAyLjM2MDA4IDQ3LjYwNDJMMTEuOTA1NiA0Ny41NjQyQzEyLjUwOTMgNDguMTYwNiAxMy4xNzExIDQ4LjcwNjEgMTMuODgwMiA0OS4yMDQzQzE1Ljg2OTMgNTAuNTk3IDE4LjI5ODQgNTEuNTI3OSAyMS4xNjc2IDUxLjk5N0MyNC4wMzMxIDUyLjQ2MjUgMjcuMzQyMiA1Mi40MjYxIDMxLjA5MTMgNTEuODgwN0MzNC44NDQxIDUxLjMzNTIgMzguMDE1IDUwLjQzMzQgNDAuNjExNCA0OS4xNzE1QzQxLjY4NzggNDguNjQ3OSA0Mi42NzMzIDQ4LjA2NjEgNDMuNTY3OCA0Ny40Mjk3TDUyLjkzMTYgNDcuMzg5N0M1NC41MTM0IDQ3LjM4MjQgNTUuMzA2MSA0OC4xNjc5IDU1LjMxMzQgNDkuNzQ5N0w1NS40MTUyIDYyLjk5MzVaIiBmaWxsPSIjMEY5QkZGIi8+PHBhdGggZD0iTTQzLjU2OTQgNDcuNDMwN0M0Mi42NzQ4IDQ4LjA2NyA0MS42ODk0IDQ4LjY0ODkgNDAuNjEzIDQ5LjE3MjVDMzguMDE2NiA1MC40MzQzIDM0Ljg0NTcgNTEuMzM2MiAzMS4wOTI5IDUxLjg4MTZDMjcuMzQzOCA1Mi40MjcxIDI0LjAzNDYgNTIuNDYzNCAyMS4xNjkyIDUxLjk5OEMxOC4zIDUxLjUyODkgMTUuODcwOSA1MC41OTggMTMuODgxOCA0OS4yMDUyQzEzLjE3MjcgNDguNzA3IDEyLjUxMDkgNDguMTYxNiAxMS45MDcyIDQ3LjU2NTJMNDMuNTY5NCA0Ny40MzA3WiIgZmlsbD0iIzE0NDI2NCIvPjxwYXRoIGQ9Ik00OS44NjA5IDM3LjkxNjVDNDkuMzUxOCA0MC4zNDU3IDQ4LjMzIDQyLjUxMyA0Ni43OTkxIDQ0LjQyMjFDNDUuOTAwOSA0NS41MzQ4IDQ0LjgyNDUgNDYuNTM4NSA0My41NjYzIDQ3LjQyOTRMMTEuOTA0MSA0Ny41NjM5QzEwLjgwNTkgNDYuNDgzOSA5Ljg3ODYzIDQ1LjI0MDMgOS4xMjIyNiA0My44MzY2QzcuOTQwNDMgNDEuNjQ3NSA3LjEzNjc4IDM5LjA5NDcgNi43MTQ5NiAzNi4xNjc0TDUuMTY5NDkgMjUuODEwOUM0Ljk5MTMgMjQuNTc0NiA1LjUxODU4IDIzLjg2NTUgNi43NTQ5NiAyMy42ODczTDEyLjI2NDEgMjIuODg3M0MxMy4xMjIzIDIzLjUyMzYgMTQuMTAwNSAyNC4wODczIDE1LjE5MTQgMjQuNTc4MkMxNy4yODYgMjUuNTIgMTkuODIwNiAyNi4xNjM3IDIyLjc5ODggMjYuNTEyOEMyNS43NzM0IDI2Ljg1ODIgMjguMzgwNyAyNi44MTQ2IDMwLjYyMDcgMjYuMzgxOUMzMi44NjA3IDI1Ljk0NTUgMzQuNzU4OSAyNS4xNTY0IDM2LjMxODkgMjQuMDE0NkMzNy44NzUzIDIyLjg2OTEgMzkuMDk3MiAyMS40MjE4IDM5Ljk4NDQgMTkuNjY5MUM0MC4xMjYzIDE5LjM4NTQgNDAuMjYwOCAxOS4wOTgxIDQwLjM4MDggMTguOEw0Ni4zMjI3IDE3LjkzODFDNDcuNTU5MSAxNy43NTYzIDQ4LjI2NDUgMTguMjg3MiA0OC40NDY0IDE5LjUyMzZMNDkuOTg4MiAyOS44ODAxQzUwLjQxMzYgMzIuODAzNyA1MC4zNyAzNS40ODM4IDQ5Ljg2MDkgMzcuOTE2NVoiIGZpbGw9IiMwRjlCRkYiLz48cGF0aCBkPSJNNDAuMzgxMyAxOC44MDA4QzQwLjI2MTMgMTkuMDk5IDQwLjEyNjggMTkuMzg2MiAzOS45ODUgMTkuNjY5OUMzOS4wOTc3IDIxLjQyMjYgMzcuODc1OSAyMi44Njk5IDM2LjMxOTUgMjQuMDE1NEMzNC43NTk1IDI1LjE1NzIgMzIuODYxMyAyNS45NDYzIDMwLjYyMTIgMjYuMzgyN0MyOC4zODEyIDI2LjgxNTQgMjUuNzczOSAyNi44NTkxIDIyLjc5OTMgMjYuNTEzNkMxOS44MjExIDI2LjE2NDUgMTcuMjg2NSAyNS41MjA5IDE1LjE5MiAyNC41NzlDMTQuMTAxIDI0LjA4ODEgMTMuMTIyOCAyMy41MjQ1IDEyLjI2NDYgMjIuODg4MUw0MC4zODEzIDE4LjgwMDhaIiBmaWxsPSIjMTQ0MjY0Ii8+PHBhdGggZD0iTTQyLjY1MDQgNS4zMzEyOEw0MS43MTk0IDEzLjU1NjhDNDEuNDkwNCAxNS41MDU5IDQxLjA0NjcgMTcuMjU1MSA0MC4zODEyIDE4LjgwMDVMMTIuMjY0NiAyMi44ODc5QzExLjQ3OTEgMjIuMzA2IDEwLjc4ODIgMjEuNjYyNCAxMC4xOTU0IDIwLjk2MDZDOC45NTkwNyAxOS40OTE0IDguMTExNzggMTcuODAwNSA3LjY1MzYgMTUuODkxNEM3LjE5OTA1IDEzLjk3ODcgNy4xMDgxMyAxMS44NjU5IDcuMzc3MjMgOS41NDIyNEw4LjMwODE1IDEuMzE2NjlDOC40MjQ1MSAwLjMzNDg2MiA4Ljk3MzYxIC0wLjA5Nzg2OTkgOS45NTE4IDAuMDE4NDk1MUw0MS4zNDg1IDMuNjg3NjNDNDIuMzMwNCAzLjgwMDM2IDQyLjc2MzEgNC4zNDk0NSA0Mi42NTA0IDUuMzMxMjhaIiBmaWxsPSIjMEY5QkZGIi8+PC9zdmc+Cg==';

// ─── STATE ────────────────────────────────────────────────────────────────
let user = null;
let messages = [];
let conversationId = null;
let lastBotMsg = '';

// Venue autocomplete state
let selectedVenueId = null;
let selectedVenueName = null;
let selectedIsNew = false;
let venueSearchTimeout = null;
let dropdownBlurTimeout = null;

// ─── INIT ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  renderQuickBtns();
  loadSocialProof();
  loadPredictiveFixes();
  renderQRCode();
  const saved = localStorage.getItem('stacked_user');
  if (saved) {
    user = JSON.parse(saved);
    showApp();
  }
});

// ─── VENUE AUTOCOMPLETE ───────────────────────────────────────────────────
async function handleVenueInput(val) {
  clearTimeout(venueSearchTimeout);
  if (val.length < 2) { closeDropdown(); return; }
  venueSearchTimeout = setTimeout(async () => {
    try {
      const r = await fetch(SERVER_URL + '/venues/search?q=' + encodeURIComponent(val));
      const venues = await r.json();
      showDropdown(venues, val);
    } catch(e) {
      // On error just show create option
      showDropdown([], val);
    }
  }, 220);
}

function showDropdown(venues, query) {
  const dd = document.getElementById('venueDropdown');
  dd.innerHTML = '';

  venues.slice(0, 5).forEach(v => {
    const opt = document.createElement('div');
    opt.className = 'venue-option';
    opt.innerHTML = '<div class="venue-dot"></div><div><strong>' + escHtml(v.name) + '</strong></div>';
    opt.onmousedown = (e) => { e.preventDefault(); selectVenue(v.id, v.name, false); };
    dd.appendChild(opt);
  });

  // Always offer "create new" at the bottom
  const createOpt = document.createElement('div');
  createOpt.className = 'venue-option';
  createOpt.innerHTML = '<div class="venue-dot new"></div><div><strong>Create &ldquo;' + escHtml(query) + '&rdquo;</strong> <span>New venue</span></div>';
  createOpt.onmousedown = (e) => { e.preventDefault(); selectVenue(null, query, true); };
  dd.appendChild(createOpt);

  dd.classList.add('open');
}

function closeDropdown() {
  document.getElementById('venueDropdown').classList.remove('open');
}

function delayCloseDropdown() {
  dropdownBlurTimeout = setTimeout(closeDropdown, 200);
}

function selectVenue(id, name, isNew) {
  clearTimeout(dropdownBlurTimeout);
  selectedVenueId = id;
  selectedVenueName = name;
  selectedIsNew = isNew;

  document.getElementById('gateVenueInput').style.display = 'none';
  closeDropdown();

  const confirmed = document.getElementById('venueConfirmed');
  document.getElementById('venueConfirmedName').textContent = isNew ? '+ ' + name + ' (new venue)' : name;
  confirmed.classList.add('show');
}

function resetVenue() {
  selectedVenueId = null;
  selectedVenueName = null;
  selectedIsNew = false;
  document.getElementById('gateVenueInput').style.display = '';
  document.getElementById('gateVenueInput').value = '';
  document.getElementById('gateVenueInput').focus();
  document.getElementById('venueConfirmed').classList.remove('show');
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── GATE SUBMIT ──────────────────────────────────────────────────────────
async function submitGate() {
  const name = document.getElementById('gateName').value.trim();
  const phone = document.getElementById('gatePhone').value.trim();
  const email = document.getElementById('gateEmail').value.trim();
  const err = document.getElementById('gateError');

  if (!name || !selectedVenueName || !email || !/\\S+@\\S+\\.\\S+/.test(email)) {
    err.textContent = !selectedVenueName
      ? 'Please select or create a venue before continuing.'
      : 'Please fill in all fields with a valid email.';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';

  try {
    // Resolve venue_id: create new venue if needed
    const venueRes = await fetch(SERVER_URL + '/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedVenueId, name: selectedVenueName, isNew: selectedIsNew })
    });
    const venueData = await venueRes.json();
    const venueId = venueData.venue_id;

    user = { name, venue: selectedVenueName, venue_id: venueId, phone, email };
    localStorage.setItem('stacked_user', JSON.stringify(user));

    // Save lead and venue member in parallel
    await Promise.all([
      fetch(SERVER_URL + '/save-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, venue: selectedVenueName, venue_id: venueId, phone, email })
      }),
      fetch(SERVER_URL + '/venue-members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, name, email, phone })
      })
    ]);
  } catch(e) {
    // Fail gracefully - still let them in
    user = { name, venue: selectedVenueName, venue_id: null, phone, email };
    localStorage.setItem('stacked_user', JSON.stringify(user));
  }

  showApp();
}

function showApp() {
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('userLabel').textContent = user.name.split(' ')[0];
  personaliseWelcome();
  loadHistory();
}

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────
async function supabaseSelect(table, filter) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter + '&order=created_at.desc';
  const r = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
  return r.json();
}

// ─── CHAT ─────────────────────────────────────────────────────────────────
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function quickSend(text) { document.getElementById('input').value = text; sendMessage(); }

const ALL_QUICK_BTNS = [
  { emoji: '\\uD83D\\uDCBB', label: 'EPOS crashed', msg: 'My EPOS has crashed mid-service' },
  { emoji: '\\uD83D\\uDCB3', label: 'Payment terminal offline', msg: 'My payment terminal is offline' },
  { emoji: '\\uD83D\\uDCF6', label: 'WiFi down', msg: 'WiFi is down in my venue' },
  { emoji: '\\uD83D\\uDDA8\\uFE0F', label: 'Kitchen printer issue', msg: 'Kitchen printer not receiving orders' },
  { emoji: '\\uD83D\\uDCC5', label: 'Reservation system down', msg: 'My reservation system is not working' },
  { emoji: '\\uD83D\\uDD12', label: "Can't log in", msg: 'Staff cannot log in to the system' },
  { emoji: '\\uD83D\\uDCF1', label: 'Contactless not working', msg: 'Contactless payments not working' },
  { emoji: '\\uD83D\\uDC0C', label: 'EPOS running slow', msg: 'EPOS is running slowly mid-service' },
];

async function loadSocialProof() {
  try {
    const r = await fetch(SERVER_URL + '/analytics');
    const data = await r.json();
    const el = document.getElementById('socialProofText');
    if (el) el.textContent = (data.totalMessages || 0).toLocaleString() + ' issues resolved this month';
  } catch(e) {
    const el = document.getElementById('socialProofText');
    if (el) el.textContent = 'Hospitality tech support, powered by AI';
  }
}

function personaliseWelcome() {
  if (!user) return;
  const el = document.getElementById('welcomeVenue');
  if (el) el.textContent = user.venue ? 'Tech support for ' + user.venue + '.' : 'Ask anything about your hospitality tech.';
}

const TIME_ISSUES = {
  morning:   [{ icon:'\\u2615', text:'Till not opening at start of day', tag:'Common 8-11am' }, { icon:'\\uD83D\\uDCF6', text:'WiFi not connecting for staff', tag:'Morning issue' }],
  lunch:     [{ icon:'\\uD83D\\uDCB3', text:'Payment terminal slow during rush', tag:'Common 12-2pm' }, { icon:'\\uD83D\\uDDA8\\uFE0F', text:'Kitchen printer missing orders', tag:'Rush hour' }],
  afternoon: [{ icon:'\\uD83D\\uDCCB', text:'Reservations not syncing', tag:'Common 2-5pm' }, { icon:'\\uD83D\\uDD12', text:'Staff login issues after shift change', tag:'Afternoon' }],
  evening:   [{ icon:'\\uD83D\\uDCBB', text:'EPOS freezing mid-service', tag:'Common 5-10pm' }, { icon:'\\uD83D\\uDCF1', text:'Contactless not working at table', tag:'Service issue' }],
  latenight: [{ icon:'\\uD83D\\uDD0C', text:'System not closing down properly', tag:'End of night' }, { icon:'\\uD83D\\uDCCA', text:'Reports not generating', tag:'Close of day' }],
};

async function loadPredictiveFixes() {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 5 || day === 6;
  let period = 'morning';
  if (hour >= 12 && hour < 14) period = 'lunch';
  else if (hour >= 14 && hour < 17) period = 'afternoon';
  else if (hour >= 17 && hour < 22) period = 'evening';
  else if (hour >= 22 || hour < 6) period = 'latenight';
  let issues = [...TIME_ISSUES[period]];
  try {
    const r = await fetch(SERVER_URL + '/analytics');
    const data = await r.json();
    if (data.topTopics && data.topTopics.length > 0) {
      const topicMap = { 'epos': { icon:'\\uD83D\\uDCBB', text:'EPOS issues' }, 'payment': { icon:'\\uD83D\\uDCB3', text:'Payment terminal problems' }, 'wifi': { icon:'\\uD83D\\uDCF6', text:'WiFi / network issues' }, 'printer': { icon:'\\uD83D\\uDDA8\\uFE0F', text:'Printer not working' }, 'login': { icon:'\\uD83D\\uDD12', text:'Login / access issues' }, 'reservation': { icon:'\\uD83D\\uDCC5', text:'Reservation system issues' } };
      data.topTopics.slice(0, 2).forEach(topic => {
        const key = Object.keys(topicMap).find(k => topic.toLowerCase().includes(k));
        if (key) issues.unshift({ ...topicMap[key], tag: 'Trending now' });
      });
      issues = issues.slice(0, 3);
    }
  } catch(e) {}
  const label = document.getElementById('predictLabel');
  const grid = document.getElementById('predictGrid');
  const section = document.getElementById('predictSection');
  if (!grid || !section) return;
  if (label) label.textContent = 'Common issues ' + (isWeekend ? 'this weekend' : 'today') + ' \\u00b7 ' + (period === 'evening' ? 'evening service' : period);
  grid.innerHTML = issues.slice(0,3).map(i =>
    '<button class="predict-btn" onclick="quickSend(\\'' + i.text.replace(/'/g,"\\'") + '\\')">' +
    '<span class="predict-icon">' + i.icon + '</span><span>' + i.text + '</span>' +
    '<span class="predict-tag">' + i.tag + '</span></button>'
  ).join('');
  section.style.display = 'block';
}

function renderQRCode() {
  const el = document.getElementById('qrCode');
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text: window.location.href.split('?')[0], width: 96, height: 96, colorDark: '#0d2540', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function renderQuickBtns() {
  const grid = document.getElementById('quickGrid');
  if (!grid) return;
  const shuffled = [...ALL_QUICK_BTNS].sort(() => Math.random() - 0.5).slice(0, 4);
  grid.innerHTML = shuffled.map(b =>
    '<button class="quick-btn" onclick="quickSend(\\'' + b.msg.replace(/'/g,"\\'") + '\\')">' +
    '<span class="emoji">' + b.emoji + '</span>' + b.label + '</button>'
  ).join('');
}

let recognition = null;
let isListening = false;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function toggleMic() {
  const mic = document.getElementById('mic');
  const input = document.getElementById('input');
  if (isIOS) { input.focus(); showToast('Tap the \\uD83C\\uDFA4 mic on your keyboard to speak'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { input.focus(); showToast('Tap the \\uD83C\\uDFA4 mic on your keyboard to speak'); return; }
  if (isListening) { recognition?.stop(); return; }
  recognition = new SR();
  recognition.lang = 'en-GB'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  recognition.onstart = () => { isListening = true; mic.classList.add('listening'); };
  recognition.onresult = (e) => { input.value = e.results[0][0].transcript; autoResize(input); };
  recognition.onend = () => { isListening = false; mic.classList.remove('listening'); };
  recognition.onerror = () => { isListening = false; mic.classList.remove('listening'); showToast('Could not hear anything \\u2014 try again'); };
  recognition.start();
}

async function sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;
  hideWelcome();
  input.value = ''; input.style.height = 'auto';
  document.getElementById('send').disabled = true;
  addMessage('user', text);
  messages.push({ role: 'user', content: text });
  const typing = addTyping();
  try {
    const res = await fetch(SERVER_URL + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: messages.slice(-10), venue: user?.venue, venue_id: user?.venue_id, userName: user?.name })
    });
    const data = await res.json();
    const reply = data.response || "Sorry, I couldn't get a response. Please try again.";
    lastBotMsg = reply;
    typing.remove();
    let videoData = null, displayReply = reply;
    const vtagStart = reply.indexOf('[STACKEDVIDEO:');
    if (vtagStart > -1) {
      const vtagEnd = reply.indexOf(']', vtagStart);
      if (vtagEnd > -1) { try { videoData = JSON.parse(reply.substring(vtagStart + 14, vtagEnd)); } catch(e) {} displayReply = reply.substring(0, vtagStart).trim(); }
    }
    addMessage('assistant', displayReply, true, videoData);
    messages.push({ role: 'assistant', content: displayReply });
    await saveConversation();
  } catch(e) {
    typing.remove();
    const errMsg = "I'm having trouble connecting right now. Please try again in a moment.";
    addMessage('assistant', errMsg, true);
    messages.push({ role: 'assistant', content: errMsg });
  }
  document.getElementById('send').disabled = false;
  input.focus();
}

function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.remove(); }

function addMessage(role, content, showTicket, video) {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div'); wrap.className = 'msg ' + role;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  if (role === 'assistant') { const img = document.createElement('img'); img.src = ICON_URL; img.alt = 'S'; avatar.appendChild(img); }
  else { avatar.textContent = (user?.name || 'You')[0].toUpperCase(); avatar.style.background = 'var(--orange)'; avatar.style.color = '#fff'; }
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  if (role === 'assistant') {
    let t = content.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '$1 $2');
    t = t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    t = t.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
    t = t.replace(/(https?:\\/\\/[^\\s<&"]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:var(--orange);font-weight:600;text-decoration:underline;">$1</a>');
    bubble.innerHTML = t;
  } else { bubble.textContent = content; }
  wrap.appendChild(avatar); wrap.appendChild(bubble); msgs.appendChild(wrap);
  if (role === 'assistant') {
    const urlRegex = /https?:\\/\\/[^\\s)>\\]"]+/g;
    const links = [...new Set(content.match(urlRegex) || [])].slice(0, 4);
    if (links.length) {
      const map = {'squareup.com':'\\uD83D\\uDCE6 Square help','sumup.com':'\\uD83D\\uDCB3 SumUp help','zettle.com':'\\uD83D\\uDCB3 Zettle help','worldpay.com':'\\uD83D\\uDCB3 Worldpay help','stripe.com':'\\uD83D\\uDCB3 Stripe help','lightspeedhq.com':'\\uD83D\\uDDA5 Lightspeed help','tevalis.com':'\\uD83D\\uDDA5 Tevalis help','eposnow.com':'\\uD83D\\uDDA5 EPOS Now help','vitamojo.com':'\\uD83C\\uDF7D Vita Mojo help','opentable.com':'\\uD83D\\uDCC5 OpenTable help','resdiary.com':'\\uD83D\\uDCC5 ResDiary help','sevenrooms.com':'\\uD83D\\uDCC5 SevenRooms help','deputy.com':'\\uD83D\\uDCC5 Deputy help','deliverect.com':'\\uD83D\\uDCE6 Deliverect help','nory.ai':'\\uD83E\\uDD16 Nory help','tenzo.io':'\\uD83D\\uDCCA Tenzo help'};
      const label = u => { try { const h = new URL(u).hostname.replace('www.',''); for (const [k,v] of Object.entries(map)) { if (h.includes(k)) return v; } return '\\uD83D\\uDD17 '+h; } catch(e) { return '\\uD83D\\uDD17 Link'; } };
      const lr = document.createElement('div'); lr.className = 'link-row';
      lr.innerHTML = links.map(u => '<a class="link-pill" href="'+u+'" target="_blank" rel="noopener">\\u2197 '+label(u)+'</a>').join('');
      msgs.appendChild(lr);
    }
  }
  if (role === 'assistant' && showTicket) {
    const tr = document.createElement('div'); tr.className = 'ticket-row';
    tr.innerHTML = '<button class="ticket-btn" onclick="openTicket()">\\uD83C\\uDFAB This didn\\'t solve my issue \\u2014 raise a ticket</button>';
    msgs.appendChild(tr);
  }
  if (role === 'assistant' && video) {
    const pr = document.createElement('div'); pr.className = 'video-pill-row';
    const pb = document.createElement('button'); pb.className = 'video-pill';
    pb.textContent = '\\uD83C\\uDFAC We have a video on this \\u2014 tap to watch';
    pb.dataset.v = encodeURIComponent(JSON.stringify(video));
    pb.onclick = function() { openCvModal(this.dataset.v); };
    pr.appendChild(pb); msgs.appendChild(pr);
  }
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function addTyping() {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div'); wrap.className = 'typing-bubble';
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  const img = document.createElement('img'); img.src = ICON_URL; avatar.appendChild(img);
  const dots = document.createElement('div'); dots.className = 'dots';
  dots.innerHTML = '<div class="dot-anim"></div><div class="dot-anim"></div><div class="dot-anim"></div>';
  wrap.appendChild(avatar); wrap.appendChild(dots); msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

async function saveConversation() {
  if (!user || messages.length === 0) return;
  try {
    const payload = conversationId
      ? { id: conversationId, messages }
      : { email: user.email, name: user.name, venue: user.venue, venue_id: user.venue_id || null, messages, updated_at: new Date().toISOString() };
    const r = await fetch(SERVER_URL + '/save-conversation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.id && !conversationId) conversationId = data.id;
  } catch(e) {}
}

async function loadHistory() {
  if (!user) return;
  try {
    // If we have a venue_id, load shared venue history; otherwise personal history
    let filter;
    if (user.venue_id) {
      filter = 'venue_id=eq.' + user.venue_id + '&limit=20';
    } else {
      filter = 'email=eq.' + encodeURIComponent(user.email) + '&limit=20';
    }
    const rows = await supabaseSelect('conversations', filter);
    const body = document.getElementById('histBody');
    if (!rows || rows.length === 0) { body.innerHTML = '<div class="empty-history">No previous chats yet.</div>'; return; }
    body.innerHTML = '';
    rows.forEach(row => {
      const d = new Date(row.updated_at || row.created_at);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const count = (row.messages || []).filter(m => m.role === 'user').length;
      const item = document.createElement('div'); item.className = 'history-item';
      const author = (row.name && row.name !== user.name) ? ' \\u00b7 ' + row.name : '';
      item.innerHTML =
        '<div class="history-date">' + dateStr + author + '</div>' +
        '<div class="history-preview">' + escHtml(row.preview || 'Chat session') + '</div>' +
        '<div class="history-count">' + count + ' message' + (count !== 1 ? 's' : '') + '</div>';
      item.onclick = () => loadConversation(row);
      body.appendChild(item);
    });
  } catch(e) {}
}

function loadConversation(row) {
  closeHistory();
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  conversationId = row.id;
  messages = row.messages || [];
  messages.forEach((m, i) => { const isLast = i === messages.length - 1; addMessage(m.role, m.content, m.role === 'assistant' && isLast); });
}

function openHistory() { loadHistory(); document.getElementById('histOverlay').classList.add('open'); document.getElementById('histDrawer').classList.add('open'); }
function closeHistory() { document.getElementById('histOverlay').classList.remove('open'); document.getElementById('histDrawer').classList.remove('open'); }
function openTopics() { document.getElementById('topicOverlay').classList.add('open'); document.getElementById('topicDrawer').classList.add('open'); }
function closeTopics() { document.getElementById('topicOverlay').classList.remove('open'); document.getElementById('topicDrawer').classList.remove('open'); }
function openTicket() { document.getElementById('ticketNote').value = ''; document.getElementById('ticketOverlay').classList.add('open'); }
function closeTicket() { document.getElementById('ticketOverlay').classList.remove('open'); }

async function submitTicket() {
  const note = document.getElementById('ticketNote').value.trim();
  const issue = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  try {
    await fetch(SERVER_URL + '/save-ticket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, name: user.name, venue: user.venue, venue_id: user.venue_id || null, issue: 'Last question: ' + issue + (note ? '\\n\\nExtra detail: ' + note : ''), conversation: messages, status: 'open' })
    });
    closeTicket();
    showToast('\\u2713 Ticket raised \\u2014 we\\'ll be in touch!', 'green');
  } catch(e) { closeTicket(); showToast('Something went wrong, please try again.'); }
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  setTimeout(() => { t.className = 'toast'; }, 3500);
}

function openCvModal(enc) {
  const v = JSON.parse(decodeURIComponent(enc));
  document.getElementById('cvModalTitle').textContent = v.title || 'Video';
  const body = document.getElementById('cvModalBody');
  while(body.firstChild) body.removeChild(body.firstChild);
  if (v.type === 'youtube' && v.yt_id) {
    const ifr = document.createElement('iframe');
    ifr.src = 'https://www.youtube.com/embed/' + v.yt_id + '?autoplay=1&rel=0';
    ifr.frameBorder = '0'; ifr.allowFullscreen = true;
    ifr.setAttribute('allow','autoplay;encrypted-media;fullscreen');
    ifr.style.cssText = 'display:block;width:100%;aspect-ratio:16/9';
    body.appendChild(ifr);
  } else {
    const vid = document.createElement('video'); vid.src = v.url; vid.controls = true; vid.autoplay = true;
    vid.style.cssText = 'width:100%;aspect-ratio:16/9'; body.appendChild(vid);
  }
  document.getElementById('cvModal').style.display = 'flex';
}

function closeCvModal() {
  document.getElementById('cvModal').style.display = 'none';
  const b = document.getElementById('cvModalBody'); while(b.firstChild) b.removeChild(b.firstChild);
}
</script>
</body>
</html>`;

// ─── ADMIN PAGE ────────────────────────────────────────────────────────────
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iODgiIHZpZXdCb3g9IjAgMCA1NiA4OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNTUuNDE1MiA2Mi45OTM1QzU1LjQzMzQgNjYuNzMxNyA1NC45MDYxIDcwLjA4MDkgNTMuODQwNyA3My4wMzM2QzUyLjc3MTYgNzUuOTkgNTEuMTA5NyA3OC41MjQ2IDQ4Ljg1NTIgODAuNjQxQzQ2LjU5NyA4Mi43NTc0IDQzLjczNTEgODQuMzc5MiA0MC4yNjIzIDg1LjQ5OTJDMzYuNzg5NiA4Ni42MTkyIDMyLjY1NSA4Ny4xOTAyIDI3Ljg2MjIgODcuMjEyQzIzLjA2OTQgODcuMjMwMiAxOC45MTY2IDg2LjY5NTYgMTUuNDExMSA4NS42MDQ3QzExLjkwMiA4NC41MTM4IDkuMDI1NjEgODIuOTE3NCA2Ljc3ODMxIDgwLjgxOTJDNC41MzEwMSA3OC43MjQ2IDIuODU4MjYgNzYuMjAwOSAxLjc2NzM0IDczLjI1NTRDMC42NzY0MjEgNzAuMzEgMC4xMjAwNTEgNjYuOTY4MSAwLjEwNTUwNiA2My4yMjk5TDQuOTgxNDVlLTA1IDQ5Ljk4NjFDLTAuMDA3MjIzIDQ4LjQwNDMgMC43ODE4NzcgNDcuNjExNSAyLjM2MDA4IDQ3LjYwNDJMMTEuOTA1NiA0Ny41NjQyQzEyLjUwOTMgNDguMTYwNiAxMy4xNzExIDQ4LjcwNjEgMTMuODgwMiA0OS4yMDQzQzE1Ljg2OTMgNTAuNTk3IDE4LjI5ODQgNTEuNTI3OSAyMS4xNjc2IDUxLjk5N0MyNC4wMzMxIDUyLjQ2MjUgMjcuMzQyMiA1Mi40MjYxIDMxLjA5MTMgNTEuODgwN0MzNC44NDQxIDUxLjMzNTIgMzguMDE1IDUwLjQzMzQgNDAuNjExNCA0OS4xNzE1QzQxLjY4NzggNDguNjQ3OSA0Mi42NzMzIDQ4LjA2NjEgNDMuNTY3OCA0Ny40Mjk3TDUyLjkzMTYgNDcuMzg5N0M1NC41MTM0IDQ3LjM4MjQgNTUuMzA2MSA0OC4xNjc5IDU1LjMxMzQgNDkuNzQ5N0w1NS40MTUyIDYyLjk5MzVaIiBmaWxsPSIjMEY5QkZGIi8+PC9zdmc+Cg==">
<title>Stacked Chat &mdash; Admin</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--blue:#0F9BFF;--bg:#f8fafc;--surface:#ffffff;--surface2:#f1f5f9;--border:#e2e8f0;--border2:#cbd5e1;--text:#0f172a;--text2:#475569;--text3:#94a3b8;--green:#16a34a;--red:#dc2626;}
body{background:var(--bg);font-family:'Inter',system-ui,sans-serif;color:var(--text);font-size:14px;line-height:1.5;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:100}
.header-left{display:flex;align-items:center;gap:16px}
.wordmark{height:32px;max-width:200px;object-fit:contain}
.divider{width:1px;height:20px;background:var(--border2)}
.header-nav{display:flex;align-items:center;gap:2px}
.nav-item{padding:5px 10px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;border:none;background:none;font-family:inherit;transition:all 0.1s}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.active{background:var(--surface2);color:var(--text);font-weight:600}
.header-right{display:flex;align-items:center;gap:10px}
.update-text{font-size:12px;color:var(--text3)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-family:inherit;transition:all 0.1s}
.btn:hover{border-color:var(--blue);color:var(--blue)}
.btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.btn-primary:hover{background:#0d8ae6;border-color:#0d8ae6;color:#fff}
.container{max-width:1280px;margin:0 auto;padding:24px}
.page-header{margin-bottom:20px;display:flex;align-items:center;justify-content:space-between}
.page-title{font-size:18px;font-weight:600;color:var(--text)}
.page-sub{font-size:13px;color:var(--text3);margin-top:2px}
.tab-panel{display:none}.tab-panel.active{display:block}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 20px}
.kpi-label{font-size:12px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px}
.kpi-value{font-size:28px;font-weight:700;color:var(--text);line-height:1;letter-spacing:-0.5px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.grid-2,.kpi-grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.card-title{font-size:13px;font-weight:600;color:var(--text)}
.card-meta{font-size:12px;color:var(--text3)}
.data-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}
.data-row:last-child{border-bottom:none}
.rank{font-size:11px;font-weight:600;color:var(--text3);width:20px;flex-shrink:0;text-align:right}
.rank.hi{color:var(--blue)}
.data-label{font-size:13px;font-weight:500;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}
.bar-outer{width:80px;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;flex-shrink:0}
.bar-inner{height:100%;border-radius:2px;background:var(--blue);transition:width 0.6s ease}
.bar-inner.alt{background:#64748b}
.data-count{font-size:12px;font-weight:600;color:var(--text2);width:24px;text-align:right;flex-shrink:0}
.chart-wrap{position:relative;height:200px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead tr{border-bottom:1px solid var(--border)}
th{text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text2);vertical-align:top}
tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--surface2)}
.td-primary{color:var(--text);font-weight:500}
.td-muted{font-size:12px;color:var(--text3);margin-top:2px}
.td-truncate{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.02em}
.badge.open{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.badge.closed{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.close-btn{padding:4px 10px;font-size:11px;font-weight:600;border-radius:4px;border:1px solid var(--green);color:var(--green);background:none;cursor:pointer;font-family:inherit;transition:all 0.1s}
.close-btn:hover{background:var(--green);color:#fff}
.conv-item{padding:10px 0;border-bottom:1px solid var(--border)}
.conv-item:last-child{border-bottom:none}
.conv-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.conv-name{font-size:13px;font-weight:600;color:var(--text)}
.conv-venue{font-size:11px;background:var(--surface2);color:var(--text3);padding:1px 7px;border-radius:4px;border:1px solid var(--border)}
.conv-date{font-size:11px;color:var(--text3);margin-left:auto}
.conv-preview{font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drop-zone{border:1px dashed var(--border2);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all 0.15s}
.drop-zone:hover,.drop-zone.dragging{border-color:var(--blue);background:#f0f9ff}
.drop-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;margin-top:8px}
.drop-sub{font-size:12px;color:var(--text3)}
.doc-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
.doc-row:last-child{border-bottom:none}
.doc-left{display:flex;align-items:center;gap:10px}
.doc-icon{width:28px;height:28px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.doc-name{font-size:13px;font-weight:500;color:var(--text)}
.doc-date{font-size:11px;color:var(--text3);margin-top:1px}
.doc-right{display:flex;align-items:center;gap:8px}
.badge-indexed{font-size:11px;font-weight:600;color:var(--green);background:#dcfce7;border:1px solid #bbf7d0;padding:2px 8px;border-radius:4px}
.btn-del{padding:4px 10px;font-size:11px;font-weight:500;border:1px solid var(--border2);border-radius:4px;background:none;color:var(--text3);cursor:pointer;font-family:inherit;transition:all 0.1s}
.btn-del:hover{border-color:var(--red);color:var(--red)}
.upload-item{padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;margin-bottom:6px;border:1px solid var(--border)}
.prog-wrap{height:3px;background:var(--border);border-radius:2px;margin-top:6px;overflow:hidden}
.prog-bar{height:100%;background:var(--blue);width:0;border-radius:2px;transition:width 0.3s}
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:500;transform:translateY(60px);opacity:0;transition:all 0.25s;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.toast.show{transform:translateY(0);opacity:1}
.toast.green{background:var(--green)}
.toast.red{background:var(--red)}
.empty{text-align:center;padding:32px 16px;color:var(--text3);font-size:13px}
.shimmer{display:inline-block;height:28px;width:48px;background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200%;animation:shimmer 1.2s infinite;border-radius:4px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.video-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.video-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:box-shadow .15s}
.video-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
.video-drop-zone{border:2px dashed var(--border2);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:16px}
.video-drop-zone:hover,.video-drop-zone.drag-over{border-color:var(--blue);background:#f0f9ff}
.video-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block;cursor:pointer}
.video-thumb-empty{width:100%;aspect-ratio:16/9;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer}
.video-info{padding:12px}
.video-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.video-desc{font-size:11px;color:var(--text3);margin-bottom:8px}
.video-footer{display:flex;align-items:center;justify-content:space-between}
.vbadge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase}
.vbadge.youtube{background:#fee2e2;color:#dc2626}.vbadge.mp4{background:#dbeafe;color:#1d4ed8}
.vmodal{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
.vmodal-box{background:var(--surface);border-radius:12px;overflow:hidden;width:100%;max-width:860px}
.vmodal-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)}
.vmodal-title{font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px}
.vmodal-close{background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:4px 8px;line-height:1}
.vmodal-body{background:#000}
.vmodal-body iframe,.vmodal-body video{display:block;width:100%;aspect-ratio:16/9}
</style>
</head>
<body>
<header>
  <div class="header-left">
    <img class="wordmark" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEwODBweCIgaGVpZ2h0PSIyMzFweCIgdmlld0JveD0iNjAgNDg0IDEwODAgMjMxIiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj48ZyBmaWxsPSIjMGI5NmZhIj48cGF0aCBkPSJNIDk3MCw1MjAgQyA5NjIsNTIxIDk1OSw1MjMgOTU5LDUyOSBaIi8+PC9nPjwvc3ZnPgo=" alt="Stacked">
    <div class="divider"></div>
    <nav class="header-nav">
      <button class="nav-item active" onclick="showTab('dashboard')">Dashboard</button>
      <button class="nav-item" onclick="showTab('tickets')">Tickets</button>
      <button class="nav-item" onclick="showTab('conversations')">Conversations</button>
      <button class="nav-item" onclick="showTab('documents')">Knowledge Base</button>
      <button class="nav-item" onclick="showTab('videos')">&#x1F3A5; Videos</button>
    </nav>
  </div>
  <div class="header-right">
    <span class="update-text" id="lastUpdated">&mdash;</span>
    <button class="btn" onclick="loadAnalytics()">&#x21BB; Refresh</button>
  </div>
</header>

<div class="container">
  <div class="tab-panel active" id="tab-dashboard">
    <div class="page-header"><div><div class="page-title">Overview</div><div class="page-sub">All activity across Stacked Chat</div></div></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Conversations</div><div class="kpi-value" id="kpiConvs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Messages sent</div><div class="kpi-value" id="kpiMsgs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Open tickets</div><div class="kpi-value" id="kpiTickets"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Docs indexed</div><div class="kpi-value" id="kpiDocs"><span class="shimmer"></span></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Hot topics</span><span class="card-meta">Most frequent</span></div><div id="hotTopics"><div class="empty">No data yet</div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Top products mentioned</span><span class="card-meta">Top 10</span></div><div id="topProducts"><div class="empty">No data yet</div></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Messages by day</span></div><div class="chart-wrap"><canvas id="actChart"></canvas></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Issue categories</span></div><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Recent conversations</span><button class="btn" onclick="showTab('conversations')">View all &rarr;</button></div><div id="recentConvs"><div class="empty">No conversations yet</div></div></div>
  </div>

  <div class="tab-panel" id="tab-tickets">
    <div class="page-header"><div><div class="page-title">Support tickets</div><div class="page-sub" id="ticketCount">&mdash;</div></div></div>
    <div class="card"><div id="ticketsTable"><div class="empty">Loading...</div></div></div>
  </div>

  <div class="tab-panel" id="tab-conversations">
    <div class="page-header"><div><div class="page-title">Conversations</div><div class="page-sub" id="convCount">&mdash;</div></div></div>
    <div class="card"><div id="convsTable"><div class="empty">Loading...</div></div></div>
  </div>

  <div class="tab-panel" id="tab-documents">
    <div class="page-header"><div><div class="page-title">Knowledge Base</div><div class="page-sub">Documents indexed for AI responses</div></div></div>
    <div class="card">
      <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropFiles(event)">
        <div style="font-size:28px">&#x1F4C4;</div>
        <div class="drop-title">Drop files to index</div>
        <div class="drop-sub">Supports .txt and .md &mdash; up to 10MB each</div>
      </div>
      <input type="file" id="fileInput" multiple accept=".txt,.md" style="display:none" onchange="handleFiles(this.files)">
      <div id="uploadList" style="margin-top:12px"></div>
      <div style="margin-top:16px;margin-bottom:8px;display:flex;gap:8px">
        <input type="text" id="docSearch" placeholder="Search knowledge base..." oninput="filterDocs(this.value)" style="flex:1;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg);outline:none">
        <span id="docCount" style="font-size:12px;color:var(--text3);white-space:nowrap;align-self:center"></span>
      </div>
      <div id="docList" style="margin-top:12px"><div class="empty">Loading documents...</div></div>
    </div>
  </div>

  <div class="tab-panel" id="tab-videos">
    <div class="page-header"><div><div class="page-title">Video Library</div><div class="page-sub">Videos surfaced in chat when relevant</div></div></div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-header"><span class="card-title">Add video</span></div>
      <div class="video-drop-zone" id="videoDrop" ondragover="vDragOver(event)" ondragleave="vDragLeave(event)" ondrop="vDrop(event)" onclick="document.getElementById('videoFileInput').click()">
        <input type="file" id="videoFileInput" accept="video/mp4,video/webm,video/*" style="display:none" onchange="handleVideoFiles(this.files)">
        <div style="font-size:32px">&#x1F3A5;</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:8px">Drag &amp; drop an MP4 here</div>
        <div style="font-size:12px;color:var(--text3)">or click to browse &mdash; or paste a YouTube / MP4 URL below</div>
      </div>
      <div id="videoUploadList"></div>
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <input id="vidUrl" type="url" placeholder="YouTube URL or direct MP4 URL" style="flex:2;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <input id="vidTitle" type="text" placeholder="Title (optional)" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <input id="vidDesc" type="text" placeholder="Keywords (e.g. Square POS setup)" style="flex:1;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <button class="btn btn-primary" id="addVidBtn" onclick="addVideo()">+ Add URL</button>
      </div>
    </div>
    <div id="videoGrid" class="video-grid"><div class="empty">Loading...</div></div>
  </div>
</div>

<div class="vmodal" id="vmodal" style="display:none" onclick="if(event.target===this)closeVModal()">
  <div class="vmodal-box">
    <div class="vmodal-hdr"><span class="vmodal-title" id="vmodalTitle"></span><button class="vmodal-close" onclick="closeVModal()">&#x2715;</button></div>
    <div class="vmodal-body" id="vmodalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
function showTab(id) {
  document.querySelectorAll('.nav-item').forEach((t,i) => t.classList.toggle('active', ['dashboard','tickets','conversations','documents','videos'][i]===id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+id));
  if (id==='videos') loadVideos();
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
let actChart, donutChart;

async function loadAnalytics() {
  try {
    const r = await fetch('/analytics');
    const a = await r.json();
    if (a.error) { notify('Error: '+a.error,'red'); return; }
    document.getElementById('kpiConvs').textContent = (a.totalConvs||0).toLocaleString();
    document.getElementById('kpiMsgs').textContent = (a.totalMessages||0).toLocaleString();
    document.getElementById('kpiTickets').textContent = (a.openTickets||0).toLocaleString();
    document.getElementById('kpiDocs').textContent = (a.totalDocs||0).toLocaleString();
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('ticketCount').textContent = a.tickets.length + ' ticket' + (a.tickets.length!==1?'s':'');
    document.getElementById('convCount').textContent = a.totalConvs + ' conversation' + (a.totalConvs!==1?'s':'');
    const ht = document.getElementById('hotTopics');
    if (!a.topTopics||!a.topTopics.length) { ht.innerHTML='<div class="empty">No data yet</div>'; }
    else { const max=a.topTopics[0][1]; ht.innerHTML=a.topTopics.slice(0,8).map(([t,c],i)=>'<div class="data-row"><span class="rank'+(i<3?' hi':'')+'">'+( i+1)+'</span><span class="data-label">'+esc(t)+'</span><div class="bar-outer"><div class="bar-inner alt" style="width:'+Math.round(c/max*100)+'%"></div></div><span class="data-count">'+c+'</span></div>').join(''); }
    const tp = document.getElementById('topProducts');
    if (!a.topVendors||!a.topVendors.length) { tp.innerHTML='<div class="empty">No product mentions yet</div>'; }
    else { const max=a.topVendors[0][1]; tp.innerHTML=a.topVendors.slice(0,10).map(([v,c],i)=>'<div class="data-row"><span class="rank'+(i<3?' hi':'')+'">'+( i+1)+'</span><span class="data-label">'+esc(v.charAt(0).toUpperCase()+v.slice(1))+'</span><div class="bar-outer"><div class="bar-inner" style="width:'+Math.round(c/max*100)+'%"></div></div><span class="data-count">'+c+'</span></div>').join(''); }
    const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];const counts=[0,0,0,0,0,0,0];
    (a.recentConvs||[]).forEach(c=>{counts[(new Date(c.created_at).getDay()+6)%7]+=(c.messages||[]).filter(m=>m.role==='user').length;});
    if(actChart)actChart.destroy();
    actChart=new Chart(document.getElementById('actChart').getContext('2d'),{type:'bar',data:{labels:days,datasets:[{data:counts,backgroundColor:'rgba(15,155,255,0.12)',borderColor:'#0F9BFF',borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#f1f5f9'},ticks:{color:'#94a3b8',font:{family:'Inter',size:11}}},x:{grid:{display:false},ticks:{color:'#94a3b8',font:{family:'Inter',size:11}}}}}});
    const dL=(a.topTopics||[]).slice(0,6).map(([t])=>t.charAt(0).toUpperCase()+t.slice(1));const dC=(a.topTopics||[]).slice(0,6).map(([,c])=>c);
    if(donutChart)donutChart.destroy();
    if(dL.length){donutChart=new Chart(document.getElementById('donutChart').getContext('2d'),{type:'doughnut',data:{labels:dL,datasets:[{data:dC,backgroundColor:['#0F9BFF','#38bdf8','#0284c7','#7dd3fc','#0c4a6e','#64748b'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{position:'right',labels:{font:{family:'Inter',size:11},color:'#475569',padding:10,boxWidth:8,boxHeight:8}}}}});}else{document.getElementById('donutChart').parentElement.innerHTML='<div class="empty">No data yet</div>';}
    const rc=document.getElementById('recentConvs');const convs=(a.recentConvs||[]).slice(0,6);
    if(!convs.length){rc.innerHTML='<div class="empty">No conversations yet</div>';}
    else{rc.innerHTML=convs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;const d=new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});return '<div class="conv-item"><div class="conv-top"><span class="conv-name">'+esc(c.name||'Unknown')+'</span>'+(c.venue?'<span class="conv-venue">'+esc(c.venue)+'</span>':'')+'<span class="conv-date">'+d+' &middot; '+count+' msg'+(count!==1?'s':'')+'</span></div><div class="conv-preview">'+esc((first?.content||'Chat session').substring(0,100))+'</div></div>';}).join('');}
    const tt=document.getElementById('ticketsTable');
    if(!a.tickets.length){tt.innerHTML='<div class="empty">No tickets yet</div>';}
    else{tt.innerHTML='<table><thead><tr><th>User</th><th>Venue</th><th>Issue</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>'+a.tickets.map(t=>'<tr><td><div class="td-primary">'+esc(t.name)+'</div><div class="td-muted">'+esc(t.email)+'</div></td><td>'+esc(t.venue||'&mdash;')+'</td><td class="td-truncate">'+esc(t.issue||'&mdash;')+'</td><td><span class="badge '+(t.status||'open')+'">'+esc(t.status||'open')+'</span></td><td>'+new Date(t.created_at).toLocaleDateString('en-GB')+'</td><td>'+(t.status==='open'?'<button class="close-btn" onclick="closeTicket('+t.id+')">Close</button>':'')+'</td></tr>').join('')+'</tbody></table>';}
    const ct=document.getElementById('convsTable');
    if(!a.recentConvs.length){ct.innerHTML='<div class="empty">No conversations yet</div>';}
    else{ct.innerHTML='<table><thead><tr><th>User</th><th>Venue</th><th>First message</th><th>Msgs</th><th>Date</th></tr></thead><tbody>'+a.recentConvs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;return '<tr><td><div class="td-primary">'+esc(c.name||'Unknown')+'</div></td><td>'+esc(c.venue||'&mdash;')+'</td><td class="td-truncate" style="max-width:300px">'+esc((first?.content||'&mdash;').substring(0,100))+'</td><td>'+count+'</td><td>'+new Date(c.created_at).toLocaleDateString('en-GB')+'</td></tr>';}).join('')+'</tbody></table>';}
    renderDocs(a.docs);
  } catch(e) { notify('Failed: '+e.message,'red'); console.error(e); }
}

var allDocs=[];
function filterDocs(q){var f=q?allDocs.filter(function(d){return d.filename.toLowerCase().includes(q.toLowerCase());}):allDocs;var c=document.getElementById('docCount');if(c)c.textContent=f.length+' / '+allDocs.length+' docs';renderDocList(f);}
function renderDocs(docs){allDocs=docs||[];var c=document.getElementById('docCount');if(c)c.textContent=allDocs.length+' docs';renderDocList(allDocs);}
function renderDocList(docs){const dl=document.getElementById('docList');if(!docs||!docs.length){dl.innerHTML='<div class="empty">No documents uploaded yet</div>';return;}dl.innerHTML=docs.map(d=>{const fn=esc(d.filename),date=new Date(d.created_at).toLocaleDateString('en-GB'),jfn=JSON.stringify(d.filename);return '<div class="doc-row"><div class="doc-left"><div class="doc-icon">&#x1F4C4;</div><div><div class="doc-name">'+fn+'</div><div class="doc-date">'+date+'</div></div></div><div class="doc-right"><span class="badge-indexed">Indexed</span><button class="btn-del" onclick="deleteDoc('+jfn+',this)">Delete</button></div></div>';}).join('');}

async function deleteDoc(fn,btn){if(!confirm('Delete "'+fn+'"?'))return;btn.disabled=true;btn.textContent='Deleting...';try{const r=await fetch('/documents?filename='+encodeURIComponent(fn),{method:'DELETE'});const d=await r.json();if(d.ok){notify(fn+' deleted','green');btn.closest('.doc-row').remove();setTimeout(loadAnalytics,500);}else{notify('Delete failed','red');btn.disabled=false;btn.textContent='Delete';}}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}
async function closeTicket(id){await fetch('/ticket/'+id+'/close',{method:'POST'});notify('Ticket closed','green');loadAnalytics();}
function dragOver(e){e.preventDefault();document.getElementById('dropZone').classList.add('dragging');}
function dragLeave(){document.getElementById('dropZone').classList.remove('dragging');}
function dropFiles(e){e.preventDefault();document.getElementById('dropZone').classList.remove('dragging');handleFiles(e.dataTransfer.files);}
async function handleFiles(files){const ul=document.getElementById('uploadList');for(const file of files){const id='pb_'+file.name.replace(/\\W/g,'');const item=document.createElement('div');item.className='upload-item';item.innerHTML='<div><strong>'+esc(file.name)+'</strong> <span style="color:#94a3b8">'+(file.size/1024).toFixed(0)+' KB</span><div class="prog-wrap"><div class="prog-bar" id="'+id+'"></div></div></div>';ul.appendChild(item);try{const text=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsText(file);});const pb=document.getElementById(id);if(pb)pb.style.width='50%';await fetch('/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,content:text})});if(pb)pb.style.width='100%';item.innerHTML+=' <span style="color:#16a34a;font-size:12px;font-weight:600">&#x2713; Indexed</span>';notify(file.name+' indexed!','green');setTimeout(loadAnalytics,1000);}catch(e){item.innerHTML+=' <span style="color:#dc2626;font-size:12px">Failed</span>';notify('Failed: '+file.name,'red');}}}
function notify(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.className='toast',3500);}

function vDragOver(e){e.preventDefault();document.getElementById('videoDrop').classList.add('drag-over');}
function vDragLeave(){document.getElementById('videoDrop').classList.remove('drag-over');}
function vDrop(e){e.preventDefault();document.getElementById('videoDrop').classList.remove('drag-over');handleVideoFiles(e.dataTransfer.files);}
async function handleVideoFiles(files){const list=document.getElementById('videoUploadList');for(const file of files){if(!file.type.startsWith('video/')){notify('Only video files please','red');continue;}const itemId='vup_'+Date.now();const item=document.createElement('div');item.style.cssText='padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;margin-bottom:6px;border:1px solid var(--border)';item.textContent=file.name;list.appendChild(item);try{const b64=await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=e=>res(e.target.result);reader.onerror=rej;reader.readAsDataURL(file);});const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:b64,title:file.name.replace(/\\.[^.]+$/,''),description:'',type:'mp4',is_upload:true})});const data=await r.json();if(data.ok){notify('Video uploaded!','green');loadVideos();}else{notify('Upload error: '+(data.error||'unknown'),'red');}}catch(e){notify('Upload failed: '+e.message,'red');}}}
async function addVideo(){const u=document.getElementById('vidUrl').value.trim();if(!u){notify('Paste a URL first','red');return;}const t=document.getElementById('vidTitle').value.trim();const d=document.getElementById('vidDesc').value.trim();const btn=document.getElementById('addVidBtn');btn.disabled=true;btn.textContent='Adding...';try{const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,title:t,description:d})});const data=await r.json();if(data.ok){notify('Video added!','green');['vidUrl','vidTitle','vidDesc'].forEach(id=>document.getElementById(id).value='');loadVideos();}else{notify('Error: '+(data.error||'unknown'),'red');}}catch(e){notify('Error: '+e.message,'red');}btn.disabled=false;btn.textContent='+ Add URL';}
async function loadVideos(){var el=document.getElementById('videoGrid');if(!el)return;el.innerHTML='<div class="empty" style="color:var(--text3)">Loading...</div>';try{var r=await fetch('/videos');var vids=await r.json();el.innerHTML='';if(!Array.isArray(vids)||!vids.length){var emp=document.createElement('div');emp.className='empty';emp.textContent='No videos yet.';el.appendChild(emp);return;}vids.forEach(function(v){var card=document.createElement('div');card.className='video-card';var thumbEl;if(v.thumbnail){thumbEl=document.createElement('img');thumbEl.className='video-thumb';thumbEl.src=v.thumbnail;}else{thumbEl=document.createElement('div');thumbEl.className='video-thumb-empty';thumbEl.textContent=v.type==='youtube'?'\\u25b6':'\\uD83C\\uDFAC';}thumbEl.dataset.v=encodeURIComponent(JSON.stringify(v));thumbEl.onclick=function(){playVideoEnc(this.dataset.v);};card.appendChild(thumbEl);var info=document.createElement('div');info.className='video-info';var titleEl=document.createElement('div');titleEl.className='video-title';titleEl.textContent=v.title||'Untitled';info.appendChild(titleEl);if(v.description){var descEl=document.createElement('div');descEl.className='video-desc';descEl.textContent=v.description;info.appendChild(descEl);}var footer=document.createElement('div');footer.className='video-footer';var badge=document.createElement('span');badge.className='vbadge '+(v.type||'mp4');badge.textContent=(v.type||'').toLowerCase()==='youtube'?'YouTube':'MP4';var delBtn=document.createElement('button');delBtn.className='btn-del';delBtn.textContent='Delete';delBtn.dataset.id=v.id;delBtn.onclick=function(){deleteVideo(this.dataset.id,this);};footer.appendChild(badge);footer.appendChild(delBtn);info.appendChild(footer);card.appendChild(info);el.appendChild(card);});}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">Error: '+e.message+'</div>';}}
function playVideoEnc(enc){playVideo(JSON.parse(decodeURIComponent(enc)));}
function playVideo(v){document.getElementById('vmodalTitle').textContent=v.title||'Video';var body=document.getElementById('vmodalBody');while(body.firstChild)body.removeChild(body.firstChild);if(v.type==='youtube'&&v.yt_id){var ifr=document.createElement('iframe');ifr.src='https://www.youtube.com/embed/'+v.yt_id+'?autoplay=1&rel=0';ifr.frameBorder='0';ifr.allowFullscreen=true;ifr.setAttribute('allow','autoplay;encrypted-media;fullscreen');ifr.style.cssText='display:block;width:100%;aspect-ratio:16/9';body.appendChild(ifr);}else{var vid=document.createElement('video');vid.src=v.url;vid.controls=true;vid.autoplay=true;vid.style.cssText='width:100%;aspect-ratio:16/9';body.appendChild(vid);}document.getElementById('vmodal').style.display='flex';}
function closeVModal(){document.getElementById('vmodal').style.display='none';var b=document.getElementById('vmodalBody');while(b.firstChild)b.removeChild(b.firstChild);}
async function deleteVideo(id,btn){if(!confirm('Delete this video?'))return;btn.disabled=true;try{await fetch('/videos/'+id,{method:'DELETE'});notify('Deleted','green');loadVideos();}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}

loadAnalytics();
setInterval(loadAnalytics,60000);
</script>
</body>
</html>`;

const PORT = process.env.PORT || 8080;

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'})); return;
  }

  if (url === '/admin' || url === '/admin/') {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(ADMIN_PAGE); return;
  }

  if (url === '/analytics') {
    const data = await getAnalytics();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(data)); return;
  }

  // ─── VENUE SEARCH ──────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/venues/search')) {
    try {
      const params = new URL(url, 'http://localhost');
      const q = params.searchParams.get('q') || '';
      if (q.length < 2) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify([])); return; }
      // ilike is case-insensitive contains
      const r = await sbFetch('/rest/v1/venues?select=id,name,slug&name=ilike.*' + encodeURIComponent(q) + '*&limit=5', {
        headers: { 'Prefer': 'return=representation' }
      });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── VENUE CREATE / JOIN ───────────────────────────────────────────────
  if (method === 'POST' && url === '/venues') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, name, isNew } = JSON.parse(body);

        // If they picked an existing venue, just return its id
        if (!isNew && id) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: id })); return;
        }

        // Create new venue
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const r = await sbFetch('/rest/v1/venues', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: { name, slug, tech_stack: {} }
        });
        const venue = Array.isArray(r.data) ? r.data[0] : null;
        if (venue && venue.id) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: venue.id, created: true }));
        } else {
          // Venue may already exist with that slug - try to find it
          const existing = await sbFetch('/rest/v1/venues?select=id,name&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
          const found = Array.isArray(existing.data) ? existing.data[0] : null;
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: found ? found.id : null }));
        }
      } catch(e) {
        console.error('[/venues POST]', e.message);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ venue_id: null, error: e.message }));
      }
    }); return;
  }

  // ─── VENUE MEMBERS ─────────────────────────────────────────────────────
  if (method === 'POST' && url === '/venue-members') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        // Upsert on email+venue_id to avoid duplicates
        await sbFetch('/rest/v1/venue_members?on_conflict=email,venue_id', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: payload
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    }); return;
  }

  // ─── TICKET CLOSE ──────────────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/ticket/') && url.endsWith('/close')) {
    const id = url.split('/')[2];
    await sbFetch(`/rest/v1/tickets?id=eq.${id}`, {method:'PATCH', body:{status:'closed'}});
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true})); return;
  }

  // ─── DELETE DOCUMENT ───────────────────────────────────────────────────
  if (method === 'DELETE' && url.startsWith('/documents')) {
    try {
      const params = new URL(url, 'http://localhost');
      const filename = params.searchParams.get('filename');
      if (!filename) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'No filename provided'})); return; }
      const https = require('https');
      const sbUrl = new URL(`${SUPABASE_URL}/rest/v1/documents?filename=eq.${encodeURIComponent(filename)}`);
      const statusCode = await new Promise((resolve, reject) => {
        const req2 = https.request({
          hostname: sbUrl.hostname, path: sbUrl.pathname + sbUrl.search, method: 'DELETE',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
        }, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(r.statusCode));
        });
        req2.on('error', reject); req2.end();
      });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(statusCode === 204 || statusCode === 200 ? {ok:true,deleted:filename} : {ok:false,error:'Supabase returned '+statusCode}));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:e.message}));
    }
    return;
  }

  // ─── UPLOAD DOCUMENT ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/upload') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { filename, content } = JSON.parse(body);
        const chunks = chunkText(content, filename);
        for (const chunk of chunks) await sbFetch('/rest/v1/documents', {method:'POST', body:chunk});
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, chunks:chunks.length}));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE CONVERSATION ─────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-conversation') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        if (payload.id) {
          await sbFetch(`/rest/v1/conversations?id=eq.${payload.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: { messages: payload.messages, updated_at: new Date().toISOString() }
          });
          res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,id:payload.id}));
        } else {
          const r = await sbFetch('/rest/v1/conversations', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: payload
          });
          const id = Array.isArray(r.data) ? r.data?.[0]?.id : null;
          res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, id}));
        }
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE TICKET ───────────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-ticket') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/tickets', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: payload });
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE LEAD ─────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-lead') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/leads', { method: 'POST', body: payload });
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  // ─── CHAT ──────────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { message, history = [], venue, venue_id, userName } = JSON.parse(body);

        // Fetch venue tech stack if we have a venue_id
        let techStackContext = '';
        if (venue_id) {
          try {
            const vr = await sbFetch(`/rest/v1/venues?select=name,tech_stack&id=eq.${venue_id}&limit=1`);
            const venueData = Array.isArray(vr.data) ? vr.data[0] : null;
            if (venueData && venueData.tech_stack && Object.keys(venueData.tech_stack).length > 0) {
              const stack = venueData.tech_stack;
              const stackLines = Object.entries(stack).map(([k,v]) => `- ${k}: ${v}`).join('\n');
              techStackContext = `\n\nVENUE TECH STACK for ${venueData.name}:\n${stackLines}\n\nIMPORTANT: This venue's tech stack is known. Do NOT ask which system they use for any category listed above. Go straight to troubleshooting for their specific product.`;
            }
          } catch(e) { /* proceed without stack context */ }
        }

        const venueContext = venue
          ? `\n\nYou are speaking with ${userName || 'a member of staff'} from ${venue}. Personalise your responses to their venue where relevant.${techStackContext}`
          : techStackContext;

        let docContext = '';
        try {
          const docsR = await sbFetch('/rest/v1/documents?select=filename,content&limit=200');
          if (Array.isArray(docsR.data) && docsR.data.length > 0) {
            const msgLower = message.toLowerCase();
            const msgWords = msgLower.split(/[\s,?!.]+/).filter(w => w.length > 1);
            const relevant = docsR.data.filter(d => {
              const docLower = (d.filename + ' ' + d.content).toLowerCase();
              return msgWords.some(w => w.length > 2 && docLower.includes(w));
            }).slice(0, 6);
            if (relevant.length > 0) {
              docContext = '\n\n=== FROM KNOWLEDGE BASE ===\n' +
                relevant.map(d => `[${d.filename}]\n${d.content.substring(0, 600)}`).join('\n\n');
            }
          }
        } catch(e) { /* no docs */ }

        const systemPrompt = `You are the Stacked Chat assistant — a friendly, direct AI support bot for hospitality operators in the UK. You specialise in hospitality technology troubleshooting.

Your personality:
- Calm under pressure (operators often message you during a crisis)
- Straight to the point — no waffle
- Friendly but efficient
- Use British English

PRODUCT DETECTION — this is critical:
When a user describes a problem but does NOT mention the specific product or brand (e.g. they say "my till is broken" or "payments aren't working" without naming the system), you MUST ask which product they are using before troubleshooting. Ask in a single short friendly question.

EXCEPTION: If the venue's tech stack is provided above, skip asking — you already know their system.

For each category, prompt like this:
- EPOS / till issues → "Which EPOS system are you on? For example Square, Lightspeed, Tevalis, EPOS Now, Vita Mojo, or another?"
- Payment terminal issues → "Which payment terminal are you using? For example Square, SumUp, Zettle, Worldpay, or Stripe?"
- Reservation / booking issues → "Which reservation system are you using? For example OpenTable, ResDiary, SevenRooms, Collins, or another?"
- WiFi / connectivity issues → "Is this the venue's main WiFi or a specific device that won't connect?"

Once you know the product, respond with:
- A single bold line with the fastest fix
- Numbered steps, max 5
- A mid-service workaround if relevant
- The vendor support URL inline

Support URLs:
  Square: https://squareup.com/help/gb
  SumUp: https://help.sumup.com/en-GB
  Lightspeed: https://www.lightspeedhq.com/support/
  Tevalis: https://support.tevalis.com
  Zonal: https://support.zonal.co.uk
  EPOS Now: https://www.eposnow.com/us/resource-hub/
  Vita Mojo: https://support.vitamojo.com
  Worldpay: https://www.worldpay.com/en-gb/support
  Stripe: https://support.stripe.com
  Zettle: https://www.zettle.com/gb/help
  Yoello: https://help.yoello.com
  Nutritics: https://support.nutritics.com
  OpenTable: https://help.opentable.com
  ResDiary: https://support.resdiary.com
  Collins: https://support.designmynight.com
  SevenRooms: https://support.sevenrooms.com
  Deliverect: https://support.deliverect.com
  Deputy: https://support.deputy.com
  Tenzo: https://help.tenzo.io
  Bizimply: https://support.bizimply.com
  Nory: https://support.nory.ai
  Planday: https://support.planday.com

- End with "If this hasn't resolved it, hit 'Raise a ticket' below" if the issue seems complex

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}${docContext}${venueContext}`;

        const messages = history.slice(-8).map(m => ({role:m.role,content:m.content}));
        if (!messages.length || messages[messages.length-1].content !== message) {
          messages.push({role:'user',content:message});
        }

        const https = require('https');
        const apiBody = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages
        });

        const apiRes = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Length': Buffer.byteLength(apiBody)
            }
          }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(JSON.parse(d)));
          });
          r.on('error', reject); r.write(apiBody); r.end();
        });

        const rawReply = apiRes.content?.[0]?.text || 'Sorry, I could not get a response. Please try again.';
        const reply = rawReply.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 $2');

        let relevantVideos = [];
        let finalReply = reply;
        try {
          const vidsR = await sbFetch('/rest/v1/videos?select=*&order=created_at.desc&limit=100');
          if (Array.isArray(vidsR.data) && vidsR.data.length > 0) {
            const explicitly = /video|watch|tutorial|show me|how to|walkthrough|demo|guide/i.test(message);
            const msgWords = message.toLowerCase().split(/\s+/).filter(w=>w.length>3);
            const scored = vidsR.data.map(v => {
              const t = ((v.title||'') + ' ' + (v.description||'')).toLowerCase();
              const hits = msgWords.filter(w=>t.includes(w)).length;
              return { v, hits };
            });
            const best = scored.sort((a,b)=>b.hits-a.hits)[0];
            if (best && (explicitly ? best.hits >= 1 : best.hits >= 2)) {
              relevantVideos = [best.v];
              finalReply = reply + '\n\n[STACKEDVIDEO:' + JSON.stringify(best.v) + ']';
            }
          }
        } catch(e) {}

        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({response:finalReply, videos:relevantVideos}));
      } catch(e) {
        console.error(e);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({response:'Server error. Please try again in a moment.', videos:[]}));
      }
    }); return;
  }

  // ─── YOUTUBE INGEST ────────────────────────────────────────────────────
  if (method === 'POST' && url === '/youtube-ingest') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, {'Content-Type':'application/x-ndjson','Transfer-Encoding':'chunked','Cache-Control':'no-cache'});
      const send = obj => res.write(JSON.stringify(obj) + '\n');
      try {
        const { url: ytUrl } = JSON.parse(body);
        const YTKEY = process.env.YOUTUBE_API_KEY || '';
        const urlObj = new URL(ytUrl);
        const listId = urlObj.searchParams.get('list');
        const videoId = urlObj.searchParams.get('v') || (urlObj.hostname === 'youtu.be' ? urlObj.pathname.slice(1) : null);
        let videoIds = [];
        if (listId && YTKEY) {
          send({type:'progress',pct:5,msg:'Fetching playlist...'});
          videoIds = await fetchPlaylistItems(listId, YTKEY);
          send({type:'progress',pct:15,msg:'Found '+videoIds.length+' videos'});
        } else if (listId && !YTKEY) {
          if (videoId) { videoIds=[videoId]; send({type:'progress',pct:10,msg:'No YOUTUBE_API_KEY - indexing current video only'}); }
          else { send({type:'error',msg:'Playlist requires YOUTUBE_API_KEY in Render env vars.'}); res.end(); return; }
        } else if (videoId) {
          videoIds = [videoId]; send({type:'progress',pct:10,msg:'Single video: '+videoId});
        } else { send({type:'error',msg:'Could not parse video ID from URL'}); res.end(); return; }
        let totalChunks = 0, indexed = 0;
        for (let i = 0; i < videoIds.length; i++) {
          const vid = videoIds[i], pct = Math.round(15 + (i/videoIds.length)*80);
          send({type:'progress',pct,msg:'['+(i+1)+'/'+videoIds.length+'] '+vid+'...'});
          try {
            const {title, transcript} = await fetchYouTubeTranscript(vid);
            if (!transcript || transcript.length < 50) { send({type:'progress',pct,msg:'  Skipped - no captions'}); continue; }
            const filename = (title||vid).substring(0,80) + ' [yt:'+vid+']';
            const chunks = chunkText(transcript, filename);
            for (const chunk of chunks) await sbFetch('/rest/v1/documents', {method:'POST', body:chunk});
            totalChunks += chunks.length; indexed++;
            send({type:'progress',pct,msg:'  OK: "'+(title||vid)+'" - '+chunks.length+' chunks'});
          } catch(e) { send({type:'progress',pct,msg:'  Skipped '+vid+': '+e.message}); }
        }
        send({type:'done', indexed, chunks:totalChunks});
      } catch(e) { send({type:'error',msg:e.message}); }
      res.end();
    }); return;
  }

  // ─── VIDEOS ────────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/videos') {
    try {
      const r = await sbFetch('/rest/v1/videos?select=*&order=created_at.desc&limit=100');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (method === 'POST' && url === '/videos/add') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: videoUrl, title, description, tenant } = JSON.parse(body);
        if (!videoUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No URL'})); return; }
        let type = 'mp4', thumbnail = '', ytId = null;
        const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) { ytId = ytMatch[1]; type = 'youtube'; thumbnail = 'https://img.youtube.com/vi/' + ytId + '/mqdefault.jpg'; }
        const record = { url: videoUrl, title: title || ytId || 'Untitled', description: description || '', type, thumbnail, tenant: tenant || 'stacked', yt_id: ytId || null };
        const r = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: record });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, video: Array.isArray(r.data) ? r.data[0] : r.data }));
      } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  if (method === 'DELETE' && url.startsWith('/videos/')) {
    try {
      const id = url.split('/videos/')[1];
      await sbFetch('/rest/v1/videos?id=eq.' + id, { method: 'DELETE' });
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ─── MAIN CHAT PAGE ────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '')) {
    res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-store'});
    res.end(STACKED_CHAT); return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── UTILITIES ─────────────────────────────────────────────────────────────
function chunkText(text, filename) {
  const chunkSize = 1200;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({filename, content:text.substring(i, i+chunkSize), chunk_index:chunks.length});
  }
  return chunks;
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().replace(/[^a-zA-Z0-9 \-_.,]/g, ' ').replace(/\s+/g,' ').trim() : null;
}

async function fetchPlaylistItems(playlistId, apiKey) {
  const https = require('https'); const ids = []; let pageToken = '';
  do {
    const path = '/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='
      + encodeURIComponent(playlistId) + '&key=' + apiKey + (pageToken ? '&pageToken='+pageToken : '');
    const data = await new Promise((res,rej) => {
      https.request({hostname:'www.googleapis.com',path,method:'GET'},(resp)=>{
        let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});
      }).on('error',rej).end();
    });
    if (data.error) throw new Error('YouTube API: '+data.error.message);
    (data.items||[]).forEach(item => { if (item.contentDetails&&item.contentDetails.videoId) ids.push(item.contentDetails.videoId); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}

async function fetchYouTubeTranscript(videoId) {
  const https = require('https');
  function httpsGet(urlStr, headers, postBody) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, method: postBody ? 'POST' : 'GET', headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
      if (postBody) opts.headers['Content-Length'] = Buffer.byteLength(postBody);
      const req = https.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { return httpsGet(res.headers.location, headers).then(resolve).catch(reject); }
        let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      if (postBody) req.write(postBody);
      req.end();
    });
  }
  function parseXmlTranscript(xml) {
    return xml.replace(/<text[^>]*>/g,' ').replace(/<\/text>/g,' ').replace(/<[^>]+>/g,' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
  }
  let title = videoId;
  try {
    const body = JSON.stringify({ videoId, context: { client: { clientName: 'ANDROID', clientVersion: '17.31.35', androidSdkVersion: 30, hl: 'en', gl: 'GB' } } });
    const resp = await httpsGet('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1fanX9f9kJY8m5xNJkPwOAfGaY', { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '3', 'X-YouTube-Client-Version': '17.31.35' }, body);
    if (resp.status === 200) {
      const data = JSON.parse(resp.body);
      if (data.videoDetails && data.videoDetails.title) title = data.videoDetails.title;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-GB') || tracks[0];
      if (track && track.baseUrl) {
        const xmlResp = await httpsGet(track.baseUrl, {});
        if (xmlResp.status === 200 && xmlResp.body.length > 50) {
          const transcript = parseXmlTranscript(xmlResp.body);
          if (transcript.length > 50) return { title, transcript: '=== ' + title + ' ===\n\n' + transcript };
        }
      }
    }
  } catch(e) {}
  throw new Error('Could not fetch transcript. Try uploading a .txt transcript manually.');
}

server.listen(PORT, () => console.log(`Stacked Chat server running on port ${PORT}`));
