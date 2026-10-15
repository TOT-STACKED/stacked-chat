-- 007_billing: per-venue subscription billing (Stripe) and fair-use metering.
-- Additive and safe to re-run. Nothing existing changes behaviour:
--   * every venue defaults to billing_tier 'standard' and active = true
--   * an organisation with NO billing_accounts row is treated as "not billed yet" (full access),
--     so applying this does not restrict any current customer.

begin;

alter table public.venues add column if not exists billing_tier text not null default 'standard';
alter table public.venues add column if not exists active boolean not null default true;
do $$ begin
  alter table public.venues add constraint venues_billing_tier_chk check (billing_tier in ('standard', 'large'));
exception when duplicate_object then null; end $$;

create table if not exists public.billing_accounts (
  org_id                  uuid primary key references public.organisations(id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  status                  text not null default 'trialing'
                          check (status in ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  interval                text not null default 'month' check (interval in ('month', 'year')),
  trial_ends_at           timestamptz,
  has_payment_method      boolean not null default false,
  past_due_since          timestamptz,            -- set when a payment first fails, cleared when paid
  canceled_at             timestamptz,            -- data is kept for 90 days after this
  current_period_end      timestamptz,
  synced_lines            jsonb,                  -- what we last asked Stripe to charge (for idempotent sync)
  trial_reminder_sent_at  timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Every Stripe event we have handled, so a retried delivery is never processed twice.
create table if not exists public.stripe_events (
  id            text primary key,
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

-- AI questions per venue per month (staff numbers are counted live from members).
create table if not exists public.usage_monthly (
  site_id      uuid not null references public.venues(id) on delete cascade,
  month        date not null,
  ai_questions integer not null default 0,
  flagged_at   timestamptz,                       -- first time this venue went over a fair-use limit this month
  primary key (site_id, month)
);

-- Atomic "one more question" counter. Returns the new total for the month.
create or replace function public.usage_bump(p_site uuid, p_month date) returns integer
language sql security definer set search_path = public as $$
  insert into public.usage_monthly (site_id, month, ai_questions) values (p_site, p_month, 1)
  on conflict (site_id, month) do update set ai_questions = public.usage_monthly.ai_questions + 1
  returning ai_questions;
$$;

-- Deny-all to the public keys; only the server (service role) reads or writes billing data.
alter table public.billing_accounts enable row level security;
alter table public.stripe_events    enable row level security;
alter table public.usage_monthly    enable row level security;
revoke all on public.billing_accounts, public.stripe_events, public.usage_monthly from anon, authenticated;
revoke all on function public.usage_bump(uuid, date) from public, anon, authenticated;
grant execute on function public.usage_bump(uuid, date) to service_role;

commit;
