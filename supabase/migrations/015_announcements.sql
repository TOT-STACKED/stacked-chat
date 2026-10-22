-- 015_announcements: Communicate. Updates a manager sends to a venue, a team or the whole company, and who has read them.
-- Additive and safe to re-run. Only the server (service role) reads or writes these tables.
--   * announcements:      the update. site_id / team_id both null = the whole company. A team update carries the team's venue (or null if the team is company-wide).
--   * announcement_reads: one row per person (email) per update: when they opened it and, if asked, when they confirmed it.

begin;

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  site_id       uuid references public.venues(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete cascade,
  title         text not null,
  body          text not null,
  requires_ack  boolean not null default false,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists announcements_org_idx on public.announcements (org_id, created_at desc);

create table if not exists public.announcement_reads (
  announcement_id  uuid not null references public.announcements(id) on delete cascade,
  email            text not null,
  read_at          timestamptz not null default now(),
  acked_at         timestamptz,
  primary key (announcement_id, email)
);

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
revoke all on public.announcements from anon, authenticated;
revoke all on public.announcement_reads from anon, authenticated;

commit;
