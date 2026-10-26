-- 018_phone_codes_lockdown: phone_codes holds hashed sign-in codes. Like every other table, the public (anon) and signed-in (authenticated)
-- database roles get no access at all; only the server's service role can touch it. Additive and safe to re-run.
begin;
revoke all on public.phone_codes from anon, authenticated;
commit;
