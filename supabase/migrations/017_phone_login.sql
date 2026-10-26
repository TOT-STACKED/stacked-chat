-- 017_phone_login: staff sign in with a mobile number and a texted code. Additive and safe to re-run.
-- Only the server (service role) reads or writes this table. A code is stored only as a keyed hash, and expires after 10 minutes.
begin;

create table if not exists public.phone_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                    -- E.164, for example +447700900123
  code_hash   text not null,
  attempts    integer not null default 0,       -- wrong guesses so far; the code dies after 5
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists phone_codes_phone_idx on public.phone_codes (phone, created_at desc);

alter table public.phone_codes enable row level security;   -- no policies: nothing but the service role can touch it

-- people added by number have no email: their email column holds "<digits>@phone.invalid", and their number is kept here too
alter table public.members add column if not exists phone text;

commit;
