import { z } from 'zod';

/** Environment the modern (TypeScript) API needs. The legacy server passes these in explicitly. */
export const schema = z.object({
  SUPABASE_URL: z.string().url(),
  /** anon key: only used to ask Supabase Auth who a session token belongs to. Never for data. */
  SUPABASE_KEY: z.string().min(1),
  /** service-role key: server-side data access. Optional so the app still boots (and says so) without it. */
  SUPABASE_SERVICE_KEY: z.string().optional(),
  /** Resend (invite emails). Optional: without it invites are saved but no email is sent. */
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  /** Text messages (Twilio): sign-in codes and invitations for staff who sign in with a mobile number. Optional: without all three, phone sign-in is off. */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** the sender: a name (letters, up to 11, such as StackedChat), a number, or a Messaging Service id (MG...) */
  TWILIO_FROM: z.string().optional(),
  /** Signs phone sessions and hashes sign-in codes. At least 32 random characters. Phone sign-in is off without it. */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Public base URL used in links inside emails. */
  PUBLIC_URL: z.string().url().default('https://stackedchat.io'),
  /** Billing (Stripe, test mode). Billing stays switched off, and fails closed, unless ALL of these are set. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STANDARD_MONTHLY: z.string().optional(),
  STRIPE_PRICE_STANDARD_ANNUAL: z.string().optional(),
  STRIPE_PRICE_GROUP_MONTHLY: z.string().optional(),
  STRIPE_PRICE_GROUP_ANNUAL: z.string().optional(),
  STRIPE_PRICE_LARGE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_LARGE_ANNUAL: z.string().optional(),
  /** Only "true" lets a live Stripe key work. Leave unset while testing. */
  STRIPE_ALLOW_LIVE: z.string().optional(),
  /** Fair use: a venue over either limit is flagged for review, never blocked. */
  FAIR_USE_AI_QUESTIONS: z.coerce.number().int().positive().default(2000),
  FAIR_USE_STAFF_PER_VENUE: z.coerce.number().int().positive().default(75),
  CRON_SECRET: z.string().optional(),
  /** A Slack Incoming Webhook for the support channel. Optional: without it, support requests use SLACK_WEBHOOK_URL. */
  SUPPORT_SLACK_WEBHOOK_URL: z.string().url().optional(),
  /** Where "Get help" requests are also emailed (replying goes straight to the customer). Optional: Slack still gets them. */
  SUPPORT_EMAIL: z.string().email().optional(),
  /** Who may open the Stacked staff Console: a comma-separated list of verified email addresses. Empty = Console off. */
  STACKED_STAFF_EMAILS: z.string().optional(),
  /** Insights: lets Stacked Chat write DRAFT answers for questions it could not answer. Optional: without it, drafts are blank templates. */
  ANTHROPIC_API_KEY: z.string().optional(),
  INSIGHTS_MODEL: z.string().default('claude-sonnet-4-6'),
  /** The model that answers staff questions in the chat. */
  CHAT_MODEL: z.string().default('claude-sonnet-4-6'),
  /** Vendor ratings are also copied here (the partner portal). Optional. */
  STACKCOLLECT_SUPABASE_URL: z.string().optional(),
  STACKCOLLECT_SUPABASE_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.string().default('development'),
  APP_VERSION: z.string().default('dev'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
