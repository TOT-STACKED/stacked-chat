import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from '../../config.js';

/** Serves the Console web app (plain HTML/CSS/JS in /web/console) at /console/. Public values only in config.json. */
export async function consoleAppRoutes(app: FastifyInstance, opts: { config: Config; devMode?: boolean }) {
  const root = path.resolve(__dirname, '../../../web/console');
  const supabaseOrigin = new URL(opts.config.SUPABASE_URL).origin;
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com', "img-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin}`, "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
  app.addHook('onSend', async (req, reply) => {
    if (!(req.url === '/console' || req.url.startsWith('/console/'))) return;
    reply.header('Content-Security-Policy', csp).header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
  });
  app.get('/console', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/console/', 301));
  app.get('/console/config.json', { schema: { hide: true } }, async () => ({ supabaseUrl: opts.config.SUPABASE_URL, anonKey: opts.config.SUPABASE_KEY, dev: !!opts.devMode }));
  await app.register(fastifyStatic, { root, prefix: '/console/', index: ['index.html'], decorateReply: false });
}
