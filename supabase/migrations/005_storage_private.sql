-- 005_storage_private: remove the public (anon) read/insert rules on the `stacked-videos` bucket.
-- After this, files can only be uploaded through the server's signed upload URLs and read through
-- signed URLs. (The bucket itself is switched to private via the Storage API.)
--
-- Only policies that name this bucket are dropped, so other buckets/apps are untouched.
-- The LAST statement lists what is left on storage.objects: if any rule still lets the public
-- key in, it will show here.

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%stacked-videos%' or coalesce(with_check, '') like '%stacked-videos%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

select policyname, cmd, roles, qual as using_expr, with_check as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
