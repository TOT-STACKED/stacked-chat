-- 008_owners_company_wide: owners and HQ admins are company-wide roles (no site), but the legacy
-- import (004) and sync trigger (006) promoted a venue's first admin to 'owner' while leaving the
-- row attached to that one venue. The API then (correctly) treats them as site-level only, so they
-- cannot reach company settings such as Billing.
--   1. widen every existing site-scoped owner / HQ admin to the whole company
--   2. make the sync trigger promote to a company-wide owner from now on
-- Additive in effect, safe to re-run. No person loses access, and no one is promoted.

begin;

-- 1a. If the same person already has a company-wide row, keep the higher of the two roles on it
--     (enum order is highest privilege first, so "later" means lower privilege).
update public.members x set role = m.role
from public.members m
where m.role in ('owner', 'hq_admin') and m.site_id is not null
  and x.org_id = m.org_id and x.site_id is null and lower(x.email) = lower(m.email)
  and x.role > m.role;

-- 1b. ...then drop the now-redundant site-scoped duplicate.
delete from public.members m
where m.role in ('owner', 'hq_admin') and m.site_id is not null
  and exists (select 1 from public.members x
              where x.org_id = m.org_id and x.site_id is null and lower(x.email) = lower(m.email));

-- 1c. Everyone else: widen to the whole company.
update public.members set site_id = null where role in ('owner', 'hq_admin') and site_id is not null;

-- 2. Sync trigger: an organisation's first admin becomes a company-wide owner, and later legacy
--    edits keep updating that same row (found by its legacy id) instead of adding a second one.
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
    where org_id = v_org
      and (legacy_venue_member_id = new.id or (site_id = new.venue_id and lower(email) = lower(new.email)))
    order by (legacy_venue_member_id = new.id) desc
    limit 1;
  if v_id is null then
    insert into public.members (org_id, site_id, email, display_name, phone, role, status, legacy_venue_member_id, created_at)
    values (v_org, new.venue_id, lower(new.email), new.name, nullif(new.phone, ''), v_role, 'active', new.id, coalesce(new.created_at, now()))
    returning id into v_id;
  else
    -- owners stay owners; otherwise follow the legacy role
    update public.members set display_name = new.name, phone = nullif(new.phone, ''),
           role = case when role in ('owner', 'hq_admin') then role else v_role end,
           status = 'active', legacy_venue_member_id = new.id
      where id = v_id;
  end if;

  -- an organisation with no owner: its first admin becomes its (company-wide) owner
  if v_role = 'site_manager' and not exists (select 1 from public.members where org_id = v_org and role = 'owner') then
    if exists (select 1 from public.members where org_id = v_org and site_id is null and lower(email) = lower(new.email) and id <> v_id) then
      update public.members set role = 'owner' where org_id = v_org and site_id is null and lower(email) = lower(new.email);
    else
      update public.members set role = 'owner', site_id = null where id = v_id;
    end if;
  end if;
  return new;
end $$;

commit;
