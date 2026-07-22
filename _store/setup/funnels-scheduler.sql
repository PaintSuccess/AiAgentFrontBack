-- L3 funnel scheduler — Supabase pg_cron + pg_net.
-- ============================================================================
-- This is the ACTIVATION step for the funnel engine. Do NOT run it until L3 is
-- being turned on: it makes Postgres call /api/cron/funnels on a schedule. The
-- endpoint itself stays dark until ENABLE_FUNNELS is set in Vercel, so running
-- this early just produces harmless {skipped:"disabled"} responses — but there's
-- no reason to until go-live.
--
-- GO-LIVE ORDER (each step gated, reversible):
--   1. In Vercel (prod): set CRON_SECRET to a random value. Set FUNNELS_TEST_ONLY=true.
--      Leave ENABLE_FUNNELS UNSET for now.
--   2. Run this file (via scripts/db-apply-sql or the Management API), replacing
--      <CRON_SECRET> below with the exact value from step 1.
--   3. Confirm the cron row exists (query at the bottom) and that a run returns
--      {skipped:"disabled"} — proves the wiring without sending anything.
--   4. When ready to test for real: in Vercel set ENABLE_FUNNELS=1 (still
--      FUNNELS_TEST_ONLY=true) → the engine now fires ONLY to internal_test contacts.
--   5. Watch, then drop FUNNELS_TEST_ONLY to open to real contacts.
--   To stop at any time: unset ENABLE_FUNNELS (instant), or unschedule (bottom).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 15 minutes. Step delays are approximate, which is correct for marketing.
select cron.schedule(
  'funnel-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://ai-agent-front-back.vercel.app/api/cron/funnels',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:
--   select jobid, schedule, jobname, active from cron.job where jobname = 'funnel-sweep';
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='funnel-sweep') order by start_time desc limit 5;
-- Stop:
--   select cron.unschedule('funnel-sweep');
