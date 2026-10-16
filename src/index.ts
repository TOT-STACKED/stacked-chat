import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { StorageRuleError, buildPath, checkUpload, createStorage } from './lib/storage.js';

/**
 * Front door for the modern API. The legacy server.js asks `handles(url)` first and
 * hands matching requests here; everything else stays on the legacy code path.
 * That lets routes move into src/modules/* one at a time without breaking live URLs.
 */
export function createModernHandler(opts: { config: Partial<Config> & Record<string, unknown> }) {
  const config = loadConfig(opts.config as Record<string, string | undefined>);
  // Private file storage (signed reads / signed uploads). Only available with the service-role key.
  const storage = config.SUPABASE_SERVICE_KEY
    ? createStorage({ supabaseUrl: config.SUPABASE_URL, serviceKey: config.SUPABASE_SERVICE_KEY })
    : null;
  const appPromise = buildApp(config, { storage }).then(async (app) => {
    await app.ready();
    return app;
  });

  return {
    storage,
    storageRules: { buildPath, checkUpload, StorageRuleError },
    ready: appPromise.then(() => undefined),
    /** Legacy server.js calls these. Both never throw and never block the chat. */
    async recordQuestion(siteId: string): Promise<void> { (await appPromise).billing?.recordQuestion(siteId); },
    /** For the chat: published knowledge that belongs to a different site and so must not be shown to this one. */
    async knowledgeExcludedFor(siteId: string) { return (await appPromise).knowledge?.excludedFor(siteId) ?? { docs: [], videos: [], images: [] }; },
    async billingStateForSite(siteId: string) { return (await appPromise).billing?.stateForSite(siteId) ?? null; },
    handles(url: string): boolean {
      return url === '/healthz' || url.startsWith('/healthz?') || url === '/api/v1' || url.startsWith('/api/v1/') || url === '/manage' || url.startsWith('/manage/') || url === '/billing/webhook' || url.startsWith('/chat/');
    },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Idempotency-Key');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const app = await appPromise;
      app.routing(req, res);
    },
  };
}

export { buildApp, loadConfig };
