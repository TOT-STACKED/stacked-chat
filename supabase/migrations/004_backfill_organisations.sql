-- 004_backfill_organisations: move existing venues, members, documents and videos
-- into the new model WITHOUT changing or deleting anything old. Idempotent.
--
--   workspace_id          -> one organisation per distinct workspace_id
--   venue w/o workspace   -> its own organisation
--   venue_members.admin   -> site_manager (the earliest admin per organisation becomes owner)
--   venue_members.staff   -> staff
--   documents/videos/images with a tenant/workspace -> org_id set; shared (null/'stacked') stays shared
--
-- The LAST statement is a report: venues that have members but no admin. They are
-- NOT promoted automatically: decide who should be in charge, then use the API/admin.

begin;

insert into public.organisations (name, slug, workspace_id)
select initcap(replace(w.workspace_id, '-', ' ')), w.workspace_id, w.workspace_id
from (select distinct workspace_id from public.venues where workspace_id is not null and workspace_id <> '') w
on conflict (slug) do nothing;

insert into public.organisations (name, slug)
select v.name, 'venue-' || v.slug
from public.venues v
where (v.workspace_id is null or v.workspace_id = '')
on conflict (slug) do nothing;

update public.venues v set org_id = o.id
from public.organisations o
where v.org_id is null and v.workspace_id is not null and v.workspace_id <> '' and o.workspace_id = v.workspace_id;

update public.venues v set org_id = o.id
from public.organisations o
where v.org_id is null and (v.workspace_id is null or v.workspace_id = '') and o.slug = 'venue-' || v.slug;

insert into public.members (org_id, site_id, email, display_name, phone, role, status, legacy_venue_member_id, created_at)
select v.org_id, vm.venue_id, lower(vm.email), vm.name, nullif(vm.phone, ''),
       case when vm.role = 'admin' then 'site_manager'::public.member_role else 'staff'::public.member_role end,
       'active', vm.id, coalesce(vm.created_at, now())
from public.venue_members vm
join public.venues v on v.id = vm.venue_id
where v.org_id is not null
on conflict do nothing;

-- The earliest admin of each organisation becomes its owner (only if it has no owner yet).
update public.members m set role = 'owner'
from (select distinct on (org_id) id, org_id
      from public.members where role = 'site_manager'
      order by org_id, created_at asc) first_admin
where m.id = first_admin.id
  and not exists (select 1 from public.members x where x.org_id = first_admin.org_id and x.role = 'owner');

update public.documents d set org_id = o.id
from public.organisations o
where d.org_id is null and d.workspace_id is not null and o.workspace_id = d.workspace_id;

update public.videos v set org_id = o.id
from public.organisations o
where v.org_id is null and v.tenant is not null and v.tenant <> 'stacked' and o.workspace_id = v.tenant;

update public.images i set org_id = o.id
from public.organisations o
where i.org_id is null and i.tenant is not null and i.tenant <> 'stacked' and o.workspace_id = i.tenant;

commit;

-- REPORT: venues with members but no admin (needs a human decision)
select v.name as venue_without_admin, count(vm.*) as member_count
from public.venues v
join public.venue_members vm on vm.venue_id = v.id
group by v.id, v.name
having count(*) filter (where vm.role = 'admin') = 0;
