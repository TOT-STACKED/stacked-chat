-- 016_training: Training. Short courses a manager writes (lessons, an optional quiz) and the sign-off each person records.
-- Additive and safe to re-run. Only the server (service role) reads or writes these tables.
--   * training_courses:      the course. site_id / team_id both null = the whole company. A team course carries the team's venue.
--   * training_completions:  one row each time someone passes (or signs off) a course. A renewal adds a new row; the latest counts.

begin;

create table if not exists public.training_courses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  site_id       uuid references public.venues(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete cascade,
  title         text not null,
  description   text,
  lessons       jsonb not null default '[]'::jsonb,    -- [{ "id", "title", "body", "url" }]
  quiz          jsonb not null default '[]'::jsonb,    -- [{ "id", "q", "options": [...], "answer": 0 }]  (answers never leave the server for staff)
  pass_percent  integer not null default 80 check (pass_percent between 50 and 100),
  renew_months  integer check (renew_months is null or renew_months between 1 and 60),
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists training_courses_org_idx on public.training_courses (org_id, active);

create table if not exists public.training_completions (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.training_courses(id) on delete cascade,
  org_id        uuid not null references public.organisations(id) on delete cascade,
  email         text not null,
  score         integer,                                -- percent; null when the course has no quiz (signed off instead)
  completed_at  timestamptz not null default now()
);
create index if not exists training_completions_course_idx on public.training_completions (course_id, email, completed_at desc);

alter table public.training_courses enable row level security;
alter table public.training_completions enable row level security;
revoke all on public.training_courses from anon, authenticated;
revoke all on public.training_completions from anon, authenticated;

commit;
