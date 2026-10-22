-- 014_checklist_reminders: remind managers when a checklist is not done by its due time.
-- Additive and safe to re-run.
--   * checklists.due_time    "HH:MM" UK time; empty = no reminder
--   * checklists.remind_days days of the week to check (0 = Sunday ... 6 = Saturday), so a closed day sends nothing
--   * checklist_reminders    one row per checklist, per venue, per day once a reminder has gone, so it is never sent twice

begin;

alter table public.checklists add column if not exists due_time text check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.checklists add column if not exists remind_days smallint[] not null default '{0,1,2,3,4,5,6}';

create table if not exists public.checklist_reminders (
  checklist_id  uuid not null references public.checklists(id) on delete cascade,
  site_id       uuid not null references public.venues(id) on delete cascade,
  run_date      date not null,
  sent_at       timestamptz not null default now(),
  primary key (checklist_id, site_id, run_date)
);

alter table public.checklist_reminders enable row level security;
revoke all on public.checklist_reminders from anon, authenticated;

commit;
