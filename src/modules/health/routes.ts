import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Deps } from '../../app.js';

const Query = z.object({ deep: z.coerce.boolean().optional() });
const Response = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime_seconds: z.number(),
  time: z.string(),
  database: z.enum(['ok', 'error', 'skipped', 'not_configured']),
});

export async function healthRoutes(app: FastifyInstance, deps: Deps) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/healthz',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness (and optional database) check',
        querystring: Query,
        response: { 200: Response },
      },
    },
    async (req) => {
      let database: z.infer<typeof Response>['database'] = 'skipped';
      if (req.query.deep) database = !deps.db ? 'not_configured' : (await deps.db.ping()) ? 'ok' : 'error';
      return {
        status: 'ok' as const,
        version: deps.config.APP_VERSION,
        uptime_seconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
        database,
      };
    },
  );
}
