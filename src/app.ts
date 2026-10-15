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
import { createSupabaseRepo } from './lib/supabase-repo.js';
import type { Repo } from './lib/repo.js';
import { registerAuth, createSupabaseTokenVerifier, type TokenVerifier } from './lib/auth.js';
import { ApiHttpError } from './lib/errors.js';
import { IdempotencyStore } from './lib/idempotency.js';
import { RateLimiter } from './lib/rate-limit.js';
import { healthRoutes } from './modules/health/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { orgRoutes } from './modules/orgs/routes.js';
import { apiKeyRoutes } from './modules/api-keys/routes.js';
import { teamRoutes } from './modules/teams/routes.js';
import { createResendMailer, type Mailer } from './lib/email.js';

export interface Deps {
  config: Config;
  db?: Db;
  repo?: Repo;
  verifyToken?: TokenVerifier;
  mailer?: Mailer;
}

/** Standard error envelope for the whole API: { error: { code, message, details? } } */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export async function buildApp(
  config: Config,
  overrides: Partial<Deps> & { logStream?: { write(msg: string): void }; limits?: { user?: number; key?: number } } = {},
): Promise<FastifyInstance> {
  const db = overrides.db ?? (config.SUPABASE_SERVICE_KEY
    ? createSupabaseDb({ url: config.SUPABASE_URL, serviceKey: config.SUPABASE_SERVICE_KEY })
    : undefined);
  const repo = overrides.repo ?? (db ? createSupabaseRepo(db) : undefined);
  const verifyToken = overrides.verifyToken ?? createSupabaseTokenVerifier({ url: config.SUPABASE_URL, anonKey: config.SUPABASE_KEY });
  const idempotency = new IdempotencyStore();
  const mailer = overrides.mailer ?? (config.RESEND_API_KEY
    ? createResendMailer({ apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM ?? 'Stacked Chat <onboarding@resend.dev>' })
    : undefined);
  const deps: Deps = { config, db, repo, verifyToken };

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
    if (err instanceof ApiHttpError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
    } else if (hasZodFastifySchemaValidationErrors(err)) {
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

  registerAuth(app, {
    repo,
    verifyToken,
    userLimiter: new RateLimiter(overrides.limits?.user ?? 120),
    keyLimiter: new RateLimiter(overrides.limits?.key ?? 600),
    failLimiter: new RateLimiter(60),
  });

  await app.register(async (instance) => healthRoutes(instance, deps));
  await app.register(async (instance) => meRoutes(instance));
  await app.register(async (instance) => orgRoutes(instance, { repo, idempotency, mailer, publicUrl: config.PUBLIC_URL }));
  await app.register(async (instance) => teamRoutes(instance, { repo }));
  await app.register(async (instance) => apiKeyRoutes(instance, { repo, idempotency }));

  return app;
}
