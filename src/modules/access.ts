import type { FastifyRequest } from 'fastify';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { isOrgMember, type KeyPrincipal, type Principal, type UserPrincipal } from '../lib/permissions.js';

export const principalOf = (req: FastifyRequest): Principal => req.principal ?? (() => { throw unauthorized(); })();

/** Endpoints that only a signed-in person may use (never an API key): key & member management. */
export function userOnly(req: FastifyRequest): UserPrincipal {
  const p = principalOf(req);
  if (p.kind !== 'user') throw forbidden('This endpoint requires a signed-in user, not an API key');
  return p;
}

/**
 * Can this caller see this organisation at all? Non-members get a 404 (don't reveal that it exists).
 * API keys additionally need the named scope.
 */
export function assertOrgAccess(req: FastifyRequest, orgId: string, keyScope?: string): Principal {
  const p = principalOf(req);
  if (p.kind === 'user') {
    if (!isOrgMember(p, orgId)) throw notFound('Organisation not found');
  } else {
    if (p.orgId !== orgId) throw notFound('Organisation not found');
    if (keyScope && !p.scopes.includes(keyScope)) throw forbidden(`API key lacks required scope: ${keyScope}`);
  }
  return p;
}

export const asKey = (p: Principal): KeyPrincipal | null => (p.kind === 'api_key' ? p : null);
