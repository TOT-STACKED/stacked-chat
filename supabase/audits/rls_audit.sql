-- READ-ONLY audit. Safe to run in the Supabase SQL editor; it changes nothing.
-- Paste this whole query (the SQL editor only shows the last statement's result,
-- so it is a single query that returns one table).
--   kind = rls         -> is row-level security on for each public table?
--   kind = policy      -> every access policy and the roles/commands it allows
--   kind = anon_grant  -> what the public anon key can do at privilege level

select 'rls' as kind, c.relname::text as name,
       jsonb_build_object('rls_enabled', c.relrowsecurity) as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'policy', tablename || ' / ' || policyname,
       jsonb_build_object('cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check)
from pg_policies where schemaname = 'public'
union all
select 'anon_grant', table_name::text,
       jsonb_build_object('privileges', string_agg(privilege_type, ', ' order by privilege_type))
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
group by table_name
order by 1, 2;
