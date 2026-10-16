// Stacked Chat: a tiny front door. Everything real lives in src/ (TypeScript, compiled to dist/ on install):
//   /chat/     the staff chat          /manage/   customer admin        /console/  Stacked staff
//   /api/v1/*  the API                 /billing/webhook (Stripe)        /healthz   deep health check
// This file only starts the server, hands those addresses to the compiled app, answers /health for the host,
// and redirects the old addresses (/, /app, /admin) to their replacements.
const http = require('http');
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuzlfocqovwhqdpitvxj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';
// Privileged key for SERVER-SIDE data access. Server-only: it is never sent to a browser.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ─── MODERN API LOADER ──────────────────────────────────────────────────────────────────────────────
// If dist/ is missing or fails to load the server still starts and answers /health (so a bad build can never
// fail the host's health check), but nothing else works until it is fixed.
let modern = null;
async function initModern() {
  // Kill switch: set DISABLE_MODERN_API=1 in the host's environment to run with nothing but /health.
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
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined, INSIGHTS_MODEL: process.env.INSIGHTS_MODEL || undefined, CHAT_MODEL: process.env.CHAT_MODEL || undefined, STACKED_STAFF_EMAILS: process.env.STACKED_STAFF_EMAILS || undefined,
      STACKCOLLECT_SUPABASE_URL: process.env.STACKCOLLECT_SUPABASE_URL || undefined, STACKCOLLECT_SUPABASE_KEY: process.env.STACKCOLLECT_SUPABASE_KEY || undefined,
      NODE_ENV: process.env.NODE_ENV || 'development',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      APP_VERSION: process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || 'dev',
    } });
    await h.ready;
    modern = h;
    console.log('Modern API ready: /api/v1/*, /healthz');
  } catch (e) {
    console.error('Modern API failed to load:', e && e.message);
  }
}

const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (modern && modern.handles(url)) {
    try { await modern.handle(req, res); }
    catch (e) {
      console.error('[modern] unhandled', e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong' } })); }
    }
    return;
  }

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' })); return; }

  if (req.method === 'GET' || req.method === 'HEAD') {
    // the old chat widget and operator app
    if (url === '/' || url.startsWith('/?') || url === '/app' || url === '/app/' || url.startsWith('/app#') || url.startsWith('/app?')) return redirect(res, '/chat/');
    // the old admin dashboard
    if (url === '/admin' || url === '/admin/' || url.startsWith('/admin?')) return redirect(res, '/console/');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});

initModern().finally(() => server.listen(PORT, () => {
  console.log(`Stacked Chat server running on port ${PORT}`);
  console.log('Supabase server-side access: ' + (SUPABASE_SERVICE_KEY ? 'service role key' : 'anon key only (set SUPABASE_SERVICE_KEY)'));
}));
