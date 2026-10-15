-- 003_tenancy: organisation -> site (venue) -> team -> member, plus API keys.
-- Purely additive: no existing column or table is changed or dropped, so the
-- running app keeps working while this is applied. Existing venues ARE the sites.
-- Safe to re-run.

begin;

do $$ begin
  create type public.member_role as enum ('owner', 'hq_admin', 'site_manager', 'staff', 'kiosk');
exception when duplicate_object then null; end $$;

create table if not exists public.organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  workspace_id text unique,            -- link to the legacy workspace_id / tenant text on documents, videos, venues
  plan         text not null default 'trial',
  created_at   timestamptz not null default now()
);

alter table public.venues    add column if not exists org_id uuid references public.organisations(id);
alter table public.documents add column if not exists org_id uuid references public.organisations(id);
alter table public.videos    add column if not exists org_id uuid references public.organisations(id);
alter table public.images    add column if not exists org_id uuid references public.organisations(id);
create index if not exists venues_org_idx    on public.venues(org_id);
create index if not exists documents_org_idx on public.documents(org_id);
create index if not exists videos_org_idx    on public.videos(org_id);

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations(id) on delete cascade,
  site_id    uuid references public.venues(id) on delete cascade,   -- null = organisation-wide team
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organisations(id) on delete cascade,
  site_id                 uuid references public.venues(id) on delete cascade,   -- null = whole organisation
  user_id                 uuid,                                                  -- auth.users.id once they have signed in
  email                   text not null,
  display_name            text,
  phone                   text,
  role                    public.member_role not null default 'staff',
  status                  text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  legacy_venue_member_id  uuid,
  created_at              timestamptz not null default now()
);
create unique index if not exists members_org_site_email_uq
  on public.members (org_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
create index if not exists members_user_idx  on public.members(user_id);
create index if not exists members_email_idx on public.members(lower(email));

create table if not exists public.member_teams (
  member_id uuid not null references public.members(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  primary key (member_id, team_id)
);

-- API keys: only the SHA-256 hash is stored; the key itself is shown once at creation.
create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  site_id       uuid references public.venues(id) on delete cascade,  -- null = all sites in the organisation
  name          text not null,
  scopes        text[] not null default '{}',
  key_prefix    text not null,
  key_hash      text not null unique,
  created_by    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);
create index if not exists api_keys_org_idx on public.api_keys(org_id);

-- Helpers for row-level policies (used by realtime/feeds in later phases).
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active');
$$;
create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and m.role = any(p_roles));
$$;

-- Row-level security: ON everywhere, deny-all to the public key. The server (service role)
-- is the door. The one exception: a signed-in user may read THEIR OWN membership rows.
alter table public.organisations enable row level security;
alter table public.teams         enable row level security;
alter table public.members       enable row level security;
alter table public.member_teams  enable row level security;
alter table public.api_keys      enable row level security;
revoke all on public.organisations, public.teams, public.members, public.member_teams, public.api_keys from anon, authenticated;

grant select on public.members to authenticated;
drop policy if exists "members read own" on public.members;
create policy "members read own" on public.members for select to authenticated using (user_id = auth.uid());

commit;
