import { createHash, randomBytes } from 'node:crypto';

/**
 * API keys: sk_live_<40 url-safe chars>, shown to the customer ONCE.
 * Only sha256(key) and a short display prefix are stored.
 */
export const KEY_PREFIX = 'sk_live_';
export const API_SCOPES = [
  'chat', 'sites:read', 'members:read', 'kb:read', 'kb:write',
  'tickets:read', 'tickets:write', 'conversations:read', 'webhooks',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const generateKey = () => KEY_PREFIX + randomBytes(30).toString('base64url');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const displayPrefix = (key: string) => key.slice(0, KEY_PREFIX.length + 6);

/** Pull an API key out of `X-API-Key` or `Authorization: Bearer sk_live_...`. Null if absent/malformed. */
export function extractApiKey(headers: Record<string, string | string[] | undefined>): string | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const xk = one(headers['x-api-key'])?.trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(one(headers['authorization']) ?? '')?.[1];
  const token = xk || bearer;
  return token && token.startsWith(KEY_PREFIX) && token.length >= KEY_PREFIX.length + 20 ? token : null;
}
