import { z } from 'zod';

/** Environment the modern (TypeScript) API needs. The legacy server passes these in explicitly. */
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  /** anon key: only used to ask Supabase Auth who a session token belongs to. Never for data. */
  SUPABASE_KEY: z.string().min(1),
  /** service-role key: server-side data access. Optional so the app still boots (and says so) without it. */
  SUPABASE_SERVICE_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.string().default('development'),
  APP_VERSION: z.string().default('dev'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
