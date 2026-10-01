-- Run the check-prices Edge Function every 6 hours.
--
-- The cron job authenticates with a random secret kept in Vault. The function
-- verifies it with verify_cron_secret(), which only the service role can call,
-- so the secret never has to be copied anywhere else.
--
-- One manual step: store the project's URL in Vault (SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cron_secret');
  end if;
end $$;

-- (Don't name the parameter "secret": vault.decrypted_secrets has a column by that name.)
create or replace function public.verify_cron_secret(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from vault.decrypted_secrets s where s.name = 'cron_secret' and s.decrypted_secret = candidate
  );
$$;
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

select cron.schedule(
  'check-gift-prices',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"scope":"all"}'::jsonb
  );
  $$
);
