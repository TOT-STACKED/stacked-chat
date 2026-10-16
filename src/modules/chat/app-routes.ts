import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from '../../config.js';

/**
 * Serves the chat web app (plain HTML/CSS/JS in /web/chat, no build step) at /chat/. It reuses a few files from
 * Manage (sign-in, API client, helpers) so there is one copy of each. /chat/config.json hands the browser ONLY
 * public values. A venue link like /chat/boxpark opens the same app (the page then picks that venue by its slug).
 */
export async function chatAppRoutes(app: FastifyInstance, opts: { config: Config; devMode?: boolean }) {
  const root = path.resolve(__dirname, '../../../web/chat');
  const supabaseOrigin = new URL(opts.config.SUPABASE_URL).origin;
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https:", // venue logos and photos are links to https images
    `connect-src 'self' ${supabaseOrigin}`, "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');

  app.addHook('onSend', async (req, reply) => {
    if (!(req.url === '/chat' || req.url.startsWith('/chat/'))) return;
    reply.header('Content-Security-Policy', csp).header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY').header('Cache-Control', 'no-cache');
  });
  app.get('/chat', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/chat/', 301));

  await app.register(async (inner) => {
    inner.get('/config.json', { schema: { hide: true } }, async () => ({ supabaseUrl: opts.config.SUPABASE_URL, anonKey: opts.config.SUPABASE_KEY, dev: !!opts.devMode }));
    await inner.register(fastifyStatic, { root, prefix: '/', index: ['index.html'] });
    // an address that is not a file (a venue link) opens the app; a missing file is a real 404
    inner.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0] ?? '';
      if (req.method === 'GET' && !/\.[a-z0-9]{1,6}$/i.test(pathname)) return reply.type('text/html').sendFile('index.html');
      return reply.status(404).send({ error: { code: 'not_found', message: 'No such file' } });
    });
  }, { prefix: '/chat' });
}
