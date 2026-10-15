import { CANCELED_RETENTION_DAYS, PAST_DUE_GRACE_DAYS } from './plans.js';

export interface AccountForGating {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
  trial_ends_at: string | null;
  has_payment_method: boolean;
  past_due_since: string | null;
  canceled_at: string | null;
}

/**
 * - unmanaged : no billing account yet (all current customers). Full access, never gated.
 * - full      : trialing or active.
 * - grace     : payment failed less than 7 days ago. Full access, admins see a banner.
 * - restricted: payment lapsed / trial ended without a card. Admins can read but not change things.
 * - canceled  : as restricted; data is kept for 90 days.
 * Staff are never locked out of reading handbooks, safety or compliance content in ANY mode.
 */
export type Mode = 'unmanaged' | 'full' | 'grace' | 'restricted' | 'canceled';

export interface BillingState {
  mode: Mode;
  /** may admins change things (add people, sites, content)? */
  writable: boolean;
  /** what an admin should be told, or null */
  banner: null | 'trial' | 'trial_ended' | 'past_due' | 'restricted' | 'canceled';
  grace_ends_at: string | null;
  trial_days_left: number | null;
  /** canceled organisations: after this date their data may be deleted */
  retention_ends_at: string | null;
}

const DAY = 86_400_000;

export function billingState(account: AccountForGating | null, now: Date = new Date()): BillingState {
  const base: BillingState = { mode: 'unmanaged', writable: true, banner: null, grace_ends_at: null, trial_days_left: null, retention_ends_at: null };
  if (!account) return base;

  switch (account.status) {
    case 'active':
      return { ...base, mode: 'full' };
    case 'trialing': {
      const end = account.trial_ends_at ? new Date(account.trial_ends_at).getTime() : null;
      const left = end === null ? null : Math.max(0, Math.ceil((end - now.getTime()) / DAY));
      if (end !== null && end <= now.getTime() && !account.has_payment_method) {
        return { ...base, mode: 'restricted', writable: false, banner: 'trial_ended', trial_days_left: 0 };
      }
      return { ...base, mode: 'full', banner: account.has_payment_method ? null : 'trial', trial_days_left: left };
    }
    case 'past_due': {
      const since = account.past_due_since ? new Date(account.past_due_since).getTime() : now.getTime();
      const graceEnd = since + PAST_DUE_GRACE_DAYS * DAY;
      if (now.getTime() < graceEnd) return { ...base, mode: 'grace', banner: 'past_due', grace_ends_at: new Date(graceEnd).toISOString() };
      return { ...base, mode: 'restricted', writable: false, banner: 'restricted', grace_ends_at: new Date(graceEnd).toISOString() };
    }
    case 'paused':
      return { ...base, mode: 'restricted', writable: false, banner: account.trial_ends_at ? 'trial_ended' : 'restricted' };
    case 'canceled': {
      const from = account.canceled_at ? new Date(account.canceled_at).getTime() : now.getTime();
      return { ...base, mode: 'canceled', writable: false, banner: 'canceled', retention_ends_at: new Date(from + CANCELED_RETENTION_DAYS * DAY).toISOString() };
    }
  }
}
