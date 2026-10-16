const http = require('http');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuzlfocqovwhqdpitvxj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';
// Privileged key for SERVER-SIDE data access (bypasses row-level security).
// Server-only: it is never interpolated into a page template or sent to a browser.
// When unset the server falls back to the anon key (legacy behaviour).
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_DATA_KEY = SUPABASE_SERVICE_KEY || SUPABASE_KEY;
// Secrets must come from the environment. There are deliberately no fallback
// defaults: this repo is public, so any default would be a known credential.
// Set STACKED_ADMIN_PASSWORD and CRON_SECRET on Render + Railway. If either is
// missing the server still starts (so deploys never fail on config), but the
// feature that needs it stays switched off (fail closed) until it is set.
const CRON_SECRET = process.env.CRON_SECRET || '';
const ADMIN_PW = process.env.STACKED_ADMIN_PASSWORD || '';
if (!ADMIN_PW) console.error('WARNING: STACKED_ADMIN_PASSWORD is not set. /admin login is DISABLED until it is.');
if (!CRON_SECRET) console.error('WARNING: CRON_SECRET is not set. /cron/digest is DISABLED until it is.');
const crypto = require('crypto');
const ADMIN_TOKEN = ADMIN_PW ? crypto.createHash('sha256').update('sa::' + ADMIN_PW).digest('hex').slice(0, 40) : null;
// Constant-time string compare so secrets can't be guessed via response timing.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function isAdminAuthed(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)sa_admin=([^;]+)/);
  return !!(ADMIN_TOKEN && m && safeEqual(m[1], ADMIN_TOKEN));
}
// Guard for admin-panel-only endpoints. Returns true if the caller may proceed;
// otherwise it has already sent the 401 and the handler must return.
function requireAdmin(req, res) {
  if (isAdminAuthed(req)) return true;
  res.writeHead(401, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ ok: false, error: 'Not authorised' }));
  return false;
}
// Brute-force throttle for the admin login: 8 attempts / 10 min / IP.
const _loginAttempts = new Map();
function loginThrottled(ip) {
  const now = Date.now();
  let r = _loginAttempts.get(ip);
  if (!r || now > r.resetAt) r = { count: 0, resetAt: now + 600_000 };
  r.count++;
  _loginAttempts.set(ip, r);
  return r.count > 8;
}

// ─── SSRF-SAFE FETCH (used by /scrape) ──────────────────────────────────────
// Only http(s), and only to public IPs: blocks loopback, private ranges,
// link-local/cloud-metadata (169.254.x.x) and CGNAT. Redirects are followed by
// hand so every hop is re-validated.
const dns = require('dns').promises;
const net = require('net');
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function assertPublicUrl(u) {
  let parsed;
  try { parsed = new URL(u); } catch (e) { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('That address is not allowed');
  return parsed;
}
async function safeFetch(u, opts = {}, maxRedirects = 5) {
  let current = u;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const r = await fetch(current, { ...opts, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), current).toString();
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects');
}  // venue_id -> { count, resetAt }

function getClientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function sbFetch(path, opts = {}) {
  const https = require('https');
  const url = new URL(`${SUPABASE_URL}${path}`);
  const body = opts.body ? JSON.stringify(opts.body) : null;
  const headers = {
    'apikey': SUPABASE_DATA_KEY,
    'Authorization': `Bearer ${SUPABASE_DATA_KEY}`,
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
    const [convsR, ticketsR, docsR, venuesR, membersR] = await Promise.all([
      sbFetch('/rest/v1/conversations?select=id,email,name,venue,messages,created_at&order=created_at.desc&limit=200'),
      sbFetch('/rest/v1/tickets?select=*&order=created_at.desc&limit=100'),
      sbFetch('/rest/v1/documents?select=filename,created_at&order=created_at.desc&limit=1000'),
      sbFetch('/rest/v1/venues?select=id,name,created_at&order=created_at.asc&limit=1000'),
      sbFetch('/rest/v1/venue_members?select=name,email,phone,venue_id,role,created_at&order=created_at.desc&limit=1000'),
    ]);
    const convs = Array.isArray(convsR.data) ? convsR.data : [];
    const tickets = Array.isArray(ticketsR.data) ? ticketsR.data : [];
    const docs = Array.isArray(docsR.data) ? docsR.data : [];
    const venuesAll = Array.isArray(venuesR.data) ? venuesR.data : [];
    // Sign-ups: derived from venue_members (the reliable source — /save-lead has
    // been silently 400-ing, so the leads table is empty). Join venue name in.
    const venueNameById = {};
    venuesAll.forEach(v => { if (v.id) venueNameById[v.id] = v.name; });
    const membersAll = Array.isArray(membersR.data) ? membersR.data : [];
    const leadsAll = membersAll.map(m => ({
      name: m.name || '',
      email: m.email || '',
      phone: m.phone || '',
      venue: venueNameById[m.venue_id] || '',
      role: m.role || '',
      created_at: m.created_at
    }));
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

    // Build venue stats
    const venueMap = {};
    convs.forEach(c => {
      const vk = c.venue || 'Unknown venue';
      if (!venueMap[vk]) venueMap[vk] = { venue: vk, convs: 0, msgs: 0, lastSeen: c.created_at };
      venueMap[vk].convs++;
      venueMap[vk].msgs += (c.messages || []).filter(m => m.role === 'user').length;
      if (new Date(c.created_at) > new Date(venueMap[vk].lastSeen)) venueMap[vk].lastSeen = c.created_at;
    });
    tickets.forEach(t => {
      const vk = t.venue || 'Unknown venue';
      if (!venueMap[vk]) venueMap[vk] = { venue: vk, convs: 0, msgs: 0, lastSeen: t.created_at };
      if (!venueMap[vk].tickets) venueMap[vk].tickets = 0;
      venueMap[vk].tickets++;
      if (t.escalated) { if (!venueMap[vk].escalated) venueMap[vk].escalated = 0; venueMap[vk].escalated++; }
    });
    const venueStats = Object.values(venueMap).sort((a, b) => b.convs - a.convs);

    // Fetch NPS scores per vendor
    let npsData = [];
    try {
      const npsRows = await sbFetch('/rest/v1/nps_scores?select=vendor,score&limit=2000');
      if (Array.isArray(npsRows.data) && npsRows.data.length) {
        const byVendor = {};
        npsRows.data.forEach(({ vendor, score }) => {
          if (!byVendor[vendor]) byVendor[vendor] = [];
          byVendor[vendor].push(score);
        });
        npsData = Object.entries(byVendor).map(([vendor, scores]) => {
          const promoters = scores.filter(s => s >= 9).length;
          const detractors = scores.filter(s => s <= 6).length;
          const nps = Math.round((promoters / scores.length - detractors / scores.length) * 100);
          const avg = (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1);
          return { vendor, nps, avg, count: scores.length, promoters, detractors };
        }).sort((a, b) => b.nps - a.nps);
      }
    } catch(e) { /* nps_scores table may not exist yet */ }

    // ── Vendor Intelligence: per-partner mentions, conversations, problems,
    //    sample questions + NPS merge. Aggregated & anonymised across venues. ──
    const VENDOR_CATALOG = [
      {n:'Square',cat:'POS',kw:['square']},{n:'Toast',cat:'POS',kw:['toasttab','toast pos','toast support']},
      {n:'Lightspeed',cat:'POS',kw:['lightspeed']},{n:'Zonal',cat:'POS',kw:['zonal']},
      {n:'EPOS Now',cat:'POS',kw:['epos now','eposnow']},{n:'Tevalis',cat:'POS',kw:['tevalis']},
      {n:'ICRTouch',cat:'POS',kw:['icrtouch','touchpoint']},{n:'Vita Mojo',cat:'POS',kw:['vita mojo','vitamojo']},
      {n:'SumUp',cat:'Payments',kw:['sumup']},{n:'Zettle',cat:'Payments',kw:['zettle']},
      {n:'Stripe',cat:'Payments',kw:['stripe']},{n:'Dojo',cat:'Payments',kw:['dojo']},
      {n:'Worldpay',cat:'Payments',kw:['worldpay']},{n:'Adyen',cat:'Payments',kw:['adyen']},
      {n:'Deliveroo',cat:'Delivery',kw:['deliveroo']},{n:'Uber Eats',cat:'Delivery',kw:['uber eats','ubereats']},
      {n:'Just Eat',cat:'Delivery',kw:['just eat','justeat']},{n:'Deliverect',cat:'Delivery',kw:['deliverect']},
      {n:'Flipdish',cat:'Delivery',kw:['flipdish']},{n:'Deputy',cat:'Rotas',kw:['deputy']},
      {n:'Rotaready',cat:'Rotas',kw:['rotaready']},{n:'Workforce.com',cat:'Rotas',kw:['workforce']},
      {n:'Fourth',cat:'Rotas',kw:['fourth hospitality','fourth app']},{n:'Planday',cat:'Rotas',kw:['planday']},
      {n:'S4Labour',cat:'Rotas',kw:['s4labour']},{n:'OpenTable',cat:'Bookings',kw:['opentable']},
      {n:'ResDiary',cat:'Bookings',kw:['resdiary']},{n:'SevenRooms',cat:'Bookings',kw:['sevenrooms']},
      {n:'Resy',cat:'Bookings',kw:['resy']},{n:'Collins',cat:'Bookings',kw:['designmynight','collins']},
      {n:'Crunchtime',cat:'Inventory',kw:['crunchtime']},{n:'Apicbase',cat:'Inventory',kw:['apicbase']},
      {n:'Marketman',cat:'Inventory',kw:['marketman']},{n:'Nutritics',cat:'Inventory',kw:['nutritics']},
      {n:'Tenzo',cat:'Analytics',kw:['tenzo']},{n:'Yumpingo',cat:'Analytics',kw:['yumpingo']},
      {n:'Stampede',cat:'WiFi / Marketing',kw:['stampede']},{n:'Purple WiFi',cat:'WiFi',kw:['purple wifi','purple wi-fi']},
      {n:'Airship',cat:'Loyalty',kw:['airship']}
    ];
    const PROBLEM_TYPES = [
      {label:'Connection / offline',kw:["won't connect","wont connect","not connecting","can't connect","disconnect","offline","dropping","no connection"]},
      {label:'Errors / crashing',kw:['error','crash','frozen','freezing','not working',"isn't working","won't work",'broken','glitch']},
      {label:'Syncing',kw:['sync','out of sync','resync','re-sync']},
      {label:'Printing',kw:['printer','not printing','print issue','kitchen ticket']},
      {label:'Refunds / voids',kw:['refund','void','chargeback']},
      {label:'Login / access',kw:['login','log in','password','locked out',"can't access"]},
      {label:'Reports / end of day',kw:['report','end of day','z-report','reconcile']},
      {label:'Payments / settlement',kw:['declined','settlement','payout','transaction failed']},
      {label:'Menu / setup',kw:['menu','set up','setup','configure','pricing']},
      {label:'Missing orders',kw:['missing order','order not','lost order','orders not']}
    ];
    const convUserMsgs = convs.map(c => (Array.isArray(c.messages)?c.messages:[]).filter(m=>m.role==='user').map(m=>String(m.content||'').toLowerCase()));
    const vendorIntel = VENDOR_CATALOG.map(v => {
      const matched = allMessages.filter(m => v.kw.some(k => m.includes(k)));
      let conversations = 0;
      convUserMsgs.forEach(um => { if (um.some(t => v.kw.some(k => t.includes(k)))) conversations++; });
      const problems = PROBLEM_TYPES
        .map(p => ({ label:p.label, count: matched.filter(m => p.kw.some(k => m.includes(k))).length }))
        .filter(p => p.count>0).sort((a,b)=>b.count-a.count).slice(0,5);
      const samples = matched.slice(0,3).map(m => m.length>150 ? m.slice(0,147)+'…' : m);
      const npsMatch = npsData.find(n => v.kw.some(k => String(n.vendor||'').toLowerCase().includes(k)) || v.n.toLowerCase().includes(String(n.vendor||'').toLowerCase()));
      let nps = null;
      if (npsMatch) {
        const passive = Math.max(0, npsMatch.count - npsMatch.promoters - npsMatch.detractors);
        nps = { avg: npsMatch.avg, count: npsMatch.count, nps: npsMatch.nps, promoters: npsMatch.promoters, passive, detractors: npsMatch.detractors };
      }
      return { vendor:v.n, category:v.cat, mentions: matched.length, conversations, problems, samples, nps };
    }).filter(v => v.mentions>0 || (v.nps && v.nps.count>0))
      .sort((a,b)=> (b.mentions-a.mentions) || ((b.nps?b.nps.count:0)-(a.nps?a.nps.count:0)));

    // ── What operators ask: trending keywords across all questions (Phase 2) ──
    const KW_STOP = new Set(['the','and','for','you','your','our','have','has','had','with','can','could','would','should','this','that','these','those','what','when','where','which','from','they','them','please','need','want','help','about','there','here','just','dont','cant','wont','been','being','some','more','than','then','will','your','into','out','not','but','how','does','did','who','why','use','using','get','got','any','all','its','was','were','are','his','her','their','them','also','like','able','make','made','still','only','very','much','many','well','good','know','say','said','one','two','our','we','i','to','a','an','of','in','on','is','it','my','me','do','if','or','as','at','be','so','up','no','yes','ok','hi','hey','thanks','thank','please','need','want']);
    const wordFreq = {};
    allMessages.forEach(m => { m.split(/[^a-z0-9]+/).forEach(w => { if (w.length>=4 && !KW_STOP.has(w) && !/^\d+$/.test(w)) wordFreq[w] = (wordFreq[w]||0)+1; }); });
    const topKeywords = Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([word,count])=>({word,count}));

    // ── Knowledge Gaps (Phase 3): questions the bot couldn't answer well.
    //    Derived from stored conversations — no schema change needed. ──
    const GAP_PHRASES = ["don't have","do not have","not in the knowledge base","isn't in the","is not in the","couldn't find","could not find","not able to find","can't find","cannot find","hasn't been uploaded","not been uploaded","not been added","an admin can add","not in the library","don't have any","do not have any","i don't have that","not something that's been added"];
    const gaps = [];
    convs.forEach(c => {
      const msgs = Array.isArray(c.messages) ? c.messages : [];
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role !== 'assistant') continue;
        const reply = String(msgs[i].content || '').toLowerCase();
        if (!GAP_PHRASES.some(p => reply.includes(p))) continue;
        let q = null;
        for (let j = i - 1; j >= 0; j--) { if (msgs[j].role === 'user') { q = String(msgs[j].content || '').trim(); break; } }
        if (q && q.length > 2) gaps.push({ question: q.length > 180 ? q.slice(0,177)+'…' : q, when: c.created_at });
      }
    });
    const knowledgeGaps = gaps.slice(-60).reverse();

    // ── Adoption (Phase 4): onboarding over time, active accounts, top venues ──
    const nowMs = Date.now();
    const d30 = nowMs - 30 * 24 * 3600 * 1000;
    const mk = ts => { try { return new Date(ts).toLocaleDateString('en-GB',{month:'short',year:'2-digit'}); } catch(e){ return '—'; } };
    const onboardByMonth = {};
    venuesAll.forEach(v => { const k = mk(v.created_at); onboardByMonth[k] = (onboardByMonth[k]||0)+1; });
    const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth()-i); months.push(d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'})); }
    const onboarding = months.map(m => ({ month: m, count: onboardByMonth[m] || 0 }));
    const newThisMonth = venuesAll.filter(v => new Date(v.created_at).getTime() > d30).length;
    const activeVenues = venueStats.filter(v => new Date(v.lastSeen).getTime() > d30);
    const adoption = {
      totalVenues: venuesAll.length,
      activeCount: activeVenues.length,
      newThisMonth,
      avgQuestionsPerVenue: venueStats.length ? Math.round(allMessages.length / venueStats.length) : 0,
      onboarding,
      topVenues: venueStats.slice(0, 10).map(v => ({ venue: v.venue, convs: v.convs, msgs: v.msgs, lastSeen: v.lastSeen, active: new Date(v.lastSeen).getTime() > d30 }))
    };

    return {
      totalConvs: convs.length, totalMessages: allMessages.length,
      vendorIntel, topKeywords, knowledgeGaps, knowledgeGapCount: gaps.length, adoption, leads: leadsAll,
      openTickets: tickets.filter(t => t.status === 'open').length,
      escalatedTickets: tickets.filter(t => t.escalated).length,
      totalDocs: uniqueDocs.length,
      topTopics, topVendors, recentConvs: convs.slice(0, 10), tickets, docs: uniqueDocs,
      venueStats, npsData
    };
  } catch(e) { console.error('Analytics error:', e); return { error: e.message }; }
}



// ─── ADMIN LOGIN GATE ──────────────────────────────────────────────────────
const ADMIN_LOGIN_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stacked · Team login</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EDEBE5;font-family:system-ui,'Segoe UI',sans-serif;color:#211D18}
  .box{background:#fff;border:1px solid #D6D2C8;border-radius:18px;padding:34px 32px;width:340px;box-shadow:0 8px 30px rgba(0,0,0,.06);text-align:center}
  .em{font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#E64E1A;font-weight:700;margin-bottom:6px}
  h1{font-size:21px;margin:0 0 4px;letter-spacing:-.4px}
  p{font-size:13px;color:#736C61;margin:0 0 20px}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #D6D2C8;border-radius:10px;font-size:15px;margin-bottom:12px;outline:none}
  input:focus{border-color:#E64E1A}
  button{width:100%;padding:12px;background:#E64E1A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#cf4316}
  .err{color:#dc2626;font-size:13px;min-height:18px;margin-top:8px}
</style></head><body>
  <div class="box">
    <div class="em">Stacked · Industry Intelligence</div>
    <h1>Team login</h1>
    <p>This dashboard is for the Stacked team only.</p>
    <input id="pw" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')go()">
    <button onclick="go()">Sign in</button>
    <div class="err" id="err"></div>
  </div>
  <script>
    async function go(){
      const pw=document.getElementById('pw').value;
      const err=document.getElementById('err'); err.textContent='';
      try{
        const r=await fetch('/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
        if(r.ok){ location.href='/admin'; } else { let m='Incorrect password'; try{ const d=await r.json(); if(d&&d.error) m=d.error; }catch(e){} err.textContent=m; }
      }catch(e){ err.textContent='Something went wrong, try again'; }
    }
    document.getElementById('pw').focus();
  </script>
</body></html>`;

// ─── ADMIN PAGE ────────────────────────────────────────────────────────────
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iODgiIHZpZXdCb3g9IjAgMCA1NiA4OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNTUuNDE1MiA2Mi45OTM1QzU1LjQzMzQgNjYuNzMxNyA1NC45MDYxIDcwLjA4MDkgNTMuODQwNyA3My4wMzM2QzUyLjc3MTYgNzUuOTkgNTEuMTA5NyA3OC41MjQ2IDQ4Ljg1NTIgODAuNjQxQzQ2LjU5NyA4Mi43NTc0IDQzLjczNTEgODQuMzc5MiA0MC4yNjIzIDg1LjQ5OTJDMzYuNzg5NiA4Ni42MTkyIDMyLjY1NSA4Ny4xOTAyIDI3Ljg2MjIgODcuMjEyQzIzLjA2OTQgODcuMjMwMiAxOC45MTY2IDg2LjY5NTYgMTUuNDExMSA4NS42MDQ3QzExLjkwMiA4NC41MTM4IDkuMDI1NjEgODIuOTE3NCA2Ljc3ODMxIDgwLjgxOTJDNC41MzEwMSA3OC43MjQ2IDIuODU4MjYgNzYuMjAwOSAxLjc2NzM0IDczLjI1NTRDMC42NzY0MjEgNzAuMzEgMC4xMjAwNTEgNjYuOTY4MSAwLjEwNTUwNiA2My4yMjk5TDQuOTgxNDVlLTA1IDQ5Ljk4NjFDLTAuMDA3MjIzIDQ4LjQwNDMgMC43ODE4NzcgNDcuNjExNSAyLjM2MDA4IDQ3LjYwNDJMMTEuOTA1NiA0Ny41NjQyQzEyLjUwOTMgNDguMTYwNiAxMy4xNzExIDQ4LjcwNjEgMTMuODgwMiA0OS4yMDQzQzE1Ljg2OTMgNTAuNTk3IDE4LjI5ODQgNTEuNTI3OSAyMS4xNjc2IDUxLjk5N0MyNC4wMzMxIDUyLjQ2MjUgMjcuMzQyMiA1Mi40MjYxIDMxLjA5MTMgNTEuODgwN0MzNC44NDQxIDUxLjMzNTIgMzguMDE1IDUwLjQzMzQgNDAuNjExNCA0OS4xNzE1QzQxLjY4NzggNDguNjQ3OSA0Mi42NzMzIDQ4LjA2NjEgNDMuNTY3OCA0Ny40Mjk3TDUyLjkzMTYgNDcuMzg5N0M1NC41MTM0IDQ3LjM4MjQgNTUuMzA2MSA0OC4xNjc5IDU1LjMxMzQgNDkuNzQ5N0w1NS40MTUyIDYyLjk5MzVaIiBmaWxsPSIjRTY1NDNBIi8+PHBhdGggZD0iTTQzLjU2OTQgNDcuNDMwN0M0Mi42NzQ4IDQ4LjA2NyA0MS42ODk0IDQ4LjY0ODkgNDAuNjEzIDQ5LjE3MjVDMzguMDE2NiA1MC40MzQzIDM0Ljg0NTcgNTEuMzM2MiAzMS4wOTI5IDUxLjg4MTZDMjcuMzQzOCA1Mi40MjcxIDI0LjAzNDYgNTIuNDYzNCAyMS4xNjkyIDUxLjk5OEMxOC4zIDUxLjUyODkgMTUuODcwOSA1MC41OTggMTMuODgxOCA0OS4yMDUyQzEzLjE3MjcgNDguNzA3IDEyLjUxMDkgNDguMTYxNiAxMS45MDcyIDQ3LjU2NTJMNDMuNTY5NCA0Ny40MzA3WiIgZmlsbD0iI0I3MzUxRiIvPjxwYXRoIGQ9Ik00OS44NjA5IDM3LjkxNjVDNDkuMzUxOCA0MC4zNDU3IDQ4LjMzIDQyLjUxMyA0Ni43OTkxIDQ0LjQyMjFDNDUuOTAwOSA0NS41MzQ4IDQ0LjgyNDUgNDYuNTM4NSA0My41NjYzIDQ3LjQyOTRMMTEuOTA0MSA0Ny41NjM5QzEwLjgwNTkgNDYuNDgzOSA5Ljg3ODYzIDQ1LjI0MDMgOS4xMjIyNiA0My44MzY2QzcuOTQwNDMgNDEuNjQ3NSA3LjEzNjc4IDM5LjA5NDcgNi43MTQ5NiAzNi4xNjc0TDUuMTY5NDkgMjUuODEwOUM0Ljk5MTMgMjQuNTc0NiA1LjUxODU4IDIzLjg2NTUgNi43NTQ5NiAyMy42ODczTDEyLjI2NDEgMjIuODg3M0MxMy4xMjIzIDIzLjUyMzYgMTQuMTAwNSAyNC4wODczIDE1LjE5MTQgMjQuNTc4MkMxNy4yODYgMjUuNTIgMTkuODIwNiAyNi4xNjM3IDIyLjc5ODggMjYuNTEyOEMyNS43NzM0IDI2Ljg1ODIgMjguMzgwNyAyNi44MTQ2IDMwLjYyMDcgMjYuMzgxOUMzMi44NjA3IDI1Ljk0NTUgMzQuNzU4OSAyNS4xNTY0IDM2LjMxODkgMjQuMDE0NkMzNy44NzUzIDIyLjg2OTEgMzkuMDk3MiAyMS40MjE4IDM5Ljk4NDQgMTkuNjY5MUM0MC4xMjYzIDE5LjM4NTQgNDAuMjYwOCAxOS4wOTgxIDQwLjM4MDggMTguOEw0Ni4zMjI3IDE3LjkzODFDNDcuNTU5MSAxNy43NTYzIDQ4LjI2NDUgMTguMjg3MiA0OC40NDY0IDE5LjUyMzZMNDkuOTg4MiAyOS44ODAxQzUwLjQxMzYgMzIuODAzNyA1MC4zNyAzNS40ODM4IDQ5Ljg2MDkgMzcuOTE2NVoiIGZpbGw9IiNFNjU0M0EiLz48cGF0aCBkPSJNNDAuMzgxMyAxOC44MDA4QzQwLjI2MTMgMTkuMDk5IDQwLjEyNjggMTkuMzg2MiAzOS45ODUgMTkuNjY5OUMzOS4wOTc3IDIxLjQyMjYgMzcuODc1OSAyMi44Njk5IDM2LjMxOTUgMjQuMDE1NEMzNC43NTk1IDI1LjE1NzIgMzIuODYxMyAyNS45NDYzIDMwLjYyMTIgMjYuMzgyN0MyOC4zODEyIDI2LjgxNTQgMjUuNzczOSAyNi44NTkxIDIyLjc5OTMgMjYuNTEzNkMxOS44MjExIDI2LjE2NDUgMTcuMjg2NSAyNS41MjA5IDE1LjE5MiAyNC41NzlDMTQuMTAxIDI0LjA4ODEgMTMuMTIyOCAyMy41MjQ1IDEyLjI2NDYgMjIuODg4MUw0MC4zODEzIDE4LjgwMDhaIiBmaWxsPSIjQjczNTFGIi8+PHBhdGggZD0iTTQyLjY1MDQgNS4zMzEyOEw0MS43MTk0IDEzLjU1NjhDNDEuNDkwNCAxNS41MDU5IDQxLjA0NjcgMTcuMjU1MSA0MC4zODEyIDE4LjgwMDVMMTIuMjY0NiAyMi44ODc5QzExLjQ3OTEgMjIuMzA2IDEwLjc4ODIgMjEuNjYyNCAxMC4xOTU0IDIwLjk2MDZDOC45NTkwNyAxOS40OTE0IDguMTExNzggMTcuODAwNSA3LjY1MzYgMTUuODkxNEM3LjE5OTA1IDEzLjk3ODcgNy4xMDgxMyAxMS44NjU5IDcuMzc3MjMgOS41NDIyNEw4LjMwODE1IDEuMzE2NjlDOC40MjQ1MSAwLjMzNDg2MiA4Ljk3MzYxIC0wLjA5Nzg2OTkgOS45NTE4IDAuMDE4NDk1MUw0MS4zNDg1IDMuNjg3NjNDNDIuMzMwNCAzLjgwMDM2IDQyLjc2MzEgNC4zNDk0NSA0Mi42NTA0IDUuMzMxMjhaIiBmaWxsPSIjRTY1NDNBIi8+PC9zdmc+Cg==">
<title>Stacked Chat &mdash; Admin</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  /* Legacy admin tokens (light theme) */
  --blue:#E8573C;--bg:#EDEBE5;--surface:#ffffff;--surface2:#F5F3EF;--border:#D6D2C8;--border2:#C8C4BA;--text:#1A1A1A;--text2:#6B6867;--text3:#A8A49C;--green:#16a34a;--red:#dc2626;
  /* Stacked design-system tokens — see colors_and_type.css */
  --ink-900:#0A0A0A;--ink-800:#131313;--ink-700:#1D1D1D;
  --fg:#F4EFE6;--fg-muted:#928A7C;--fg-dim:#555048;
  --stacked-orange-500:#E87830;--stacked-orange-700:#A34F15;
  --stacked-green-500:#3BD36F;--stacked-green-700:#1E8A44;
  --stacked-amber-500:#F5A524;--stacked-red-500:#E5484D;
  --stacked-purple-500:#C7B3F2;--stacked-purple-700:#1D1340;
  --font-sans:'Geist',ui-sans-serif,system-ui,sans-serif;
  --font-display:'Fraunces','Fraunces Placeholder',ui-serif,Georgia,serif;
  --font-mono:'Geist Mono',ui-monospace,'SF Mono',monospace;
  --ease:cubic-bezier(0.2,0.8,0.2,1);
}
body{background:var(--bg);font-family:'Inter',system-ui,sans-serif;color:var(--text);font-size:14px;line-height:1.5;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:100}
.header-left{display:flex;align-items:center;gap:16px}
.wordmark{height:32px;max-width:200px;object-fit:contain;filter: brightness(0) saturate(100%) invert(44%) sepia(73%) saturate(700%) hue-rotate(334deg) brightness(107%);}
.divider{width:1px;height:20px;background:var(--border2)}
.header-nav{display:flex;align-items:center;gap:2px}
.nav-item{padding:5px 9px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;border:none;background:none;font-family:inherit;transition:all 0.1s;white-space:nowrap}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.active{background:var(--surface2);color:var(--text);font-weight:600}
.nav-toggle{display:none;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:8px 14px;cursor:pointer;color:var(--text);font-family:inherit;font-size:14px;font-weight:600;align-items:center;justify-content:center;gap:6px;height:38px;flex-shrink:0;transition:all 0.15s;line-height:1}
.nav-toggle:hover{background:#FFF3EE;border-color:var(--blue);color:var(--blue)}
.nav-toggle .x{display:none}
.nav-toggle.open{background:var(--blue);border-color:var(--blue);color:#fff}
.nav-toggle.open .bars{display:none}
.nav-toggle.open .x{display:inline}
.vlb{width:100%;border-collapse:collapse}
.vlb th{text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)}
.vlb th.r,.vlb td.r{text-align:right}
.vlb td{padding:11px 14px;border-bottom:1px solid var(--surface2);font-size:13px;vertical-align:middle}
.vlb tr.vr{cursor:pointer}
.vlb tr.vr:hover{background:var(--surface2)}
.vlb tr.vr.sel{background:#FFF3EE;box-shadow:inset 3px 0 0 var(--blue)}
.npsp{display:inline-block;font-weight:700;font-size:12px;padding:2px 8px;border-radius:20px;font-variant-numeric:tabular-nums}
.npsp.g{background:#E3F3E9;color:#16834a}.npsp.a{background:#FBEFD9;color:#b9750f}.npsp.r{background:#FBE3DF;color:#c0392b}
.blk2{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:700;margin:15px 0 9px}
.vbar{height:8px;background:var(--surface2);border-radius:4px;overflow:hidden}.vbar i{display:block;height:100%;border-radius:4px}
.vq{font-size:12px;color:var(--text2);background:var(--surface2);border-radius:6px;padding:7px 10px;margin-bottom:5px;border-left:2px solid #F8DBCC;line-height:1.4}
.kwcloud{display:flex;flex-wrap:wrap;gap:7px 9px;align-items:center;padding:6px 4px}
.kwchip{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 11px;color:var(--text);line-height:1.2}
.kwchip b{color:var(--blue);font-weight:700;font-size:.8em;margin-left:2px}
.nav-divider{width:1px;height:16px;background:var(--border2);margin:0 4px}
.sub-tab-bar{display:flex;gap:4px;margin:16px 0 20px;border-bottom:1px solid var(--border);padding-bottom:0}
.sub-tab{padding:7px 14px;border-radius:6px 6px 0 0;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;border:1px solid transparent;border-bottom:none;background:none;font-family:inherit;transition:all 0.1s;margin-bottom:-1px}
.sub-tab:hover{color:var(--text);background:var(--surface2)}
.sub-tab.active{background:var(--surface);color:var(--text);font-weight:600;border-color:var(--border);border-bottom-color:var(--surface)}
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
/* ─── Responsive (tablet / mobile) ─── */
@media (max-width: 1024px){
  .container{padding:18px 16px}
  .kpi-grid{grid-template-columns:repeat(2,1fr) !important}
  .grid-2{grid-template-columns:1fr !important}
}
@media (max-width: 900px){
  header{padding:10px 14px;height:auto;min-height:auto;flex-wrap:wrap;gap:8px;position:sticky;top:0}
  .header-left{display:flex !important;align-items:center !important;justify-content:space-between !important;gap:10px;width:100%;min-width:0;flex-wrap:nowrap}
  .header-right{display:flex;justify-content:flex-start;align-items:center;width:100%;gap:8px;font-size:12px}
  .nav-toggle{display:inline-flex !important;flex-shrink:0}
  .divider{display:none}
  .wordmark{height:24px}
  /* nav becomes a dropdown panel below the header, hidden by default */
  .header-nav{display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,0.08);flex-direction:column;align-items:stretch;gap:0;padding:8px 12px 12px;z-index:99}
  .header-nav.open{display:flex}
  .nav-divider{display:none}
  .nav-item{width:100%;text-align:left;padding:11px 14px;font-size:14px;border-radius:8px;font-weight:500;white-space:nowrap}
  .nav-item.active{background:#FFF3EE;color:var(--blue)}
  header{position:sticky;top:0}
  .container{padding:14px 14px 60px}
  .page-header{flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:14px}
  .page-header > .btn,.page-header > button{align-self:stretch}
  .page-title{font-size:18px !important}
  .card{border-radius:12px}
  /* tables that need scrolling get a wrapper with overflow-x */
  .card > div{max-width:100%}
  #signupsTable,#convsTable,#npsTable{overflow-x:auto;-webkit-overflow-scrolling:touch}
  #signupsTable table,#convsTable table,#npsTable table{min-width:560px}
  /* vendor leaderboard + detail panel: stack with inline-style override */
  .tab-panel .grid-2[style*="1.55fr"],.tab-panel .grid-2[style*="1fr 1fr"]{grid-template-columns:1fr !important}
  /* vendor leaderboard fits natively — table responsive, no horizontal scroll */
  #vendorTable{overflow-x:visible}
  #vendorTable .vlb{width:100%;table-layout:auto}
  #vendorTable .vlb th,#vendorTable .vlb td{padding:10px 10px}
  /* detail panel padding tighter on mobile */
  #vendorDetail{padding:0}
  .vbar{height:7px}
}
@media (max-width: 600px){
  .container{padding:12px 10px 60px}
  .kpi-grid{grid-template-columns:1fr 1fr !important;gap:10px}
  .kpi{padding:12px 14px}
  .kpi-value{font-size:22px !important}
  .kpi-label{font-size:10.5px}
  .nav-item{font-size:12px;padding:5px 9px}
  .update-text{display:none}
  .card-header{padding:12px 14px;flex-wrap:wrap;gap:6px}
  .card-title{font-size:13px !important}
  .card-meta{font-size:10px}
  th{font-size:9.5px !important;padding:8px 10px !important}
  /* vendor leaderboard on phone: hide Category + Convos columns, keep Vendor + Mentions + NPS */
  #vendorTable .vlb th:nth-child(2),#vendorTable .vlb td:nth-child(2){display:none}
  #vendorTable .vlb th:nth-child(4),#vendorTable .vlb td:nth-child(4){display:none}
  #vendorTable .vlb th{padding:8px 8px !important}
  #vendorTable .vlb td{padding:11px 8px !important}
  /* vendor detail: tighter NPS rows, smaller labels */
  #vendorDetail{font-size:12px}
  #vendorDetail > div:first-child > div:first-child{font-size:16px !important}
  .blk2{margin:12px 0 7px !important}
  .vq{font-size:11.5px;padding:6px 9px}
  td{padding:9px 10px !important;font-size:12px}
  .kwchip{font-size:11px !important}
  .conv-item{padding:10px 12px}
  /* gaps tab: keep 3 KPIs but smaller */
  #tab-gaps .kpi-grid{grid-template-columns:repeat(3,1fr) !important;gap:6px}
  #tab-gaps .kpi{padding:9px 10px}
  #tab-gaps .kpi-value{font-size:18px !important}
}
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
.badge.escalated{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.close-btn{padding:4px 10px;font-size:11px;font-weight:600;border-radius:4px;border:1px solid var(--green);color:var(--green);background:none;cursor:pointer;font-family:inherit;transition:all 0.1s}
.close-btn:hover{background:var(--green);color:#fff}
.filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.filter-btn{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-family:inherit;transition:all 0.1s}
.filter-btn:hover{border-color:var(--blue);color:var(--blue)}
.filter-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.filter-btn.red-active.active{background:var(--red);border-color:var(--red)}
.kpi.red .kpi-value{color:var(--red)}
.conv-thread{display:none;margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:240px;overflow-y:auto}
.conv-item.open .conv-thread{display:block}
.conv-item{cursor:pointer;padding:10px 0;border-bottom:1px solid var(--border)}
.conv-item:last-child{border-bottom:none}
.thread-msg{display:flex;gap:8px;margin-bottom:8px}
.thread-msg:last-child{margin-bottom:0}
.thread-role{font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);width:44px;flex-shrink:0;padding-top:2px}
.thread-role.user{color:var(--blue)}
.thread-content{font-size:12px;color:var(--text2);line-height:1.5}
.venue-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.venue-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}
.venue-card-name{font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:8px}
.venue-pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text3);border:1px solid var(--border)}
.venue-stats{display:flex;gap:16px;margin-top:8px}
.venue-stat{text-align:center}
.venue-stat-num{font-size:18px;font-weight:700;color:var(--text);line-height:1}
.venue-stat-label{font-size:10px;color:var(--text3);margin-top:2px;text-transform:uppercase;letter-spacing:0.05em}
.venue-last{font-size:11px;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.conv-item{padding:10px 0;border-bottom:1px solid var(--border)}
.conv-item:last-child{border-bottom:none}
.conv-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.conv-name{font-size:13px;font-weight:600;color:var(--text)}
.conv-venue{font-size:11px;background:var(--surface2);color:var(--text3);padding:1px 7px;border-radius:4px;border:1px solid var(--border)}
.conv-date{font-size:11px;color:var(--text3);margin-left:auto}
.conv-preview{font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drop-zone{border:1px dashed var(--border2);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all 0.15s}
.drop-zone:hover,.drop-zone.dragging{border-color:var(--blue);background:#FFF0EE}
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
.video-drop-zone:hover,.video-drop-zone.drag-over{border-color:var(--blue);background:#FFF0EE}
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
    <img class="wordmark" src="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/assets/Stacked%20(3).svg" alt="Stacked">
    <button class="nav-toggle" id="navToggle" onclick="toggleNav()" aria-label="Menu"><span class="bars">&#9776; Menu</span><span class="x">&times; Close</span></button>
    <div class="divider"></div>
    <nav class="header-nav" id="headerNav">
      <button class="nav-item active" onclick="showTab('dashboard')">Dashboard</button>
      <div class="nav-divider"></div>
      <button class="nav-item" onclick="showTab('vendors')">Vendors</button>
      <button class="nav-item" onclick="showTab('questions')">Questions</button>
      <button class="nav-item" onclick="showTab('gaps')">Gaps</button>
      <button class="nav-item" onclick="showTab('adoption')">Adoption</button>
      <div class="nav-divider"></div>
      <button class="nav-item" onclick="showTab('signups')">Sign-ups</button>
      <button class="nav-item" onclick="showTab('conversations')">Conversations</button>
      <button class="nav-item" onclick="showTab('content')">Content</button>
      <div class="nav-divider"></div>
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
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="kpi-label">Conversations</div><div class="kpi-value" id="kpiConvs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Messages sent</div><div class="kpi-value" id="kpiMsgs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Docs indexed</div><div class="kpi-value" id="kpiDocs"><span class="shimmer"></span></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Hot topics</span><span class="card-meta">Most frequent</span></div><div id="hotTopics"><div class="empty">No data yet</div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Top products mentioned</span><span class="card-meta">Top 10</span></div><div id="topProducts"><div class="empty">No data yet</div></div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Product NPS scores</span><span class="card-meta">Operator ratings</span></div><div id="npsTable"><div class="empty">No ratings yet — NPS prompts appear after vendor conversations</div></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Messages by day</span></div><div class="chart-wrap"><canvas id="actChart"></canvas></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Issue categories</span></div><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Recent conversations</span><button class="btn" onclick="showTab('conversations')">View all &rarr;</button></div><div id="recentConvs"><div class="empty">No conversations yet</div></div></div>
  </div>

  <div class="tab-panel" id="tab-vendors">
    <div class="page-header">
      <div><div class="page-title">Vendor Intelligence</div><div class="page-sub">What operators experience across your tech partners &mdash; aggregated &amp; anonymised across all venues</div></div>
      <button class="btn" onclick="exportVendorCSV()">&#x2193; Export CSV</button>
    </div>
    <div class="grid-2" style="grid-template-columns:1.55fr 1fr;align-items:start">
      <div class="card">
        <div class="card-header"><span class="card-title">Tech partner leaderboard</span><span class="card-meta">Ranked by mentions</span></div>
        <div id="vendorTable"><div class="empty">Loading&hellip;</div></div>
      </div>
      <div class="card" style="padding:18px 20px"><div id="vendorDetail"><div class="empty">Select a vendor to drill in</div></div></div>
    </div>
  </div>

  <div class="tab-panel" id="tab-questions">
    <div class="page-header">
      <div><div class="page-title">Operator Questions</div><div class="page-sub">What UK hospitality is asking &mdash; themes &amp; trending terms across all venues, anonymised</div></div>
      <button class="btn" onclick="exportQuestionsCSV()">&#x2193; Export CSV</button>
    </div>
    <div class="grid-2" style="grid-template-columns:1fr 1fr;align-items:start">
      <div class="card">
        <div class="card-header"><span class="card-title">Question themes</span><span class="card-meta">By category</span></div>
        <div id="qThemes"><div class="empty">Loading&hellip;</div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Trending terms</span><span class="card-meta">Most-used words in questions</span></div>
        <div id="qKeywords"><div class="empty">Loading&hellip;</div></div>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="tab-gaps">
    <div class="page-header">
      <div><div class="page-title">Knowledge Gaps</div><div class="page-sub">Questions the bot couldn&rsquo;t fully answer &mdash; your content &amp; product to-do list</div></div>
      <button class="btn" onclick="exportGapsCSV()">&#x2193; Export CSV</button>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="kpi-label">Unanswered questions</div><div class="kpi-value" id="gapTotal"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Of all questions</div><div class="kpi-value" id="gapPct"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Showing</div><div class="kpi-value" id="gapShown"><span class="shimmer"></span></div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Recent unanswered questions</span><span class="card-meta">Add the missing knowledge to close these</span></div>
      <div id="gapsList"><div class="empty">Loading&hellip;</div></div>
    </div>
  </div>

  <div class="tab-panel" id="tab-adoption">
    <div class="page-header">
      <div><div class="page-title">Adoption</div><div class="page-sub">How Stacked Chat is spreading across operators</div></div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="kpi-label">Total venues</div><div class="kpi-value" id="adTotal"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Active (30 days)</div><div class="kpi-value" id="adActive"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">New (30 days)</div><div class="kpi-value" id="adNew"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Avg questions / venue</div><div class="kpi-value" id="adAvg"><span class="shimmer"></span></div></div>
    </div>
    <div class="grid-2" style="align-items:start">
      <div class="card">
        <div class="card-header"><span class="card-title">Venues onboarded</span><span class="card-meta">Last 6 months</span></div>
        <div id="adOnboard"><div class="empty">Loading&hellip;</div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Most active venues</span><span class="card-meta">By messages</span></div>
        <div id="adTopVenues"><div class="empty">Loading&hellip;</div></div>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="tab-signups">
    <div class="page-header">
      <div><div class="page-title">Sign-ups</div><div class="page-sub">Everyone who has signed in to Stacked Chat &mdash; with their contact details</div></div>
      <button class="btn" onclick="exportSignupsCSV()">&#x2193; Export CSV</button>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="kpi-label">Total sign-ups</div><div class="kpi-value" id="suTotal"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Last 30 days</div><div class="kpi-value" id="suRecent"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Most recent</div><div class="kpi-value" id="suLatest" style="font-size:18px;padding-top:4px"><span class="shimmer"></span></div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">All sign-ups</span><span class="card-meta">Newest first</span></div>
      <div id="signupsTable"><div class="empty">Loading&hellip;</div></div>
    </div>
  </div>

  <div class="tab-panel" id="tab-conversations">
    <div class="page-header"><div><div class="page-title">Conversations</div><div class="page-sub" id="convCount">&mdash;</div></div></div>
    <div class="card"><div id="convsTable"><div class="empty">Loading...</div></div></div>
  </div>

  <!-- Branding Modal -->
  <div id="brandingModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px">
    <div style="background:var(--surface);border-radius:12px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border)">
        <div style="font-size:15px;font-weight:600;color:var(--text)">Venue Branding</div>
        <button onclick="closeBrandingModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text3)">&#x2715;</button>
      </div>
      <div style="padding:24px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Venue</label>
          <select id="bVenueSelect" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">Loading venues...</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Logo URL <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3);font-size:11px">— must be a direct image link (.png, .svg, .jpg)</span></label>
          <input id="bLogoUrl" type="url" placeholder="https://logo.clearbit.com/yourdomain.com" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <div id="bLogoUrlError" style="display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:12px;line-height:1.4"></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Link to a PNG or SVG — ideally on a transparent background</div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Brand colour</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="bColorPicker" type="color" value="#E8573C" style="width:44px;height:36px;border:1px solid var(--border2);border-radius:6px;cursor:pointer;padding:2px">
            <input id="bColorHex" type="text" value="#E8573C" placeholder="#E8573C" style="flex:1;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)" oninput="syncColor(this.value)">
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Bot name</label>
          <input id="bBotName" type="text" placeholder="e.g. Roxy — Côte Support" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Welcome message (login screen)</label>
          <input id="bWelcomeMsg" type="text" placeholder="e.g. Your dedicated tech support, powered by AI" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Welcome heading (chat screen)</label>
          <input id="bWelcomeHeading" type="text" placeholder="e.g. What can we fix for you today?" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--surface2);border-radius:6px;border:1px solid var(--border)">
          <input type="checkbox" id="bWhiteLabel" style="width:16px;height:16px;cursor:pointer">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">White-label (hide &ldquo;Powered by Stacked&rdquo;)</div>
            <div style="font-size:11px;color:var(--text3)">Available on Group plan</div>
          </div>
        </div>
        <div id="bPreview" style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface2);display:flex;align-items:center;gap:12px">
          <img id="bPreviewLogo" src="" style="height:28px;max-width:120px;object-fit:contain;display:none">
          <div>
            <div id="bPreviewName" style="font-size:13px;font-weight:600;color:var(--text)">Bot name preview</div>
            <div id="bPreviewUrl" style="font-size:11px;color:var(--text3);margin-top:2px"></div>
          </div>
          <div id="bPreviewSwatch" style="width:28px;height:28px;border-radius:6px;margin-left:auto;flex-shrink:0;background:#E8573C"></div>
        </div>
        <button class="btn btn-primary" id="bSaveBtn" onclick="saveBranding()" style="width:100%;justify-content:center;padding:10px">Save branding</button>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="tab-content">
    <div class="page-header" style="margin-bottom:0">
      <div><div class="page-title">Content</div><div class="page-sub">Videos and knowledge base docs surfaced in chat</div></div>
    </div>
    <div class="sub-tab-bar">
      <button class="sub-tab active" id="stVideos" onclick="showContentTab('videos')">&#x1F3A5; Videos</button>
      <button class="sub-tab" id="stDocs" onclick="showContentTab('documents')">&#x1F4DA; Knowledge Base</button>
    </div>

    <!-- ── VIDEOS PANEL ───────────────────────────────────────────── -->
    <div id="contentVideos">
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">&#x1F4FA; Import from YouTube</span><span class="card-meta">Search by vendor name &mdash; tick &amp; bulk import</span></div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <input id="ytSearch" type="text" placeholder="e.g. Lightspeed Restaurant, Square POS, Deputy App..." style="flex:1;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)" onkeydown="if(event.key==='Enter')searchYouTube()">
          <select id="ytCategory" style="padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">No category</option>
            <option value="epos">EPOS / POS</option>
            <option value="payments">Payments</option>
            <option value="wifi">WiFi / Network</option>
            <option value="printer">Printers / KDS</option>
            <option value="bookings">Bookings / Reservations</option>
            <option value="workforce">Workforce / Rota</option>
            <option value="ordering">Online Ordering</option>
            <option value="loyalty">Loyalty / CRM</option>
            <option value="general">General</option>
          </select>
          <button class="btn btn-primary" id="ytSearchBtn" onclick="searchYouTube()">&#x1F50D; Search</button>
        </div>
        <div id="ytResults" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span id="ytResultCount" style="font-size:12px;color:var(--text3)"></span>
            <div style="display:flex;gap:8px">
              <button class="btn" onclick="ytSelectAll()">Select all</button>
              <button class="btn btn-primary" id="ytImportBtn" onclick="importSelected()" style="display:none">&#x2B07; Import selected (<span id="ytSelCount">0</span>)</button>
            </div>
          </div>
          <div id="ytGrid" class="video-grid"></div>
        </div>
        <div id="ytNoKey" style="display:none;padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:13px;color:#92400e">
          &#x26A0; Add <strong>YOUTUBE_API_KEY</strong> to your Render environment variables to enable YouTube search.
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:#92400e;font-weight:600"> Get a free key &rarr;</a>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">Add single video</span></div>
        <div class="video-drop-zone" id="videoDrop" ondragover="vDragOver(event)" ondragleave="vDragLeave(event)" ondrop="vDrop(event)" onclick="document.getElementById('videoFileInput').click()">
          <input type="file" id="videoFileInput" accept="video/mp4,video/webm,video/*" style="display:none" onchange="handleVideoFiles(this.files)">
          <div style="font-size:32px">&#x1F3A5;</div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:8px">Drag &amp; drop an MP4 here</div>
          <div style="font-size:12px;color:var(--text3)">or click to browse &mdash; or paste a URL below</div>
        </div>
        <div id="videoUploadList"></div>
        <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;margin-top:10px">
          <input id="vidUrl" type="url" placeholder="YouTube URL or direct MP4 URL" style="flex:2;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <input id="vidTitle" type="text" placeholder="Title" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <input id="vidDesc" type="text" placeholder="Keywords (e.g. Square POS setup)" style="flex:1;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <select id="vidCat" style="padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">No category</option>
            <option value="epos">EPOS / POS</option>
            <option value="payments">Payments</option>
            <option value="wifi">WiFi / Network</option>
            <option value="printer">Printers / KDS</option>
            <option value="bookings">Bookings / Reservations</option>
            <option value="workforce">Workforce / Rota</option>
            <option value="ordering">Online Ordering</option>
            <option value="loyalty">Loyalty / CRM</option>
            <option value="general">General</option>
          </select>
          <button class="btn btn-primary" id="addVidBtn" onclick="addVideo()">+ Add</button>
        </div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" onclick="filterVideos('',this)">All</button>
        <button class="filter-btn" onclick="filterVideos('epos',this)">EPOS</button>
        <button class="filter-btn" onclick="filterVideos('payments',this)">Payments</button>
        <button class="filter-btn" onclick="filterVideos('wifi',this)">WiFi</button>
        <button class="filter-btn" onclick="filterVideos('printer',this)">Printers</button>
        <button class="filter-btn" onclick="filterVideos('bookings',this)">Bookings</button>
        <button class="filter-btn" onclick="filterVideos('workforce',this)">Workforce</button>
        <button class="filter-btn" onclick="filterVideos('ordering',this)">Ordering</button>
      </div>
      <div id="videoGrid" class="video-grid"><div class="empty">Loading...</div></div>
    </div>

    <!-- ── KNOWLEDGE BASE PANEL ──────────────────────────────────── -->
    <div id="contentDocs" style="display:none">
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">&#x1F310; Scrape vendor help centres</span><span class="card-meta">Fetch and index docs directly from vendor support sites</span></div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <input id="scrapeUrl" type="url" placeholder="https://help.lightspeedhq.com/hc/en-gb/articles/..." style="flex:2;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <input id="scrapeVendor" type="text" placeholder="Vendor name (e.g. Lightspeed)" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <button class="btn btn-primary" onclick="doScrapeUrl()" id="scrapeBtn">&#x1F4E5; Scrape</button>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Quick scrape &mdash; known vendor help centres <span style="font-weight:400;color:var(--text3)">(uses Zendesk API where available &mdash; up to 150 articles per vendor)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="quickScrapeList">
        <button class="filter-btn" onclick="quickScrape('https://support.lightspeedhq.com/hc/en-gb','Lightspeed Restaurant',this)">Lightspeed</button>
        <button class="filter-btn" onclick="quickScrape('https://squareup.com/help/gb/en/article/5148-getting-started-with-square-for-restaurants','Square',this)">Square</button>
        <button class="filter-btn" onclick="quickScrape('https://support.eposnow.com/hc/en-gb','EPOS Now',this)">EPOS Now</button>
        <button class="filter-btn" onclick="quickScrape('https://help.deputy.com/hc/en-us','Deputy',this)">Deputy</button>
        <button class="filter-btn" onclick="quickScrape('https://support.sevenrooms.com/hc/en-us','SevenRooms',this)">SevenRooms</button>
        <button class="filter-btn" onclick="quickScrape('https://help.opentable.com/hc/en-us','OpenTable',this)">OpenTable</button>
        <button class="filter-btn" onclick="quickScrape('https://support.deliverect.com/hc/en-us','Deliverect',this)">Deliverect</button>
        <button class="filter-btn" onclick="quickScrape('https://help.mews.com/hc/en-us','Mews',this)">Mews</button>
        <button class="filter-btn" onclick="quickScrape('https://support.marketman.com/hc/en-us','Marketman',this)">Marketman</button>
        <button class="filter-btn" onclick="quickScrape('https://help.resdiary.com/hc/en-gb','ResDiary',this)">ResDiary</button>
        <button class="filter-btn" onclick="quickScrape('https://support.zonal.co.uk/hc/en-gb','Zonal',this)">Zonal</button>
        <button class="filter-btn" onclick="quickScrape('https://support.tevalis.com/hc/en-gb','Tevalis',this)">Tevalis</button>
        <button class="filter-btn" onclick="quickScrape('https://support.flipdish.com/hc/en-us','Flipdish',this)">Flipdish</button>
        <button class="filter-btn" onclick="quickScrape('https://support.airship.com/hc/en-gb','Airship',this)">Airship</button>
        <button class="filter-btn" onclick="quickScrape('https://support.stampede.ai/hc/en-gb','Stampede',this)">Stampede</button>
        <button class="filter-btn" onclick="quickScrape('https://help.fourth.com/hc/en-gb','Fourth',this)">Fourth</button>
        <button class="filter-btn" onclick="quickScrape('https://support.rotaready.com/hc/en-gb','Rotaready',this)">Rotaready</button>
        <button class="filter-btn" onclick="quickScrape('https://support.collins.uk/hc/en-gb','Collins',this)">Collins</button>
      </div>
      <div id="scrapeStatus" style="margin-top:10px;font-size:13px;padding:8px 0;color:var(--text3)"></div>
    </div>
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
    </div><!-- end #contentDocs -->

  </div><!-- end #tab-content -->

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
  document.querySelectorAll('.nav-item').forEach((t,i) => t.classList.toggle('active', ['dashboard','vendors','questions','gaps','adoption','signups','conversations','content'][i]===id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+id));
  if (id==='content') loadVideos();
  // close mobile hamburger menu on tab pick
  const nav = document.getElementById('headerNav');
  const tog = document.getElementById('navToggle');
  if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); if (tog) tog.classList.remove('open'); }
}
function toggleNav() {
  const nav = document.getElementById('headerNav');
  const tog = document.getElementById('navToggle');
  if (!nav) return;
  nav.classList.toggle('open');
  if (tog) tog.classList.toggle('open');
}
function showContentTab(sub) {
  const showVideos = sub === 'videos';
  document.getElementById('contentVideos').style.display = showVideos ? '' : 'none';
  document.getElementById('contentDocs').style.display = showVideos ? 'none' : '';
  document.getElementById('stVideos').classList.toggle('active', showVideos);
  document.getElementById('stDocs').classList.toggle('active', !showVideos);
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
let actChart, donutChart;

async function doScrapeUrl() {
  const url = document.getElementById('scrapeUrl').value.trim();
  const vendor = document.getElementById('scrapeVendor').value.trim();
  if (!url) { notify('Enter a URL to scrape', 'red'); return; }
  const btn = document.getElementById('scrapeBtn');
  const st = document.getElementById('scrapeStatus');
  btn.disabled = true; btn.textContent = 'Scraping...';
  st.style.color = 'var(--text3)';
  st.textContent = 'Fetching ' + url + ' — this may take up to 30 seconds...';
  try {
    const r = await fetch('/scrape', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url, vendor }) });
    const data = await r.json();
    if (data.ok) {
      const method = data.method === 'zendesk-api' ? 'Zendesk API' : 'HTML';
      notify('Scraped ' + data.chunks + ' chunks from ' + (vendor || url), 'green');
      st.style.color = 'var(--green,#22c55e)';
      st.textContent = '\u2705 Indexed ' + data.chunks + ' chunks (' + Math.round(data.chars/1000) + 'k chars) via ' + method + ' as "' + data.filename + '"';
      document.getElementById('scrapeUrl').value = '';
      document.getElementById('scrapeVendor').value = '';
      setTimeout(loadAnalytics, 1000);
    } else {
      notify('Scrape failed: ' + (data.error || 'unknown'), 'red');
      st.style.color = '#ef4444';
      st.textContent = '\u274C Failed: ' + (data.error || 'Unknown error');
    }
  } catch(e) { notify('Error: ' + e.message, 'red'); st.style.color='#ef4444'; st.textContent='\u274C '+e.message; }
  btn.disabled = false; btn.textContent = '\uD83D\uDCE5 Scrape';
}

async function quickScrape(url, vendor, btn) {
  btn.disabled = true; btn.textContent = vendor + '...';
  const st = document.getElementById('scrapeStatus');
  st.style.color = 'var(--text3)';
  st.textContent = 'Fetching ' + vendor + ' help centre — this may take up to 30 seconds...';
  try {
    const r = await fetch('/scrape', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url, vendor }) });
    const data = await r.json();
    if (data.ok) {
      const method = data.method === 'zendesk-api' ? 'Zendesk API' : 'HTML';
      notify(vendor + ': ' + data.chunks + ' chunks indexed', 'green');
      st.style.color = 'var(--green,#22c55e)';
      st.textContent = '\u2705 ' + vendor + ': indexed ' + data.chunks + ' chunks (' + Math.round(data.chars/1000) + 'k chars) via ' + method + ' \u2014 "' + data.filename + '"';
      btn.textContent = '\u2705 ' + vendor;
      btn.style.background = 'var(--green,#22c55e)'; btn.style.color = '#fff'; btn.style.border = 'none';
      setTimeout(loadAnalytics, 1000);
    } else {
      notify(vendor + ' scrape failed: ' + (data.error||''), 'red');
      st.style.color = '#ef4444';
      st.textContent = '\u274C ' + vendor + ': ' + (data.error || 'Failed');
      btn.disabled = false; btn.textContent = vendor;
    }
  } catch(e) {
    notify('Error: ' + e.message, 'red');
    st.style.color = '#ef4444';
    st.textContent = '\u274C ' + vendor + ': ' + e.message;
    btn.disabled = false; btn.textContent = vendor;
  }
}

async function loadAnalytics() {
  try {
    const r = await fetch('/analytics');
    const a = await r.json();
    if (a.error) { notify('Error: '+a.error,'red'); return; }
    document.getElementById('kpiConvs').textContent = (a.totalConvs||0).toLocaleString();
    document.getElementById('kpiMsgs').textContent = (a.totalMessages||0).toLocaleString();
    document.getElementById('kpiDocs').textContent = (a.totalDocs||0).toLocaleString();
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
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
    actChart=new Chart(document.getElementById('actChart').getContext('2d'),{type:'bar',data:{labels:days,datasets:[{data:counts,backgroundColor:'rgba(232,87,60,0.12)',borderColor:'#E8573C',borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#EDEBE5'},ticks:{color:'#A8A49C',font:{family:'Inter',size:11}}},x:{grid:{display:false},ticks:{color:'#A8A49C',font:{family:'Inter',size:11}}}}}});
    const dL=(a.topTopics||[]).slice(0,6).map(([t])=>t.charAt(0).toUpperCase()+t.slice(1));const dC=(a.topTopics||[]).slice(0,6).map(([,c])=>c);
    if(donutChart)donutChart.destroy();
    if(dL.length){donutChart=new Chart(document.getElementById('donutChart').getContext('2d'),{type:'doughnut',data:{labels:dL,datasets:[{data:dC,backgroundColor:['#E8573C','#F07B5A','#C94A30','#F5A58A','#8B4A40','#A8A49C'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{position:'right',labels:{font:{family:'Inter',size:11},color:'#6B6867',padding:10,boxWidth:8,boxHeight:8}}}}});}else{document.getElementById('donutChart').parentElement.innerHTML='<div class="empty">No data yet</div>';}
    const rc=document.getElementById('recentConvs');const convs=(a.recentConvs||[]).slice(0,6);
    if(!convs.length){rc.innerHTML='<div class="empty">No conversations yet</div>';}
    else{rc.innerHTML=convs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;const d=new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});return '<div class="conv-item"><div class="conv-top"><span class="conv-name">'+esc(c.name||'Unknown')+'</span>'+(c.venue?'<span class="conv-venue">'+esc(c.venue)+'</span>':'')+'<span class="conv-date">'+d+' &middot; '+count+' msg'+(count!==1?'s':'')+'</span></div><div class="conv-preview">'+esc((first?.content||'Chat session').substring(0,100))+'</div></div>';}).join('');}
    const ct=document.getElementById('convsTable');
    if(!a.recentConvs.length){ct.innerHTML='<div class="empty">No conversations yet</div>';}
    else{ct.innerHTML='<div>'+a.recentConvs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;const d=new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});const thread=(c.messages||[]).map(m=>'<div class="thread-msg"><div class="thread-role '+(m.role==='user'?'user':'')+'">'+esc(m.role==='user'?'You':'Bot')+'</div><div class="thread-content">'+esc((m.content||'').substring(0,300))+'</div></div>').join('');return '<div class="conv-item" onclick="toggleConv(this)" title="Click to expand thread"><div class="conv-top"><span class="conv-name">'+esc(c.name||'Unknown')+'</span>'+(c.venue?'<span class="conv-venue">'+esc(c.venue)+'</span>':'')+'<span class="conv-date">'+d+' &middot; '+count+' msg'+(count!==1?'s':'')+'</span></div><div class="conv-preview">'+esc((first?.content||'Chat session').substring(0,100))+'</div><div class="conv-thread">'+thread+'</div></div>';}).join('')+'</div>';}
    // NPS table
    const npsEl = document.getElementById('npsTable');
    if (!a.npsData || !a.npsData.length) {
      npsEl.innerHTML = '<div class="empty">No ratings yet — NPS prompts appear after vendor conversations</div>';
    } else {
      npsEl.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="border-bottom:1px solid var(--border)">' +
        '<th style="text-align:left;padding:8px 4px;font-weight:600;color:var(--text2)">Vendor</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">NPS</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">Avg score</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">Responses</th>' +
        '<th style="padding:8px 4px;font-weight:600;color:var(--text2)">Distribution</th>' +
        '</tr></thead><tbody>' +
        a.npsData.map(function(d) {
          var npsColor = d.nps >= 50 ? 'var(--green)' : d.nps >= 0 ? '#ca8a04' : 'var(--red)';
          var promoterPct = Math.round(d.promoters / d.count * 100);
          var detractorPct = Math.round(d.detractors / d.count * 100);
          var passivePct = 100 - promoterPct - detractorPct;
          var vendorLabel = esc(d.vendor.charAt(0).toUpperCase()+d.vendor.slice(1));
          var npsLabel = (d.nps > 0 ? '+' : '') + d.nps;
          return '<tr style="border-bottom:1px solid var(--border2)">' +
            '<td style="padding:10px 4px;font-weight:600;color:var(--text)">' + vendorLabel + '</td>' +
            '<td style="padding:10px 4px;text-align:center;font-weight:700;color:' + npsColor + '">' + npsLabel + '</td>' +
            '<td style="padding:10px 4px;text-align:center;color:var(--text2)">' + d.avg + '/10</td>' +
            '<td style="padding:10px 4px;text-align:center;color:var(--text2)">' + d.count + '</td>' +
            '<td style="padding:10px 4px;min-width:120px">' +
              '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px">' +
                '<div style="width:' + promoterPct + '%;background:var(--green)" title="Promoters ' + promoterPct + '%"></div>' +
                '<div style="width:' + passivePct + '%;background:#fbbf24" title="Passives ' + passivePct + '%"></div>' +
                '<div style="width:' + detractorPct + '%;background:var(--red)" title="Detractors ' + detractorPct + '%"></div>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>' +
        '<div style="display:flex;gap:16px;padding:10px 4px 0;font-size:11px;color:var(--text3)">' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--green);margin-right:4px"></span>Promoters (9-10)</span>' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#fbbf24;margin-right:4px"></span>Passives (7-8)</span>' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--red);margin-right:4px"></span>Detractors (0-6)</span>' +
        '</div>';
    }
    renderVendorIntel(a.vendorIntel || []);
    renderOperatorQuestions(a.topTopics || [], a.topKeywords || []);
    renderKnowledgeGaps(a.knowledgeGaps || [], a.knowledgeGapCount || 0, a.totalMessages || 0);
    renderAdoption(a.adoption || {});
    renderSignups(a.leads || []);
    renderDocs(a.docs);
  } catch(e) { notify('Failed: '+e.message,'red'); console.error(e); }
}

// ── Vendor Intelligence (Phase 1) ─────────────────────────────────────────
function renderVendorIntel(vis){
  window._vendorIntel = vis || [];
  const t = document.getElementById('vendorTable');
  if(!t) return;
  if(!vis || !vis.length){
    t.innerHTML = '<div class="empty">No vendor mentions yet &mdash; this populates as operators chat about their tech.</div>';
    const d=document.getElementById('vendorDetail'); if(d) d.innerHTML='<div class="empty">No data yet</div>';
    return;
  }
  const cls = a => a==null ? '' : (a>=8?'g':(a>=6?'a':'r'));
  t.innerHTML = '<table class="vlb"><thead><tr><th>Vendor</th><th>Category</th><th class="r">Mentions</th><th class="r">Convos</th><th class="r">Avg NPS</th></tr></thead><tbody>' +
    vis.map(function(v,i){
      const avg = v.nps ? v.nps.avg : null;
      const pill = avg==null ? '<span style="color:var(--text3)">&mdash;</span>' : '<span class="npsp '+cls(parseFloat(avg))+'">'+avg+'</span>';
      return '<tr class="vr'+(i===0?' sel':'')+'" onclick="selectVendor('+i+',this)"><td><strong>'+esc(v.vendor)+'</strong></td><td style="color:var(--text2);font-size:11px;text-transform:uppercase">'+esc(v.category)+'</td><td class="r">'+v.mentions+'</td><td class="r">'+v.conversations+'</td><td class="r">'+pill+'</td></tr>';
    }).join('') + '</tbody></table>';
  selectVendor(0);
}
function selectVendor(i, el){
  const vis = window._vendorIntel || []; const v = vis[i]; if(!v) return;
  if(el){ document.querySelectorAll('.vlb tr.vr').forEach(function(r){r.classList.remove('sel');}); el.classList.add('sel'); }
  let html = '<div style="display:flex;align-items:baseline;justify-content:space-between"><div style="font-size:18px;font-weight:700">'+esc(v.vendor)+'</div><div style="font-size:11px;color:var(--text3);text-transform:uppercase">'+esc(v.category)+' &middot; '+v.mentions+' mentions</div></div>';
  html += '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">Anonymised insight from '+v.conversations+' conversation'+(v.conversations!==1?'s':'')+'</div>';
  if(v.nps){
    const tot = v.nps.count || 1;
    const r = function(lab,val,col){ return '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;margin-bottom:5px"><span style="width:64px;color:var(--text2)">'+lab+'</span><span class="vbar" style="flex:1"><i style="width:'+Math.round(val/tot*100)+'%;background:'+col+'"></i></span><span style="width:32px;text-align:right;font-weight:600">'+Math.round(val/tot*100)+'%</span></div>'; };
    html += '<div class="blk2">NPS &middot; '+v.nps.count+' responses &middot; avg '+v.nps.avg+'/10</div>';
    html += r('Promoters',v.nps.promoters,'#16a34a') + r('Passive',v.nps.passive,'#C77A12') + r('Detractors',v.nps.detractors,'#dc2626');
  }
  if(v.problems && v.problems.length){
    const max = v.problems[0].count || 1;
    html += '<div class="blk2">Most common problems</div>';
    html += v.problems.map(function(p){ return '<div style="display:flex;align-items:center;gap:9px;font-size:12px;margin-bottom:6px"><span style="flex-basis:150px;flex-shrink:0">'+esc(p.label)+'</span><span class="vbar" style="flex:1"><i style="width:'+Math.round(p.count/max*100)+'%;background:var(--blue)"></i></span><span style="width:26px;text-align:right;color:var(--text2);font-size:11px">'+p.count+'</span></div>'; }).join('');
  }
  if(v.samples && v.samples.length){
    html += '<div class="blk2">Sample questions (anonymised)</div>';
    html += v.samples.map(function(s){ return '<div class="vq">'+esc(s)+'</div>'; }).join('');
  }
  if(!v.nps && (!v.problems || !v.problems.length)){
    html += '<div class="empty" style="margin-top:14px">Mentions logged, but not enough detail yet for a breakdown.</div>';
  }
  document.getElementById('vendorDetail').innerHTML = html;
}
// ── Operator Questions (Phase 2) ──────────────────────────────────────────
function renderOperatorQuestions(topTopics, topKeywords){
  window._topKeywords = topKeywords || [];
  const th = document.getElementById('qThemes');
  if(th){
    if(!topTopics || !topTopics.length){ th.innerHTML='<div class="empty">No question themes yet</div>'; }
    else {
      const max = topTopics[0][1] || 1;
      th.innerHTML = topTopics.map(function(t,i){
        const pct = Math.round(t[1]/max*100);
        return '<div class="data-row"><span class="rank'+(i<3?' hi':'')+'">'+(i+1)+'</span><span class="data-label">'+esc(t[0])+'</span><div class="bar-outer"><div class="bar-inner alt" style="width:'+pct+'%"></div></div><span class="data-count">'+t[1]+'</span></div>';
      }).join('');
    }
  }
  const kw = document.getElementById('qKeywords');
  if(kw){
    if(!topKeywords || !topKeywords.length){ kw.innerHTML='<div class="empty">No terms yet &mdash; populates as operators ask questions</div>'; }
    else {
      const max = topKeywords[0].count || 1;
      kw.innerHTML = '<div class="kwcloud">' + topKeywords.map(function(k){
        const scale = 0.8 + (k.count/max)*0.9; // 0.8–1.7em
        return '<span class="kwchip" style="font-size:'+scale.toFixed(2)+'em" title="'+k.count+' mentions">'+esc(k.word)+' <b>'+k.count+'</b></span>';
      }).join('') + '</div>';
    }
  }
}
// ── Sign-ups (who has signed in, with contact details) ───────────────────
function renderSignups(leads){
  window._signups = leads || [];
  const d30 = Date.now() - 30*24*3600*1000;
  const recent = (leads || []).filter(function(l){ try { return new Date(l.created_at).getTime() > d30; } catch(e){ return false; } }).length;
  const set = function(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; };
  set('suTotal', (leads ? leads.length : 0).toLocaleString());
  set('suRecent', recent.toLocaleString());
  if(leads && leads.length){
    const latest = leads[0];
    set('suLatest', (latest.name || 'Unknown') + ' · ' + new Date(latest.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}));
  } else { set('suLatest', '—'); }
  const t = document.getElementById('signupsTable');
  if(!t) return;
  if(!leads || !leads.length){ t.innerHTML='<div class="empty">No sign-ups yet</div>'; return; }
  t.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
      '<th style="text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)">Date</th>' +
      '<th style="text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)">Name</th>' +
      '<th style="text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)">Venue</th>' +
      '<th style="text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)">Email</th>' +
      '<th style="text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);font-weight:600;padding:9px 14px;border-bottom:1px solid var(--border)">Phone</th>' +
    '</tr></thead><tbody>' +
    leads.map(function(l){
      const d = l.created_at ? new Date(l.created_at) : null;
      const ds = d ? d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}) + ' &middot; ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '&mdash;';
      const cell = 'padding:11px 14px;border-bottom:1px solid var(--surface2)';
      return '<tr>' +
        '<td style="'+cell+';color:var(--text2);font-size:12px">'+ds+'</td>' +
        '<td style="'+cell+'"><strong>'+esc(l.name || '—')+'</strong></td>' +
        '<td style="'+cell+'">'+esc(l.venue || '—')+'</td>' +
        '<td style="'+cell+';font-size:12px">'+esc(l.email || '—')+'</td>' +
        '<td style="'+cell+';font-size:12px;color:var(--text2)">'+esc(l.phone || '—')+'</td>' +
        '</tr>';
    }).join('') + '</tbody></table>';
}
function exportSignupsCSV(){
  const leads = window._signups || [];
  if(!leads.length){ notify('No sign-ups to export','red'); return; }
  const rows = [['Date','Name','Venue','Email','Phone']];
  leads.forEach(function(l){
    const d = l.created_at ? new Date(l.created_at).toISOString() : '';
    rows.push([d, l.name||'', l.venue||'', l.email||'', l.phone||'']);
  });
  const csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'stacked-signups.csv'; a.click();
  notify('Exported sign-ups CSV','green');
}

// ── Adoption (Phase 4) ────────────────────────────────────────────────────
function renderAdoption(ad){
  const set = function(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; };
  set('adTotal', (ad.totalVenues||0).toLocaleString());
  set('adActive', (ad.activeCount||0).toLocaleString());
  set('adNew', (ad.newThisMonth||0).toLocaleString());
  set('adAvg', (ad.avgQuestionsPerVenue||0).toLocaleString());
  const ob = document.getElementById('adOnboard');
  if(ob){
    const onb = ad.onboarding || [];
    const max = Math.max(1, ...onb.map(function(o){return o.count;}));
    if(!onb.length){ ob.innerHTML='<div class="empty">No venues yet</div>'; }
    else ob.innerHTML = onb.map(function(o){
      return '<div class="data-row"><span class="data-label" style="min-width:60px">'+esc(o.month)+'</span><div class="bar-outer"><div class="bar-inner alt" style="width:'+Math.round(o.count/max*100)+'%"></div></div><span class="data-count">'+o.count+'</span></div>';
    }).join('');
  }
  const tv = document.getElementById('adTopVenues');
  if(tv){
    const vs = ad.topVenues || [];
    if(!vs.length){ tv.innerHTML='<div class="empty">No venue activity yet</div>'; return; }
    tv.innerHTML = '<table class="vlb"><thead><tr><th>Venue</th><th class="r">Chats</th><th class="r">Messages</th><th class="r">Status</th></tr></thead><tbody>' +
      vs.map(function(v){
        const badge = v.active ? '<span class="npsp g">Active</span>' : '<span class="npsp" style="background:var(--surface2);color:var(--text3)">Dormant</span>';
        return '<tr><td><strong>'+esc(v.venue||'Unknown')+'</strong></td><td class="r">'+v.convs+'</td><td class="r">'+v.msgs+'</td><td class="r">'+badge+'</td></tr>';
      }).join('') + '</tbody></table>';
  }
}

// ── Knowledge Gaps (Phase 3) ──────────────────────────────────────────────
function renderKnowledgeGaps(gaps, total, totalQs){
  window._gaps = gaps || [];
  const gt = document.getElementById('gapTotal'); if(gt) gt.textContent = (total||0).toLocaleString();
  const gp = document.getElementById('gapPct'); if(gp) gp.textContent = (totalQs>0 ? Math.round((total/totalQs)*100) : 0) + '%';
  const gs = document.getElementById('gapShown'); if(gs) gs.textContent = (gaps?gaps.length:0).toLocaleString();
  const el = document.getElementById('gapsList'); if(!el) return;
  if(!gaps || !gaps.length){ el.innerHTML = '<div class="empty">No knowledge gaps detected &mdash; the bot is answering everything from the knowledge base. 🎉</div>'; return; }
  el.innerHTML = gaps.map(function(g){
    const d = g.when ? new Date(g.when).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '';
    return '<div class="conv-item"><div class="conv-top"><span class="conv-name" style="font-weight:500">'+esc(g.question)+'</span><span class="conv-date">'+d+'</span></div></div>';
  }).join('');
}
function exportGapsCSV(){
  const gaps = window._gaps || [];
  if(!gaps.length){ notify('No knowledge gaps to export','red'); return; }
  const rows = [['Unanswered question','Date']];
  gaps.forEach(function(g){ rows.push([g.question, g.when ? new Date(g.when).toLocaleDateString('en-GB') : '']); });
  const csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'stacked-knowledge-gaps.csv'; a.click();
  notify('Exported knowledge gaps CSV','green');
}
function exportQuestionsCSV(){
  const kws = window._topKeywords || [];
  if(!kws.length){ notify('No question data to export yet','red'); return; }
  const rows = [['Term','Mentions']];
  kws.forEach(function(k){ rows.push([k.word,k.count]); });
  const csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'stacked-operator-questions.csv'; a.click();
  notify('Exported operator questions CSV','green');
}
function exportVendorCSV(){
  const vis = window._vendorIntel || [];
  if(!vis.length){ notify('No vendor data to export yet','red'); return; }
  const rows = [['Vendor','Category','Mentions','Conversations','Avg NPS','NPS responses','Top problems']];
  vis.forEach(function(v){ rows.push([v.vendor,v.category,v.mentions,v.conversations,v.nps?v.nps.avg:'',v.nps?v.nps.count:'',(v.problems||[]).map(function(p){return p.label;}).join('; ')]); });
  const csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'stacked-vendor-intelligence.csv'; a.click();
  notify('Exported vendor intelligence CSV','green');
}

function toggleConv(el) { el.classList.toggle('open'); }
function imgErr(el) { el.style.display='none'; }
var allDocs=[];
function filterDocs(q){var f=q?allDocs.filter(function(d){return d.filename.toLowerCase().includes(q.toLowerCase());}):allDocs;var c=document.getElementById('docCount');if(c)c.textContent=f.length+' / '+allDocs.length+' docs';renderDocList(f);}
function renderDocs(docs){allDocs=docs||[];var c=document.getElementById('docCount');if(c)c.textContent=allDocs.length+' docs';renderDocList(allDocs);}

function renderDocList(docs){const dl=document.getElementById('docList');if(!docs||!docs.length){dl.innerHTML='<div class="empty">No documents uploaded yet</div>';return;}dl.innerHTML=docs.map(d=>{const fn=esc(d.filename),date=new Date(d.created_at).toLocaleDateString('en-GB'),jfn=JSON.stringify(d.filename);return '<div class="doc-row"><div class="doc-left"><div class="doc-icon">&#x1F4C4;</div><div><div class="doc-name">'+fn+'</div><div class="doc-date">'+date+'</div></div></div><div class="doc-right"><span class="badge-indexed">Indexed</span><button class="btn-del" onclick="deleteDoc('+jfn+',this)">Delete</button></div></div>';}).join('');}

async function deleteDoc(fn,btn){if(!confirm('Delete "'+fn+'"?'))return;btn.disabled=true;btn.textContent='Deleting...';try{const r=await fetch('/documents?filename='+encodeURIComponent(fn),{method:'DELETE'});const d=await r.json();if(d.ok){notify(fn+' deleted','green');btn.closest('.doc-row').remove();setTimeout(loadAnalytics,500);}else{notify('Delete failed','red');btn.disabled=false;btn.textContent='Delete';}}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}
function dragOver(e){e.preventDefault();document.getElementById('dropZone').classList.add('dragging');}
function dragLeave(){document.getElementById('dropZone').classList.remove('dragging');}
function dropFiles(e){e.preventDefault();document.getElementById('dropZone').classList.remove('dragging');handleFiles(e.dataTransfer.files);}
async function handleFiles(files){const ul=document.getElementById('uploadList');for(const file of files){const id='pb_'+file.name.replace(/\\W/g,'');const item=document.createElement('div');item.className='upload-item';item.innerHTML='<div><strong>'+esc(file.name)+'</strong> <span style="color:#94a3b8">'+(file.size/1024).toFixed(0)+' KB</span><div class="prog-wrap"><div class="prog-bar" id="'+id+'"></div></div></div>';ul.appendChild(item);try{const text=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsText(file);});const pb=document.getElementById(id);if(pb)pb.style.width='50%';await fetch('/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,content:text})});if(pb)pb.style.width='100%';item.innerHTML+=' <span style="color:#16a34a;font-size:12px;font-weight:600">&#x2713; Indexed</span>';notify(file.name+' indexed!','green');setTimeout(loadAnalytics,1000);}catch(e){item.innerHTML+=' <span style="color:#dc2626;font-size:12px">Failed</span>';notify('Failed: '+file.name,'red');}}}
function notify(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.className='toast',3500);}

function vDragOver(e){e.preventDefault();document.getElementById('videoDrop').classList.add('drag-over');}
function vDragLeave(){document.getElementById('videoDrop').classList.remove('drag-over');}
function vDrop(e){e.preventDefault();document.getElementById('videoDrop').classList.remove('drag-over');handleVideoFiles(e.dataTransfer.files);}
async function handleVideoFiles(files){const list=document.getElementById('videoUploadList');for(const file of files){if(!file.type.startsWith('video/')){notify('Only video files please','red');continue;}const itemId='vup_'+Date.now();const item=document.createElement('div');item.style.cssText='padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;margin-bottom:6px;border:1px solid var(--border)';item.textContent=file.name;list.appendChild(item);try{const b64=await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=e=>res(e.target.result);reader.onerror=rej;reader.readAsDataURL(file);});const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:b64,title:file.name.replace(/\\.[^.]+$/,''),description:'',type:'mp4',is_upload:true})});const data=await r.json();if(data.ok){notify('Video uploaded!','green');loadVideos();}else{notify('Upload error: '+(data.error||'unknown'),'red');}}catch(e){notify('Upload failed: '+e.message,'red');}}}
async function addVideo(){const u=document.getElementById('vidUrl').value.trim();if(!u){notify('Paste a URL first','red');return;}const t=document.getElementById('vidTitle').value.trim();const d=document.getElementById('vidDesc').value.trim();const cat=document.getElementById('vidCat').value;const btn=document.getElementById('addVidBtn');btn.disabled=true;btn.textContent='Adding...';try{const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,title:t,description:d,category:cat})});const data=await r.json();if(data.ok){notify('Video added!','green');['vidUrl','vidTitle','vidDesc'].forEach(id=>document.getElementById(id).value='');document.getElementById('vidCat').value='';loadVideos();}else{notify('Error: '+(data.error||'unknown'),'red');}}catch(e){notify('Error: '+e.message,'red');}btn.disabled=false;btn.textContent='+ Add';}

let _ytResults=[];
async function searchYouTube(){
  const q=document.getElementById('ytSearch').value.trim();
  if(!q){notify('Enter a vendor name to search','red');return;}
  const btn=document.getElementById('ytSearchBtn');btn.disabled=true;btn.textContent='Searching...';
  try{
    const r=await fetch('/youtube/search?q='+encodeURIComponent(q)+'&max=12');
    const data=await r.json();
    btn.disabled=false;btn.textContent='🔍 Search';
    if(data.error){
      if(data.error.includes('YOUTUBE_API_KEY')){document.getElementById('ytNoKey').style.display='';document.getElementById('ytResults').style.display='none';}
      else notify('YouTube error: '+data.error,'red');
      return;
    }
    document.getElementById('ytNoKey').style.display='none';
    _ytResults=data.items||[];
    document.getElementById('ytResultCount').textContent=_ytResults.length+' results for "'+q+'"';
    document.getElementById('ytResults').style.display='';
    renderYtGrid(_ytResults);
  }catch(e){btn.disabled=false;btn.textContent='🔍 Search';notify('Search failed: '+e.message,'red');}
}
function renderYtGrid(items){
  const grid=document.getElementById('ytGrid');
  if(!items.length){grid.innerHTML='<div class="empty">No results</div>';return;}
  grid.innerHTML=items.map((v,i)=>'<div class="video-card" id="ytc'+i+'" style="cursor:pointer;position:relative" onclick="ytToggle('+i+',this)">'+
    '<div style="position:absolute;top:8px;left:8px;z-index:2;width:22px;height:22px;border-radius:4px;border:2px solid #fff;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center" id="ytchk'+i+'"></div>'+
    '<img class="video-thumb" src="'+esc(v.thumbnail)+'" onerror="imgErr(this)">'+
    '<div class="video-info"><div class="video-title">'+esc(v.title)+'</div>'+
    '<div class="video-desc">'+esc(v.channel)+'</div>'+
    '<div class="video-footer"><span class="vbadge youtube">YouTube</span></div></div></div>').join('');
  updateYtSelCount();
}
function ytToggle(i,card){
  const chk=document.getElementById('ytchk'+i);
  const selected=card.dataset.selected==='1';
  if(selected){card.dataset.selected='0';card.style.outline='';chk.innerHTML='';chk.style.background='rgba(0,0,0,0.4)';}
  else{card.dataset.selected='1';card.style.outline='2px solid var(--blue)';chk.innerHTML='✓';chk.style.background='var(--blue)';chk.style.color='#fff';chk.style.fontWeight='700';chk.style.fontSize='13px';}
  updateYtSelCount();
}
function ytSelectAll(){
  document.querySelectorAll('#ytGrid .video-card').forEach((card,i)=>{
    card.dataset.selected='1';card.style.outline='2px solid var(--blue)';
    const chk=document.getElementById('ytchk'+i);if(chk){chk.innerHTML='✓';chk.style.background='var(--blue)';chk.style.color='#fff';chk.style.fontWeight='700';chk.style.fontSize='13px';}
  });
  updateYtSelCount();
}
function updateYtSelCount(){
  const n=document.querySelectorAll('#ytGrid .video-card[data-selected="1"]').length;
  document.getElementById('ytSelCount').textContent=n;
  document.getElementById('ytImportBtn').style.display=n>0?'':'none';
}
async function importSelected(){
  const cat=document.getElementById('ytCategory').value;
  const selected=[];
  document.querySelectorAll('#ytGrid .video-card[data-selected="1"]').forEach(card=>{
    const i=parseInt(card.id.replace('ytc',''));
    if(!isNaN(i)&&_ytResults[i])selected.push(_ytResults[i]);
  });
  if(!selected.length){notify('Select at least one video','red');return;}
  const btn=document.getElementById('ytImportBtn');btn.disabled=true;btn.innerHTML='Importing...';
  try{
    const r=await fetch('/youtube/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videos:selected,category:cat})});
    const data=await r.json();
    if(data.ok){notify('Imported '+data.added+' video'+(data.added!==1?'s':'')+'!','green');loadVideos();document.getElementById('ytResults').style.display='none';document.getElementById('ytSearch').value='';}
    else notify('Import error: '+(data.error||'unknown'),'red');
  }catch(e){notify('Error: '+e.message,'red');}
  btn.disabled=false;btn.innerHTML='&#x2B07; Import selected (<span id="ytSelCount">0</span>)';
}

let _allVideos=[], _videoFilter='';
function filterVideos(cat,btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  _videoFilter=cat;
  const filtered=cat?_allVideos.filter(v=>(v.category||'')=== cat):_allVideos;
  renderVideoGrid(filtered);
}
function renderVideoGrid(vids){
  var el=document.getElementById('videoGrid');
  const vc=document.getElementById('videoCount');
  if(vc)vc.textContent=_allVideos.length+' video'+(  _allVideos.length!==1?'s':'')+' in library';
  el.innerHTML='';
  if(!Array.isArray(vids)||!vids.length){var emp=document.createElement('div');emp.className='empty';emp.textContent='No videos'+(  _videoFilter?' in this category':' yet')+'.';el.appendChild(emp);return;}
  const catLabels={epos:'EPOS',payments:'Payments',wifi:'WiFi',printer:'Printers',bookings:'Bookings',workforce:'Workforce',ordering:'Ordering',loyalty:'Loyalty',general:'General'};
  vids.forEach(function(v){var card=document.createElement('div');card.className='video-card';var thumbEl;if(v.thumbnail){thumbEl=document.createElement('img');thumbEl.className='video-thumb';thumbEl.src=v.thumbnail;}else{thumbEl=document.createElement('div');thumbEl.className='video-thumb-empty';thumbEl.textContent=v.type==='youtube'?'▶':'🎬';}thumbEl.dataset.v=encodeURIComponent(JSON.stringify(v));thumbEl.onclick=function(){playVideoEnc(this.dataset.v);};card.appendChild(thumbEl);var info=document.createElement('div');info.className='video-info';var titleEl=document.createElement('div');titleEl.className='video-title';titleEl.textContent=v.title||'Untitled';info.appendChild(titleEl);if(v.description){var descEl=document.createElement('div');descEl.className='video-desc';descEl.textContent=v.description;info.appendChild(descEl);}var footer=document.createElement('div');footer.className='video-footer';var badge=document.createElement('span');badge.className='vbadge '+(v.type||'mp4');badge.textContent=(v.type||'').toLowerCase()==='youtube'?'YouTube':'MP4';var catBadge='';if(v.category&&catLabels[v.category]){var cb=document.createElement('span');cb.className='vbadge';cb.style.cssText='background:var(--surface2);color:var(--text2);border:1px solid var(--border)';cb.textContent=catLabels[v.category];footer.appendChild(cb);}var delBtn=document.createElement('button');delBtn.className='btn-del';delBtn.textContent='Delete';delBtn.dataset.id=v.id;delBtn.onclick=function(){deleteVideo(this.dataset.id,this);};footer.appendChild(badge);footer.appendChild(delBtn);info.appendChild(footer);card.appendChild(info);el.appendChild(card);});
}
async function loadVideos(){var el=document.getElementById('videoGrid');if(!el)return;el.innerHTML='<div class="empty" style="color:var(--text3)">Loading...</div>';try{var r=await fetch('/videos');var vids=await r.json();_allVideos=Array.isArray(vids)?vids:[];renderVideoGrid(_videoFilter?_allVideos.filter(v=>(v.category||'')===_videoFilter):_allVideos);}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">Error: '+e.message+'</div>';}}
function playVideoEnc(enc){playVideo(JSON.parse(decodeURIComponent(enc)));}
function playVideo(v){document.getElementById('vmodalTitle').textContent=v.title||'Video';var body=document.getElementById('vmodalBody');while(body.firstChild)body.removeChild(body.firstChild);if(v.type==='youtube'&&v.yt_id){var ifr=document.createElement('iframe');ifr.src='https://www.youtube.com/embed/'+v.yt_id+'?autoplay=1&rel=0';ifr.frameBorder='0';ifr.allowFullscreen=true;ifr.setAttribute('allow','autoplay;encrypted-media;fullscreen');ifr.style.cssText='display:block;width:100%;aspect-ratio:16/9';body.appendChild(ifr);}else{var vid=document.createElement('video');vid.src=v.url;vid.controls=true;vid.autoplay=true;vid.style.cssText='width:100%;aspect-ratio:16/9';body.appendChild(vid);}document.getElementById('vmodal').style.display='flex';}
function closeVModal(){document.getElementById('vmodal').style.display='none';var b=document.getElementById('vmodalBody');while(b.firstChild)b.removeChild(b.firstChild);}
async function deleteVideo(id,btn){if(!confirm('Delete this video?'))return;btn.disabled=true;try{await fetch('/videos/'+id,{method:'DELETE'});notify('Deleted','green');loadVideos();}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}

// ─── BRANDING MODAL ───────────────────────────────────────────────────────
let _allVenues = [];
async function showBrandingModal() {
  document.getElementById('brandingModal').style.display = 'flex';
  if (!_allVenues.length) {
    try {
      const r = await fetch('/venues/all');
      _allVenues = await r.json();
      const sel = document.getElementById('bVenueSelect');
      sel.innerHTML = '<option value="">Select a venue...</option>' +
        _allVenues.map(v => '<option value="' + esc(v.id) + '" data-slug="' + esc(v.slug||'') + '">' + esc(v.name) + '</option>').join('');
      sel.onchange = function() {
        const opt = this.options[this.selectedIndex];
        const venue = _allVenues.find(v => String(v.id) === this.value);
        if (venue) {
          if (venue.logo_url) document.getElementById('bLogoUrl').value = venue.logo_url;
          if (venue.primary_color) { document.getElementById('bColorHex').value = venue.primary_color; document.getElementById('bColorPicker').value = venue.primary_color; }
          if (venue.bot_name) document.getElementById('bBotName').value = venue.bot_name;
          if (venue.welcome_message) document.getElementById('bWelcomeMsg').value = venue.welcome_message;
          if (venue.welcome_heading) document.getElementById('bWelcomeHeading').value = venue.welcome_heading;
          document.getElementById('bWhiteLabel').checked = !!venue.white_label;
          updatePreview();
        }
      };
    } catch(e) { notify('Could not load venues', 'red'); }
  }
  updatePreview();
}
function closeBrandingModal() { document.getElementById('brandingModal').style.display = 'none'; }
function syncColor(hex) {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) document.getElementById('bColorPicker').value = hex;
  updatePreview();
}
document.addEventListener('DOMContentLoaded', function() {
  var cp = document.getElementById('bColorPicker');
  if (cp) cp.oninput = function() { document.getElementById('bColorHex').value = this.value; updatePreview(); };
  ['bLogoUrl','bBotName','bWelcomeMsg'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.oninput = updatePreview;
  });
  var logoInput = document.getElementById('bLogoUrl');
  if (logoInput) {
    logoInput.addEventListener('blur', async function() {
      var url = this.value.trim();
      if (!url) { showLogoUrlError(null); return; }
      var result = await validateLogoUrl(url);
      showLogoUrlError(result.ok ? null : result.msg);
    });
    logoInput.addEventListener('input', function() { showLogoUrlError(null); });
  }
});
function updatePreview() {
  var logo = document.getElementById('bLogoUrl').value.trim();
  var name = document.getElementById('bBotName').value.trim() || 'Your Bot';
  var color = document.getElementById('bColorHex').value.trim() || '#E8573C';
  var sel = document.getElementById('bVenueSelect');
  var opt = sel ? sel.options[sel.selectedIndex] : null;
  var slug = opt ? (opt.dataset ? opt.dataset.slug : '') : '';
  var previewLogo = document.getElementById('bPreviewLogo');
  if (logo) { previewLogo.src = logo; previewLogo.style.display = ''; } else { previewLogo.style.display = 'none'; }
  document.getElementById('bPreviewName').textContent = name;
  document.getElementById('bPreviewSwatch').style.background = color;
  document.getElementById('bPreviewUrl').textContent = slug ? 'stackedchat.io/chat/' + slug : '';
}

// Validate logo URL: check extension + attempt to load as image
function validateLogoUrl(url) {
  return new Promise(function(resolve) {
    if (!url) { resolve({ ok: true }); return; }
    // Clearbit logos and data URIs are OK without extension check
    var isClearbit = /logo\\.clearbit\\.com/i.test(url);
    var isDataUri = /^data:image\\//i.test(url);
    var hasImageExt = /\\.(png|jpg|jpeg|svg|webp|gif)(\\?|$|#)/i.test(url);
    if (!isClearbit && !isDataUri && !hasImageExt) {
      resolve({ ok: false, msg: 'URL doesn\\'t look like an image. Use a direct link ending in .png, .svg, .jpg, or a Clearbit URL like logo.clearbit.com/domain.com' });
      return;
    }
    // Try to load the image
    var img = new Image();
    var done = false;
    var timer = setTimeout(function() { if (!done) { done = true; resolve({ ok: false, msg: 'Image took too long to load. Check the URL is correct and publicly accessible.' }); } }, 6000);
    img.onload = function() { if (!done) { done = true; clearTimeout(timer); resolve({ ok: true }); } };
    img.onerror = function() { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, msg: 'Image failed to load. Make sure the URL points to an actual image file, not a webpage.' }); } };
    img.src = url;
  });
}

function showLogoUrlError(msg) {
  var el = document.getElementById('bLogoUrlError');
  var input = document.getElementById('bLogoUrl');
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
    if (input) input.style.borderColor = '#dc2626';
  } else {
    el.style.display = 'none';
    el.textContent = '';
    if (input) input.style.borderColor = '';
  }
}
async function saveBranding() {
  var venueId = document.getElementById('bVenueSelect').value;
  if (!venueId) { notify('Select a venue first', 'red'); return; }
  var logoUrl = document.getElementById('bLogoUrl').value.trim();
  if (logoUrl) {
    var logoCheck = await validateLogoUrl(logoUrl);
    if (!logoCheck.ok) { showLogoUrlError(logoCheck.msg); notify('Fix the logo URL before saving', 'red'); return; }
  }
  var btn = document.getElementById('bSaveBtn'); btn.disabled = true; btn.textContent = 'Saving...';
  var payload = {
    logo_url: document.getElementById('bLogoUrl').value.trim() || null,
    primary_color: document.getElementById('bColorHex').value.trim() || null,
    bot_name: document.getElementById('bBotName').value.trim() || null,
    welcome_message: document.getElementById('bWelcomeMsg').value.trim() || null,
    welcome_heading: document.getElementById('bWelcomeHeading').value.trim() || null,
    white_label: document.getElementById('bWhiteLabel').checked
  };
  try {
    var r = await fetch('/venue/' + venueId + '/branding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var data = await r.json();
    if (data.ok) {
      notify('Branding saved!', 'green');
      _allVenues = []; // reset cache
      closeBrandingModal();
      loadAnalytics();
    } else { notify('Error: ' + (data.error || 'unknown'), 'red'); }
  } catch(e) { notify('Error: ' + e.message, 'red'); }
  btn.disabled = false; btn.textContent = 'Save branding';
}

loadAnalytics();
loadVideos();
setInterval(loadAnalytics,60000);
</script>
</body>
</html>`;

const PORT = process.env.PORT || 8080;

// ─── MEDIA URLS (private storage) ───────────────────────────────────────────
// Files live in a PRIVATE bucket and keep their historical "public" URL in the database.
// Every URL handed to a browser is swapped here for a short-lived signed one. If signing
// isn't available the original URL is returned unchanged.
async function signMedia(items, ttlSeconds) {
  if (!modern || !modern.storage || !Array.isArray(items) || !items.length) return items;
  const urls = await modern.storage.signUrls(items.map(i => i && i.url), ttlSeconds);
  return items.map((it, i) => (it && urls[i]) ? Object.assign({}, it, { url: urls[i] }) : it);
}

// ─── MODERN API LOADER (strangler pattern) ──────────────────────────────────
// New routes live in src/ and compile to dist/ (npm postinstall). If dist/ or its
// dependencies are missing the legacy server simply carries on without them.
let modern = null;
async function initModern() {
  // Kill switch: set DISABLE_MODERN_API=1 in the host's environment to run legacy-only.
  if (process.env.DISABLE_MODERN_API === '1') { console.log('Modern API disabled by DISABLE_MODERN_API=1'); return; }
  try {
    const { createModernHandler } = require('./dist/index.js');
    const h = createModernHandler({ config: {
      SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY: SUPABASE_SERVICE_KEY || undefined,
      RESEND_API_KEY: process.env.RESEND_API_KEY || undefined, RESEND_FROM: process.env.RESEND_FROM || undefined,
      PUBLIC_URL: process.env.PUBLIC_URL || undefined,
      // Billing (Stripe, test mode). Billing stays off unless ALL the Stripe settings are present.
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined, STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
      STRIPE_PRICE_STANDARD_MONTHLY: process.env.STRIPE_PRICE_STANDARD_MONTHLY || undefined, STRIPE_PRICE_STANDARD_ANNUAL: process.env.STRIPE_PRICE_STANDARD_ANNUAL || undefined,
      STRIPE_PRICE_GROUP_MONTHLY: process.env.STRIPE_PRICE_GROUP_MONTHLY || undefined, STRIPE_PRICE_GROUP_ANNUAL: process.env.STRIPE_PRICE_GROUP_ANNUAL || undefined,
      STRIPE_PRICE_LARGE_MONTHLY: process.env.STRIPE_PRICE_LARGE_MONTHLY || undefined, STRIPE_PRICE_LARGE_ANNUAL: process.env.STRIPE_PRICE_LARGE_ANNUAL || undefined,
      STRIPE_ALLOW_LIVE: process.env.STRIPE_ALLOW_LIVE || undefined,
      FAIR_USE_AI_QUESTIONS: process.env.FAIR_USE_AI_QUESTIONS || undefined, FAIR_USE_STAFF_PER_VENUE: process.env.FAIR_USE_STAFF_PER_VENUE || undefined,
      CRON_SECRET: process.env.CRON_SECRET || undefined, SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || undefined,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined, INSIGHTS_MODEL: process.env.INSIGHTS_MODEL || undefined, CHAT_MODEL: process.env.CHAT_MODEL || undefined,
      NODE_ENV: process.env.NODE_ENV || 'development',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      APP_VERSION: process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || 'dev',
    } });
    await h.ready;
    modern = h;
    console.log('Modern API ready: /api/v1/*, /healthz');
  } catch (e) {
    console.error('Modern API disabled (legacy routes unaffected):', e && e.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Modern (TypeScript, src/ -> dist/) API: /api/v1/* and /healthz. Everything else is legacy below.
  if (modern && modern.handles(url)) {
    try { await modern.handle(req, res); }
    catch (e) {
      console.error('[modern] unhandled', e);
      if (!res.headersSent) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong' } })); }
    }
    return;
  }

  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'})); return;
  }

  // Admin-only config check: which Supabase key the server is using. Never returns key material.
  if (method === 'GET' && url === '/admin/status') {
    if (!requireAdmin(req, res)) return;
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ supabase_data_access: SUPABASE_SERVICE_KEY ? 'service_role' : 'anon_legacy', admin_password_set: !!ADMIN_PW, cron_secret_set: !!CRON_SECRET, node: process.version, uptime_seconds: Math.round(process.uptime()) }));
    return;
  }

  if (url === '/admin' || url === '/admin/') {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(isAdminAuthed(req) ? ADMIN_PAGE : ADMIN_LOGIN_PAGE); return;
  }

  if (method === 'POST' && url === '/admin-login') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      try {
        if (!ADMIN_PW) {
          res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: false, error: 'Admin password is not configured on this server (set STACKED_ADMIN_PASSWORD).' })); return;
        }
        if (loginThrottled(getClientIP(req))) {
          res.writeHead(429, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: false, error: 'Too many attempts. Try again in 10 minutes.' })); return;
        }
        const { password } = JSON.parse(body || '{}');
        if (typeof password === 'string' && safeEqual(password, ADMIN_PW)) {
          const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
          res.writeHead(200, {'Content-Type':'application/json', 'Set-Cookie':'sa_admin=' + ADMIN_TOKEN + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' + secure});
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: false }));
        }
      } catch(e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok: false })); }
    }); return;
  }

  // Operator-facing redesign shell (sidebar + topbar, no screens yet).
  // See CLAUDE.md step 2. Screens land at #triage / #issues / etc.
  if (url === '/app' || url === '/app/' || url.startsWith('/app#') || url.startsWith('/app?')) {
    res.writeHead(302, {'Location':'/chat/','Cache-Control':'no-store'}); res.end(); return;
  }

  if (url === '/analytics') {
    if (!isAdminAuthed(req)) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Not authorised'})); return; }
    const data = await getAnalytics();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(data)); return;
  }

  // ─── TICKET CLOSE ──────────────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/ticket/') && url.endsWith('/close')) {
    if (!requireAdmin(req, res)) return;
    const id = url.split('/')[2];
    await sbFetch(`/rest/v1/tickets?id=eq.${id}`, {method:'PATCH', body:{status:'closed'}});
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true})); return;
  }

  // ─── DELETE DOCUMENT ───────────────────────────────────────────────────
  if (method === 'DELETE' && url.startsWith('/documents')) {
    if (!requireAdmin(req, res)) return;
    try {
      const params = new URL(url, 'http://localhost');
      const filename = params.searchParams.get('filename');
      if (!filename) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'No filename provided'})); return; }
      const https = require('https');
      const sbUrl = new URL(`${SUPABASE_URL}/rest/v1/documents?filename=eq.${encodeURIComponent(filename)}`);
      const statusCode = await new Promise((resolve, reject) => {
        const req2 = https.request({
          hostname: sbUrl.hostname, path: sbUrl.pathname + sbUrl.search, method: 'DELETE',
          headers: { 'apikey': SUPABASE_DATA_KEY, 'Authorization': `Bearer ${SUPABASE_DATA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
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
    if (!requireAdmin(req, res)) return;
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

  // ─── VIDEOS ────────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/videos') {
    if (!requireAdmin(req, res)) return;
    try {
      const r = await sbFetch('/rest/v1/videos?select=*&order=created_at.desc&limit=100');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(await signMedia(Array.isArray(r.data) ? r.data : [], 6 * 3600)));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (method === 'POST' && url === '/videos/add') {
    if (!requireAdmin(req, res)) return;
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: videoUrl, title, description, tenant, category } = JSON.parse(body);
        if (!videoUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No URL'})); return; }
        let type = 'mp4', thumbnail = '', ytId = null;
        const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) { ytId = ytMatch[1]; type = 'youtube'; thumbnail = 'https://img.youtube.com/vi/' + ytId + '/mqdefault.jpg'; }
        const record = { url: videoUrl, title: title || ytId || 'Untitled', description: description || '', type, thumbnail, tenant: tenant || 'stacked', yt_id: ytId || null };
        if (category) record.category = category;
        let r = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: record });
        // If category column doesn't exist yet, retry without it
        if (r.status >= 400 && category) {
          delete record.category;
          r = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: record });
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: r.status < 400, video: Array.isArray(r.data) ? r.data[0] : r.data }));
      } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  if (method === 'DELETE' && url.startsWith('/videos/')) {
    if (!requireAdmin(req, res)) return;
    try {
      const id = url.split('/videos/')[1];
      await sbFetch('/rest/v1/videos?id=eq.' + id, { method: 'DELETE' });
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ─── YOUTUBE SEARCH ────────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/youtube/search')) {
    if (!requireAdmin(req, res)) return;
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'YOUTUBE_API_KEY not set'})); return;
    }
    try {
      const params = new URL(url, 'http://localhost');
      const q = params.searchParams.get('q') || '';
      const maxResults = Math.min(parseInt(params.searchParams.get('max')||'12'), 25);
      if (!q) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({items:[]})); return; }
      const ytUrl = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=' + maxResults + '&q=' + encodeURIComponent(q + ' tutorial how to') + '&key=' + ytKey;
      const ytRes = await fetch(ytUrl);
      const ytData = await ytRes.json();
      if (ytData.error) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:ytData.error.message})); return; }
      const items = (ytData.items || []).map(item => ({
        yt_id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.medium?.url || ('https://img.youtube.com/vi/' + item.id.videoId + '/mqdefault.jpg'),
        channel: item.snippet.channelTitle,
        url: 'https://www.youtube.com/watch?v=' + item.id.videoId,
        type: 'youtube'
      }));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({items}));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:e.message}));
    }
    return;
  }

  // ─── YOUTUBE BULK IMPORT ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/youtube/import') {
    if (!requireAdmin(req, res)) return;
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { videos, category } = JSON.parse(body);
        if (!Array.isArray(videos) || !videos.length) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false,error:'No videos provided'})); return;
        }
        let added = 0;
        for (const v of videos) {
          try {
            const record = {
              url: v.url, title: v.title, description: v.description || '',
              type: 'youtube', thumbnail: v.thumbnail, yt_id: v.yt_id,
              tenant: 'stacked'
            };
            if (category) record.category = category;
            const r = await sbFetch('/rest/v1/videos', {
              method: 'POST',
              headers: { 'Prefer': 'return=minimal' },
              body: record
            });
            if (r.status >= 200 && r.status < 300) {
              added++;
            } else {
              console.error('Import Supabase error:', r.status, JSON.stringify(r.data));
              // If category column missing, retry without it
              if (JSON.stringify(r.data).includes('category')) {
                delete record.category;
                const r2 = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: record });
                if (r2.status >= 200 && r2.status < 300) added++;
              }
            }
          } catch(e) { console.error('Import error:', e.message); }
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, added}));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:e.message}));
      }
    }); return;
  }

  // ─── VENUE BRANDING SAVE ──────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/venue/') && url.endsWith('/branding')) {
    if (!requireAdmin(req, res)) return;
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const id = url.split('/venue/')[1].split('/branding')[0];
        const payload = JSON.parse(body);
        const allowed = ['logo_url','primary_color','bot_name','welcome_message','welcome_heading','white_label'];
        const update = {};
        allowed.forEach(k => { if (payload[k] !== undefined) update[k] = payload[k]; });
        await sbFetch('/rest/v1/venues?id=eq.' + id, { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: update });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }); return;
  }

  // ─── VENUE LIST FOR ADMIN ──────────────────────────────────────────────
  if (method === 'GET' && url === '/venues/all') {
    if (!requireAdmin(req, res)) return;
    try {
      const r = await sbFetch('/rest/v1/venues?select=*&order=name.asc&limit=200');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── WEB SCRAPER ───────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/scrape') {
    if (!requireAdmin(req, res)) return;
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: scrapeUrl, vendor } = JSON.parse(body);
        if (!scrapeUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No URL'})); return; }

        const browserHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
        };

        function stripHtml(html) {
          return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ')
            .replace(/\s{3,}/g, '\n\n')
            .trim();
        }

        async function saveChunks(text, vendorName, srcUrl) {
          const filename = vendorName + ' - scraped ' + new Date().toISOString().substring(0,10);
          const chunkSize = 1200;
          const chunks = [];
          for (let i = 0; i < Math.min(text.length, 60000); i += chunkSize) {
            chunks.push({ filename, content: text.substring(i, i + chunkSize), chunk_index: chunks.length });
          }
          await sbFetch('/rest/v1/documents?filename=ilike.' + encodeURIComponent('%' + vendorName + '%scraped%'), { method: 'DELETE' }).catch(() => {});
          for (const chunk of chunks) {
            await sbFetch('/rest/v1/documents', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: chunk });
          }
          return { chunks: chunks.length, chars: text.length, filename };
        }

        // ── Zendesk Help Centre detection ──────────────────────────────────
        // URLs like https://support.lightspeedhq.com/hc/en-gb
        // or https://help.deputy.com/hc/en-us
        // Zendesk exposes a public JSON API at /api/v2/help_center/<locale>/articles.json
        const parsedUrl = new URL(scrapeUrl);
        const hcMatch = parsedUrl.pathname.match(/^\/hc\/([a-z]{2}(?:-[a-z]{2})?)/i);
        if (hcMatch) {
          const locale = hcMatch[1];
          const baseApi = parsedUrl.origin + '/api/v2/help_center/' + locale + '/articles.json?per_page=30&sort_by=updated_at&sort_order=desc';
          let allText = '';
          let pageUrl = baseApi;
          let pagesFetched = 0;
          const maxPages = 5; // up to 150 articles

          let apiBlocked = false;
          while (pageUrl && pagesFetched < maxPages) {
            const apiRes = await safeFetch(pageUrl, {
              headers: { ...browserHeaders, 'Accept': 'application/json' },
              signal: AbortSignal.timeout(20000)
            });
            if (!apiRes.ok) {
              // 401/403 = API locked — fall through to HTML scrape silently
              if (pagesFetched === 0) apiBlocked = true;
              break;
            }
            const apiData = await apiRes.json();
            const articles = apiData.articles || [];
            for (const article of articles) {
              const articleText = article.title + '\n' + stripHtml(article.body || '');
              allText += articleText + '\n\n---\n\n';
            }
            pageUrl = apiData.next_page || null;
            pagesFetched++;
          }

          if (!apiBlocked && allText.length >= 100) {
            const result = await saveChunks(allText, vendor || parsedUrl.hostname, scrapeUrl);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok: true, ...result, method: 'zendesk-api' }));
            return;
          }
          // API blocked or empty — fall through to HTML scrape below
        }

        // ── Standard HTML scrape ───────────────────────────────────────────
        const fetchRes = await safeFetch(scrapeUrl, {
          headers: browserHeaders,
          signal: AbortSignal.timeout(20000)
        });
        if (!fetchRes.ok) throw new Error('HTTP ' + fetchRes.status + ' — site may block scraping or require login');
        const html = await fetchRes.text();
        const text = stripHtml(html);

        if (text.length < 100) throw new Error('Page returned too little content — site requires JavaScript rendering. Try a direct article URL instead of the help centre homepage.');

        const result = await saveChunks(text, vendor || parsedUrl.hostname, scrapeUrl);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, ...result, method: 'html' }));

      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }); return;
  }

  // ─── MAIN CHAT PAGE ────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '' || url.startsWith('/?'))) {
    res.writeHead(302, {'Location':'/chat/','Cache-Control':'no-store'}); res.end(); return;
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

initModern().finally(() => server.listen(PORT, () => {
  console.log(`Stacked Chat server running on port ${PORT}`);
  console.log('Supabase server-side access: ' + (SUPABASE_SERVICE_KEY ? 'service role key' : 'anon key (legacy, set SUPABASE_SERVICE_KEY)'));
}));
