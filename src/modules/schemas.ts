import { z } from 'zod';
import { ROLES } from '../lib/permissions.js';

export const Id = z.guid();
export const RoleEnum = z.enum(ROLES);
export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });

export const SiteOut = z.object({ id: Id, org_id: Id, name: z.string(), slug: z.string(), created_at: z.string().nullable() });
export const MemberOut = z.object({
  id: Id, org_id: Id, site_id: Id.nullable(), email: z.string(), display_name: z.string().nullable(),
  role: RoleEnum, status: z.enum(['invited', 'active', 'disabled']), created_at: z.string(),
});
export const ApiKeyOut = z.object({
  id: Id, org_id: Id, site_id: Id.nullable(), name: z.string(), scopes: z.array(z.string()),
  key_prefix: z.string(), created_at: z.string(), last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(), revoked: z.boolean(),
});

export const SECURITY: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { apiKey: [] }];
