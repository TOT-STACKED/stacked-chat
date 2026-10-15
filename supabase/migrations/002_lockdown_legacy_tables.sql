-- 002_lockdown_legacy_tables: the public (anon) key may no longer touch tenant data.
-- ALREADY APPLIED to production on 2026-10-15 (re-running is harmless).
-- The server reaches these tables with the service-role key, which bypasses RLS.

do $$
declare t text; pol record;
begin
  foreach t in array array['conversations','documents','images','leads','nps_scores','tickets','videos','venues','venue_members']
  loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
