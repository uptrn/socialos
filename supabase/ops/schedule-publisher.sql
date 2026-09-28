-- Run ONCE in the Supabase SQL editor after the app is deployed (not a migration:
-- it needs your deployed URL and secret, and must not run in local/test databases).
--
-- Every minute, Supabase calls POST {APP_URL}/api/cron/publish with the CRON_SECRET.
-- 1. Replace the two values below.
-- 2. Run the whole script.
-- To stop:  select cron.unschedule('socialos-publish');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP-DOMAIN', 'socialos_app_url');
select vault.create_secret('YOUR-CRON-SECRET', 'socialos_cron_secret');

select cron.schedule(
  'socialos-publish',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_app_url') || '/api/cron/publish',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 290000
  );
  $$
);

-- Daily at 03:00 UTC: refresh expiring tokens, flag expired accounts, email alerts, clean up.
select cron.schedule(
  'socialos-maintenance',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_app_url') || '/api/cron/maintenance',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 290000
  );
  $$
);

-- Every 15 minutes: collect post metrics that are due (Analytics).
select cron.schedule(
  'socialos-analytics',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_app_url') || '/api/cron/analytics',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 290000
  );
  $$
);

-- Every 5 minutes: read new comments on published posts (Inbox).
select cron.schedule(
  'socialos-inbox',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_app_url') || '/api/cron/inbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 290000
  );
  $$
);

-- Hourly: weekly research for brands that turned it on (a few brands per call).
select cron.schedule(
  'socialos-research',
  '17 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_app_url') || '/api/cron/research',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'socialos_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 290000
  );
  $$
);
