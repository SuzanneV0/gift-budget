-- Run the check-prices Edge Function every 6 hours.
-- Before applying, store two secrets in Vault (Dashboard → Project Settings → Vault):
--   project_url      = https://<project-ref>.supabase.co
--   cron_secret      = the same value you set as CRON_SECRET for the function
create extension if not exists pg_cron;
create extension if not exists pg_net;

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
