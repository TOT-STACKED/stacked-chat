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
import { manageRoutes } from './modules/manage/routes.js';
import { createResendMailer, type Mailer } from './lib/email.js';
import { billingRoutes, billingWebhookRoute } from './modules/billing/routes.js';
import { loadBillingConfig } from './modules/billing/config.js';
import { createBilling, type Billing } from './modules/billing/service.js';
import { createStripeApi, type StripeApi } from './modules/billing/stripe.js';
import { createSupabaseBillingStore, type BillingStore } from './modules/billing/store.js';
import { knowledgeRoutes } from './modules/knowledge/routes.js';
import { createKnowledge, type Knowledge } from './modules/knowledge/service.js';
import { createSupabaseKnowledgeStore, type KnowledgeStore } from './modules/knowledge/store.js';
import { insightsRoutes } from './modules/insights/routes.js';
import { brandingRoutes } from './modules/branding/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { consoleRoutes, parseStaff } from './modules/console/routes.js';
import { consoleAppRoutes } from './modules/console/app-routes.js';
import { createConsole, type ConsoleService } from './modules/console/service.js';
import { createCustomers } from './modules/console/customers.js';
import { createSupabaseConsoleStore, type ConsoleStore } from './modules/console/store.js';
import { chatAppRoutes } from './modules/chat/app-routes.js';
import { createChat, type Chat } from './modules/chat/service.js';
import { createAnthropicChatModel, type ChatModel } from './modules/chat/model.js';
import { createAnthropicPictureReader, type PictureReader } from './modules/knowledge/vision.js';
import { createSupabaseConversationStore, type ConversationStore } from './modules/chat/store.js';
import { createHelp, createSupabaseTicketStore, type Help, type TicketStore } from './modules/chat/help.js';
import { checkSlack, createSlackNotifier, type Notify } from './lib/slack.js';
import { createPortalMirror, createSupabaseNpsStore, type NpsMirror, type NpsStore } from './modules/chat/nps.js';
import { techStackRoutes } from './modules/vendors/routes.js';
import { createSupabaseTechStackStore, type TechStackStore } from './modules/vendors/store.js';
import { createSupabaseBrandingStore, type BrandingStore } from './modules/branding/store.js';
import { createSensitiveSettings, createSupabaseSensitiveStore, type SensitiveStore } from './modules/sensitive/store.js';
import { sensitiveRoutes } from './modules/sensitive/routes.js';
import { createOps, type Ops } from './modules/operations/service.js';
import { createSupabaseOpsStore, type OpsStore } from './modules/operations/store.js';
import { operationsRoutes } from './modules/operations/routes.js';
import { createPhoneAuth, type PhoneAuth } from './modules/phone-auth/service.js';
import { createSupabasePhoneCodeStore, type PhoneCodeStore } from './modules/phone-auth/store.js';
import { phoneAuthRoutes } from './modules/phone-auth/routes.js';
import { createTwilioSender, type SmsSender } from './lib/sms.js';
import { isPhoneKey } from './lib/phone.js';
import { createWork } from './modules/chat/work.js';
import { createTeam } from './modules/chat/team.js';
import { createAnthropicChecklistDrafter, type ChecklistDrafter } from './modules/operations/drafter.js';
import { createComms, type Comms } from './modules/communicate/service.js';
import { createSupabaseCommsStore, type CommsStore } from './modules/communicate/store.js';
import { communicateRoutes } from './modules/communicate/routes.js';
import { createTraining, type Training } from './modules/training/service.js';
import { createSupabaseTrainingStore, type TrainingStore } from './modules/training/store.js';
import { trainingRoutes } from './modules/training/routes.js';
import { createAnthropicCourseDrafter, type CourseDrafter } from './modules/training/drafter.js';
import { createSupport, type Support } from './modules/support/service.js';
import { supportRoutes } from './modules/support/routes.js';
import { createReminders } from './modules/operations/reminders.js';
import { createSignup } from './modules/signup/service.js';
import { signupRoutes } from './modules/signup/routes.js';
import { startAppRoutes } from './modules/signup/app-routes.js';
import { createInsights, type Insights } from './modules/insights/service.js';
import { createSupabaseInsightsStore, type InsightsStore } from './modules/insights/store.js';
import { createAnthropicDrafter, type AnswerDrafter } from './modules/insights/drafter.js';

declare module 'fastify' {
  interface FastifyInstance { billing: Billing | null; knowledge: Knowledge | null; /** one reminder pass (checklists not done by their due time); null when email or the database is off */ opsReminders: (() => Promise<{ checked: number; sent: number }>) | null }
}

export interface Deps {
  config: Config;
  db?: Db;
  repo?: Repo;
  verifyToken?: TokenVerifier;
  mailer?: Mailer;
  /** sends text messages; null = switched off */
  sms?: SmsSender | null;
  phoneCodeStore?: PhoneCodeStore;
  stripe?: StripeApi;
  billingStore?: BillingStore;
  knowledgeStore?: KnowledgeStore;
  insightsStore?: InsightsStore;
  brandingStore?: BrandingStore;
  sensitiveStore?: SensitiveStore;
  opsStore?: OpsStore;
  commsStore?: CommsStore;
  trainingStore?: TrainingStore;
  /** writes a first draft of a course from a document; null = switched off */
  courseDrafter?: CourseDrafter | null;
  /** writes a first draft of a checklist from a description; null = switched off */
  checklistDrafter?: ChecklistDrafter | null;
  /** tests: tighter or looser sign-up limits */
  signupLimits?: { perIpPerHour?: number; perEmailPerHour?: number; allPerHour?: number };
  conversationStore?: ConversationStore;
  ticketStore?: TicketStore;
  notify?: Notify | null;
  consoleStore?: ConsoleStore;
  techStackStore?: TechStackStore;
  npsStore?: NpsStore;
  mirrorNps?: NpsMirror | null;
  chatModel?: ChatModel | null;
  storage?: { pathFromUrl?(url: unknown): string | null; signUrls(urls: Array<string | null | undefined>, ttlSeconds?: number): Promise<Array<string | null>>; uploadObject?(path: string, data: Uint8Array, contentType: string): Promise<string> } | null;
  /** reads writing off pictures (spec cards, menus); null = switched off */
  pictureReader?: PictureReader | null;
  drafter?: AnswerDrafter | null;
  now?: () => Date;
}

/** Standard error envelope for the whole API: { error: { code, message, details? } } */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export async function buildApp(
  config: Config,
  overrides: Partial<Deps> & { logStream?: { write(msg: string): void }; limits?: { user?: number; key?: number }; devMode?: boolean } = {},
): Promise<FastifyInstance> {
  const db = overrides.db ?? (config.SUPABASE_SERVICE_KEY
    ? createSupabaseDb({ url: config.SUPABASE_URL, serviceKey: config.SUPABASE_SERVICE_KEY })
    : undefined);
  const repo = overrides.repo ?? (db ? createSupabaseRepo(db) : undefined);
  const idempotency = new IdempotencyStore();
  const realMailer = overrides.mailer ?? (config.RESEND_API_KEY
    ? createResendMailer({ apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM ?? 'Stacked Chat <onboarding@resend.dev>' })
    : undefined);
  // People who sign in with a mobile number have no email: anything addressed to their placeholder is quietly skipped, never sent.
  const mailer: Mailer | undefined = realMailer ? { send: (m) => (isPhoneKey(m.to) ? Promise.resolve('skipped' as const) : realMailer.send(m)) } : undefined;
  // Text messages and sign-in by mobile number. Off unless the SMS provider and AUTH_SECRET are both set.
  const sms: SmsSender | null = overrides.sms !== undefined ? overrides.sms
    : (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM ? createTwilioSender({ accountSid: config.TWILIO_ACCOUNT_SID, authToken: config.TWILIO_AUTH_TOKEN, from: config.TWILIO_FROM, log: (msg, info) => app.log.warn(info, msg) }) : null);
  const phoneCodes = overrides.phoneCodeStore ?? (db ? createSupabasePhoneCodeStore(db) : null);
  const phoneAuth: PhoneAuth | null = repo && sms && phoneCodes && config.AUTH_SECRET ? createPhoneAuth({ store: phoneCodes, repo, sms, secret: config.AUTH_SECRET, now: overrides.now }) : null;
  const supabaseVerify = overrides.verifyToken ?? createSupabaseTokenVerifier({ url: config.SUPABASE_URL, anonKey: config.SUPABASE_KEY });
  const verifyToken: TokenVerifier = async (token) => (phoneAuth && token.startsWith('st1.') ? phoneAuth.asVerifiedUser(token) : supabaseVerify(token));
  const deps: Deps = { config, db, repo, verifyToken };

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Never write credentials to logs.
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'],
      ...(overrides.logStream ? { stream: overrides.logStream } : {}),
    },
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID()),
    // trust exactly this many proxies (see TRUST_PROXY_HOPS); unset trusts the header as sent
    trustProxy: config.TRUST_PROXY_HOPS === undefined ? true : (_addr: string, hop: number) => hop < config.TRUST_PROXY_HOPS!,
  });

  // Safe defaults on every response (a route or the static files may set its own first)
  app.addHook('onSend', async (req, reply) => {
    if (!reply.hasHeader('x-content-type-options')) reply.header('X-Content-Type-Options', 'nosniff');
    if (req.headers['x-forwarded-proto'] === 'https' && !reply.hasHeader('strict-transport-security')) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
  });
  // TEMPORARY: shows what the host's proxies put in X-Forwarded-For, to choose TRUST_PROXY_HOPS. Returns only the caller's own request details.
  app.get('/api/v1/diag/ip', { schema: { hide: true } }, async (req) => ({ xff: req.headers['x-forwarded-for'] ?? null, ip: req.ip, ips: req.ips ?? null, socket: req.socket.remoteAddress ?? null, proto: req.headers['x-forwarded-proto'] ?? null, cf: !!req.headers['cf-connecting-ip'], trueClient: req.headers['true-client-ip'] ?? null }));

  // Billing (Stripe, test mode). Off, and failing closed, unless every Stripe setting is present.
  const billingCfg = loadBillingConfig(config);
  const billingStore = overrides.billingStore ?? (db ? createSupabaseBillingStore(db) : undefined);
  const billing: Billing | null = billingCfg.ok && billingStore
    ? createBilling({
        store: billingStore,
        stripe: overrides.stripe ?? createStripeApi({ secretKey: billingCfg.config.secretKey }),
        config: billingCfg.config,
        mailer,
        orgName: async (id) => (await repo?.getOrg(id))?.name ?? null,
        log: app.log,
        now: overrides.now,
      })
    : null;
  app.decorate('billing', billing);
  const knowledgeStore = overrides.knowledgeStore ?? (db ? createSupabaseKnowledgeStore(db) : undefined);
  const knowledge: Knowledge | null = knowledgeStore ? createKnowledge({ store: knowledgeStore, log: app.log }) : null;
  app.decorate('knowledge', knowledge);
  const insightsStore = overrides.insightsStore ?? (db ? createSupabaseInsightsStore(db) : undefined);
  const drafter = overrides.drafter !== undefined ? overrides.drafter : (config.ANTHROPIC_API_KEY ? createAnthropicDrafter({ apiKey: config.ANTHROPIC_API_KEY, model: config.INSIGHTS_MODEL }) : null);
  const brandingStore = overrides.brandingStore ?? (db ? createSupabaseBrandingStore(db) : null);
  const sensitiveStore = overrides.sensitiveStore ?? (db ? createSupabaseSensitiveStore(db) : null);
  const sensitiveSettings = sensitiveStore ? createSensitiveSettings(sensitiveStore, { now: overrides.now ? () => overrides.now!().getTime() : undefined }) : null;
  const opsStore = overrides.opsStore ?? (db ? createSupabaseOpsStore(db) : null);
  const ops: Ops | null = opsStore ? createOps({ store: opsStore, now: overrides.now }) : null;
  const commsStore = overrides.commsStore ?? (db ? createSupabaseCommsStore(db) : null);
  const comms: Comms | null = commsStore && repo ? createComms({ store: commsStore, repo, mailer, publicUrl: config.PUBLIC_URL, now: overrides.now }) : null;
  const trainingStore = overrides.trainingStore ?? (db ? createSupabaseTrainingStore(db) : null);
  const training: Training | null = trainingStore && repo ? createTraining({ store: trainingStore, repo, now: overrides.now }) : null;
  const supportHook = config.SUPPORT_SLACK_WEBHOOK_URL ?? config.SLACK_WEBHOOK_URL;
  const supportNotify = overrides.notify !== undefined ? overrides.notify : (supportHook ? createSlackNotifier(supportHook) : null);
  const support: Support | null = repo ? createSupport({ repo, tickets: overrides.ticketStore ?? (db ? createSupabaseTicketStore(db) : null), notify: supportNotify, mailer, supportEmail: config.SUPPORT_EMAIL, now: overrides.now ? () => overrides.now!().getTime() : undefined }) : null;
  const reminders = repo && opsStore && mailer ? createReminders({ store: opsStore, repo, mailer, publicUrl: config.PUBLIC_URL, now: overrides.now, log: app.log }) : null;
  app.decorate('opsReminders', reminders ? () => reminders.run() : null);
  const conversationStore = overrides.conversationStore ?? (db ? createSupabaseConversationStore(db) : null);
  const chatModel = overrides.chatModel !== undefined ? overrides.chatModel : (config.ANTHROPIC_API_KEY ? createAnthropicChatModel({ apiKey: config.ANTHROPIC_API_KEY, model: config.CHAT_MODEL }) : null);
  const adopted = new Map<string, number>(); // organisations whose older content we brought into the catalogue recently
  const chat: Chat | null = knowledge && conversationStore ? createChat({
    items: async (orgId) => {
      if (!adopted.has(orgId) || Date.now() - adopted.get(orgId)! > 300_000) { adopted.set(orgId, Date.now()); return knowledge.list(orgId); }
      return knowledgeStore!.listItems(orgId);
    },
    conversations: conversationStore, model: chatModel,
    signUrls: overrides.storage ? async (urls) => overrides.storage!.signUrls(urls) as Promise<Array<string | null>> : undefined,
    onAnswered: (siteId) => { void billing?.recordQuestion(siteId); },
    training: training ? (who) => training.listFor({ orgId: who.orgId, siteId: who.siteId, email: who.email, teamIds: who.teamIds }) : undefined,
    work: ops || comms || training ? createWork({ ops, comms, training }) : undefined,
    team: repo && (ops || comms || training) ? createTeam({ repo, ops, comms, training }) : undefined,
    sensitive: sensitiveSettings ? (orgId) => sensitiveSettings.enabled(orgId) : undefined,
    nps: overrides.npsStore ?? (db ? createSupabaseNpsStore(db) : null),
    mirrorNps: overrides.mirrorNps !== undefined ? overrides.mirrorNps : (config.STACKCOLLECT_SUPABASE_URL && config.STACKCOLLECT_SUPABASE_KEY ? createPortalMirror({ url: config.STACKCOLLECT_SUPABASE_URL, key: config.STACKCOLLECT_SUPABASE_KEY }) : null),
  }) : null;
  const help: Help | null = repo && conversationStore
    ? createHelp({ repo, tickets: overrides.ticketStore ?? (db ? createSupabaseTicketStore(db) : null), mailer, conversations: conversationStore, publicUrl: config.PUBLIC_URL,
        sensitive: sensitiveSettings ? (orgId) => sensitiveSettings.enabled(orgId) : undefined,
        notify: overrides.notify !== undefined ? overrides.notify : (config.SLACK_WEBHOOK_URL ? createSlackNotifier(config.SLACK_WEBHOOK_URL) : null) })
    : null;
  const techStackStore = overrides.techStackStore ?? (db ? createSupabaseTechStackStore(db) : null);
  const consoleStore = overrides.consoleStore ?? (db ? createSupabaseConsoleStore(db) : null);
  const consoleSvc: ConsoleService | null = consoleStore && billingStore
    ? createConsole({ store: consoleStore, billing: billingStore, fairUse: { aiQuestionsPerMonth: config.FAIR_USE_AI_QUESTIONS, staffPerVenue: config.FAIR_USE_STAFF_PER_VENUE }, now: overrides.now })
    : null;
  const insights: Insights | null = insightsStore && knowledge ? createInsights({ store: insightsStore, knowledge, drafter }) : null;
  const billingReason = billingCfg.ok ? 'Billing needs the database to be configured' : billingCfg.reason;
  if (!billing) app.log.info({ reason: billingReason }, 'billing disabled');
  const gate = async (orgId: string) => { await billing?.assertWritable(orgId); };

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
  await app.register(async (instance) => orgRoutes(instance, { repo, idempotency, mailer, sms, publicUrl: config.PUBLIC_URL, gate, onSiteAdded: (orgId) => { void billing?.syncQuietly(orgId); } }));
  await app.register(async (instance) => teamRoutes(instance, { repo, gate }));
  await app.register(async (instance) => manageRoutes(instance, { config, devMode: overrides.devMode, phoneSignin: !!phoneAuth }));
  await app.register(async (instance) => apiKeyRoutes(instance, { repo, idempotency, gate }));
  const pictureReader = overrides.pictureReader !== undefined ? overrides.pictureReader : (config.ANTHROPIC_API_KEY ? createAnthropicPictureReader({ apiKey: config.ANTHROPIC_API_KEY, model: config.CHAT_MODEL }) : null);
  await app.register(async (instance) => knowledgeRoutes(instance, { knowledge, gate, files: overrides.storage ?? null, reader: pictureReader }));
  await app.register(async (instance) => brandingRoutes(instance, { store: brandingStore, repo, gate }));
  await app.register(async (instance) => sensitiveRoutes(instance, { settings: sensitiveSettings, gate }));
  await app.register(async (instance) => communicateRoutes(instance, { comms, gate }));
  await app.register(async (instance) => trainingRoutes(instance, { training, gate, knowledge, drafter: overrides.courseDrafter !== undefined ? overrides.courseDrafter : (config.ANTHROPIC_API_KEY ? createAnthropicCourseDrafter({ apiKey: config.ANTHROPIC_API_KEY, model: config.CHAT_MODEL }) : null) }));
  await app.register(async (instance) => phoneAuthRoutes(instance, { phoneAuth, now: overrides.now ? () => overrides.now!().getTime() : undefined }));
  await app.register(async (instance) => supportRoutes(instance, { support }));
  await app.register(async (instance) => operationsRoutes(instance, { ops, repo, gate, reminders: app.opsReminders, cronSecret: config.CRON_SECRET, knowledge, drafter: overrides.checklistDrafter !== undefined ? overrides.checklistDrafter : (config.ANTHROPIC_API_KEY ? createAnthropicChecklistDrafter({ apiKey: config.ANTHROPIC_API_KEY, model: config.CHAT_MODEL }) : null) }));
  await app.register(async (instance) => chatRoutes(instance, { chat, repo, ops, comms, training, branding: brandingStore, insights: insightsStore ?? null, techStack: techStackStore, help }));
  await app.register(async (instance) => techStackRoutes(instance, { store: techStackStore, repo, gate }));
  await app.register(async (instance) => chatAppRoutes(instance, { config, devMode: overrides.devMode, phoneSignin: !!phoneAuth }));
  const customers = repo ? createCustomers({ repo, mailer, publicUrl: config.PUBLIC_URL, billing, notify: overrides.notify !== undefined ? overrides.notify : (config.SLACK_WEBHOOK_URL ? createSlackNotifier(config.SLACK_WEBHOOK_URL) : null) }) : null;
  await app.register(async (instance) => consoleRoutes(instance, { console: consoleSvc, staff: parseStaff(config.STACKED_STAFF_EMAILS), idempotency, customers, connections: {
    info: () => ({
      version: config.APP_VERSION,
      slack_alerts: !!config.SLACK_WEBHOOK_URL, slack_support: !!config.SUPPORT_SLACK_WEBHOOK_URL, slack_support_falls_back: !config.SUPPORT_SLACK_WEBHOOK_URL && !!config.SLACK_WEBHOOK_URL,
      email: !!config.RESEND_API_KEY, email_from: config.RESEND_FROM ?? null, support_inbox: config.SUPPORT_EMAIL ?? null,
      sms: !!sms, sms_from: sms ? config.TWILIO_FROM ?? null : null, phone_signin: !!phoneAuth, sms_last_error: sms?.lastError?.() ?? null,
      ai: !!config.ANTHROPIC_API_KEY, pictures: !!overrides.storage, database_admin: !!config.SUPABASE_SERVICE_KEY, billing: !!billing, nightly_job_secret: !!config.CRON_SECRET,
    }),
    test: async (to) => {
      const alerts = await checkSlack(config.SLACK_WEBHOOK_URL, '✅ *Stacked Chat test:* alerts (sign-ups, billing, help requests) are connected to this channel.');
      const support = config.SUPPORT_SLACK_WEBHOOK_URL ? await checkSlack(config.SUPPORT_SLACK_WEBHOOK_URL, '✅ *Stacked Chat test:* support requests will appear in this channel.') : null;
      const email = !mailer ? 'not_set' : (await mailer.send({ to, subject: 'Stacked Chat test email', text: 'This is a test from the Stacked Chat Console. If you can read this, email is connected.', html: '<p style="font-family:system-ui,sans-serif;font-size:15px">This is a test from the Stacked Chat Console. If you can read this, email is connected.</p>' })) === 'sent' ? 'sent' : 'failed';
      const smsCheck = sms?.check ? await sms.check() : null;
      return { alerts, support, support_uses_alerts: !config.SUPPORT_SLACK_WEBHOOK_URL, email, email_to: to, sms: smsCheck };
    },
  } }));
  await app.register(async (instance) => signupRoutes(instance, { signup: repo && customers ? createSignup({ repo, customers }) : null, now: overrides.now ? () => overrides.now!().getTime() : undefined, ...overrides.signupLimits }));
  await app.register(async (instance) => startAppRoutes(instance));
  await app.register(async (instance) => consoleAppRoutes(instance, { config, devMode: overrides.devMode }));
  await app.register(async (instance) => insightsRoutes(instance, { insights, store: insightsStore ?? null, gate }));
  const billingCtx = { billing, config: billingCfg.ok ? billingCfg.config : null, notConfiguredReason: billingReason };
  await app.register(async (instance) => billingRoutes(instance, billingCtx));
  await app.register(async (instance) => billingWebhookRoute(instance, billingCtx));

  return app;
}
