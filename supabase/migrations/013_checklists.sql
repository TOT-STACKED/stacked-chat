-- 013_checklists: Operations. Checklists a manager writes (opening, closing, anything) and the daily runs staff tick off.
-- Additive and safe to re-run. Only the server (service role) reads or writes these tables.
--   * checklists:      the list itself. site_id null = every venue in the company.
--   * checklist_runs:  one shared run per checklist, per venue, per day. Whoever is on shift ticks items; ticks keep who and when.

begin;

create table if not exists public.checklists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  site_id     uuid references public.venues(id) on delete cascade,
  title       text not null,
  kind        text not null default 'custom' check (kind in ('opening', 'closing', 'custom')),
  items       jsonb not null default '[]'::jsonb,       -- [{ "id": "...", "text": "..." }]
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists checklists_org_idx on public.checklists (org_id, active);

create table if not exists public.checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.checklists(id) on delete cascade,
  org_id        uuid not null references public.organisations(id) on delete cascade,
  site_id       uuid not null references public.venues(id) on delete cascade,
  run_date      date not null,                          -- the venue's day (UK time)
  ticks         jsonb not null default '{}'::jsonb,     -- { "<item id>": { "by": "email", "at": "iso time" } }
  completed_by  text,
  completed_at  timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (checklist_id, site_id, run_date)
);
create index if not exists checklist_runs_org_idx on public.checklist_runs (org_id, run_date desc);

alter table public.checklists enable row level security;
alter table public.checklist_runs enable row level security;
revoke all on public.checklists from anon, authenticated;
revoke all on public.checklist_runs from anon, authenticated;

commit;
