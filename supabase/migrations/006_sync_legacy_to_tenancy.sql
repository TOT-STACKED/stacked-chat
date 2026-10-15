-- 006_sync_legacy_to_tenancy: while the old sign-up/team flows still write to `venues` and
-- `venue_members`, keep the new model (organisations / members) in step automatically.
-- When the legacy flows are retired these triggers can simply be dropped.
--   new venue                      -> gets an organisation (by workspace_id, else its own)
--   workspace_id set later         -> the venue's own organisation adopts that workspace
--   venue_members insert/update    -> members row (admin->site_manager, staff->staff;
--                                     the first admin of an organisation becomes owner)
--   venue_members delete           -> the member is disabled (never deleted)
-- Safe to re-run. The LAST statements fix any venue/member created since 004 ran.

create or replace function public.venues_assign_org() returns trigger
language plpgsql as $$
declare v_org uuid;
begin
  -- a workspace_id was just set on a venue that already has its own (workspace-less) organisation:
  -- let that organisation adopt the workspace, or move the venue if the workspace already exists
  if tg_op = 'UPDATE' and new.org_id is not null and coalesce(new.workspace_id, '') <> ''
     and new.workspace_id is distinct from old.workspace_id then
    select id into v_org from public.organisations where workspace_id = new.workspace_id;
    if v_org is null then
      update public.organisations set workspace_id = new.workspace_id
        where id = new.org_id and workspace_id is null;
    elsif v_org <> new.org_id then
      update public.members set org_id = v_org where site_id = new.id;
      new.org_id := v_org;
    end if;
    return new;
  end if;

  if new.org_id is not null then return new; end if;

  if coalesce(new.workspace_id, '') <> '' then
    insert into public.organisations (name, slug, workspace_id)
      values (initcap(replace(new.workspace_id, '-', ' ')), new.workspace_id, new.workspace_id)
      on conflict (slug) do nothing;
    select id into v_org from public.organisations where workspace_id = new.workspace_id;
  else
    insert into public.organisations (name, slug) values (new.name, 'venue-' || new.slug)
      on conflict (slug) do nothing;
    select id into v_org from public.organisations where slug = 'venue-' || new.slug;
  end if;
  new.org_id := v_org;
  return new;
end $$;

drop trigger if exists venues_assign_org_trg on public.venues;
create trigger venues_assign_org_trg
  before insert or update of workspace_id on public.venues
  for each row execute function public.venues_assign_org();

create or replace function public.venue_members_sync() returns trigger
language plpgsql as $$
declare v_org uuid; v_role public.member_role; v_id uuid;
begin
  if tg_op = 'DELETE' then
    update public.members set status = 'disabled' where legacy_venue_member_id = old.id;
    return old;
  end if;
  select org_id into v_org from public.venues where id = new.venue_id;
  if v_org is null then return new; end if;
  v_role := case when new.role = 'admin' then 'site_manager'::public.member_role else 'staff'::public.member_role end;

  select id into v_id from public.members
    where org_id = v_org and site_id = new.venue_id and lower(email) = lower(new.email);
  if v_id is null then
    insert into public.members (org_id, site_id, email, display_name, phone, role, status, legacy_venue_member_id, created_at)
    values (v_org, new.venue_id, lower(new.email), new.name, nullif(new.phone, ''), v_role, 'active', new.id, coalesce(new.created_at, now()))
    returning id into v_id;
  else
    -- owners stay owners; otherwise follow the legacy role
    update public.members set display_name = new.name, phone = nullif(new.phone, ''),
           role = case when role = 'owner' then role else v_role end,
           status = 'active', legacy_venue_member_id = new.id
      where id = v_id;
  end if;

  -- an organisation with no owner: its first admin becomes the owner
  if v_role = 'site_manager' and not exists (select 1 from public.members where org_id = v_org and role = 'owner') then
    update public.members set role = 'owner' where id = v_id;
  end if;
  return new;
end $$;

drop trigger if exists venue_members_sync_trg on public.venue_members;
create trigger venue_members_sync_trg
  after insert or update or delete on public.venue_members
  for each row execute function public.venue_members_sync();

-- Catch up anything created since 004 (a no-op if nothing is missing):
update public.venues set workspace_id = workspace_id where org_id is null;
update public.venue_members set role = role;
