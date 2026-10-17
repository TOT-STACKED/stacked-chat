import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Serves the sign-up page (plain HTML/CSS/JS in /web/start, no build step) at /start/. It needs nothing from the browser
 * except to post one form to this same server, so the content policy allows no outside connections at all.
 */
export async function startAppRoutes(app: FastifyInstance) {
  const root = path.resolve(__dirname, '../../../web/start');
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
    "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');

  app.addHook('onSend', async (req, reply) => {
    if (!(req.url === '/start' || req.url.startsWith('/start/') || req.url.startsWith('/start?'))) return;
    reply.header('Content-Security-Policy', csp).header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-cache');
  });
  app.get('/start', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/start/', 301));
  await app.register(async (inner) => {
    await inner.register(fastifyStatic, { root, prefix: '/', index: ['index.html'] });
  }, { prefix: '/start' });
}
