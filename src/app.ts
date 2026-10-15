import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { randomUUID } from 'node:crypto';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createSupabaseDb, type Db } from './lib/supabase.js';
import { healthRoutes } from './modules/health/routes.js';

export interface Deps {
  config: Config;
  db?: Db;
}

/** Standard error envelope for the whole API: { error: { code, message, details? } } */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export async function buildApp(
  config: Config,
  overrides: Partial<Deps> & { logStream?: { write(msg: string): void } } = {},
): Promise<FastifyInstance> {
  const db = overrides.db ?? (config.SUPABASE_SERVICE_KEY
    ? createSupabaseDb({ url: config.SUPABASE_URL, serviceKey: config.SUPABASE_SERVICE_KEY })
    : undefined);
  const deps: Deps = { config, db };

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Never write credentials to logs.
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'],
      ...(overrides.logStream ? { stream: overrides.logStream } : {}),
    },
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID()),
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Stacked Chat API',
        version: '1.0.0',
        description: 'Open API for Stacked Chat: AI knowledge and team comms for hospitality operators.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'Supabase session token (signed-in user)' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Organisation API key (sk_live_...)' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    let status = typeof e.statusCode === 'number' ? e.statusCode : 500;
    let body: ApiError;
    if (hasZodFastifySchemaValidationErrors(err)) {
      status = 400;
      body = { error: { code: 'validation_error', message: 'Request failed validation', details: err.validation } };
    } else if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      body = { error: { code: 'internal_error', message: 'Something went wrong' } };
    } else {
      body = { error: { code: e.code ?? 'bad_request', message: e.message ?? 'Bad request' } };
    }
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: { code: 'not_found', message: 'No such endpoint' } } satisfies ApiError);
  });

  // The generated OpenAPI document (single source of truth: the zod schemas on each route).
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(async (instance) => healthRoutes(instance, deps));

  return app;
}
