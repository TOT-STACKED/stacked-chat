/** Fair use. Going over a limit flags the venue for review. It never blocks anyone. */
export interface FairUseLimits { aiQuestionsPerMonth: number; staffPerVenue: number }

export interface VenueUsage {
  site_id: string;
  name: string;
  tier: 'standard' | 'large';
  active: boolean;
  ai_questions: number;
  active_staff: number;
  over_ai: boolean;
  over_staff: boolean;
}

export function evaluateUsage(
  site: { id: string; name: string; billing_tier: 'standard' | 'large'; active: boolean },
  aiQuestions: number, activeStaff: number, limits: FairUseLimits,
): VenueUsage {
  return {
    site_id: site.id, name: site.name, tier: site.billing_tier, active: site.active,
    ai_questions: aiQuestions, active_staff: activeStaff,
    over_ai: aiQuestions > limits.aiQuestionsPerMonth,
    // the ~75 staff guide applies to standard venues; large venues (hotels etc.) are priced for more
    over_staff: site.billing_tier === 'standard' && activeStaff > limits.staffPerVenue,
  };
}

/** First day of the month in UTC, as YYYY-MM-DD (the usage table's key). */
export const monthKey = (d: Date = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
