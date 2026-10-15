import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from '../../config.js';

/**
 * Serves the Manage web app (plain HTML/CSS/JS in /web/manage, no build step) at /manage.
 * `/manage/config.json` hands the browser ONLY public values (project URL + anon key).
 */
export async function manageRoutes(app: FastifyInstance, opts: { config: Config; devMode?: boolean }) {
  const root = path.resolve(__dirname, '../../../web/manage');
  const supabaseOrigin = new URL(opts.config.SUPABASE_URL).origin;

  // Strict content policy: our own scripts only, no inline script, API + Supabase Auth for data.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin}`,
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');

  app.addHook('onSend', async (req, reply) => {
    if (!req.url.startsWith('/manage')) return;
    reply.header('Content-Security-Policy', csp)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
      .header('Cache-Control', 'no-cache'); // always revalidate so deploys take effect straight away
  });

  app.get('/manage', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/manage/', 301));
  app.get('/manage/config.json', { schema: { hide: true } }, async () => ({
    supabaseUrl: opts.config.SUPABASE_URL,
    anonKey: opts.config.SUPABASE_KEY,
    dev: !!opts.devMode,
  }));
  await app.register(fastifyStatic, { root, prefix: '/manage/', index: ['index.html'], decorateReply: false });
}
