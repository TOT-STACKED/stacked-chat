-- 012_sensitive_topics: which sensitive topics each company has switched OFF.
-- Every topic is ON by default, so a company with no rows here is fully protected; a row only exists once an admin
-- changes a switch. Additive and safe to re-run. Only the server (service role) reads or writes it.

begin;

create table if not exists public.sensitive_topic_settings (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  topic      text not null check (topic in ('allergens', 'hr', 'incidents', 'legal')),
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, topic)
);

alter table public.sensitive_topic_settings enable row level security;
revoke all on public.sensitive_topic_settings from anon, authenticated;

commit;
