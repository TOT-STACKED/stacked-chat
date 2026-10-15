import type { Config } from '../src/config.js';

export const testConfig: Config = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'anon-test-key',
  SUPABASE_SERVICE_KEY: undefined,
  RESEND_API_KEY: undefined,
  RESEND_FROM: undefined,
  PUBLIC_URL: 'https://stackedchat.io',
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  APP_VERSION: 'test',
};

import type { Db } from '../src/lib/supabase.js';

export function fakeDb(pingResult: boolean): Db {
  return {
    ping: async () => pingResult,
    rest: async <T>() => ({ status: pingResult ? 200 : 500, data: null as T }),
  };
}
