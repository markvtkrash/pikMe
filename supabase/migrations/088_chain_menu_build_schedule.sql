-- Scheduled chain-menu builds, part 2: run the runner every hour with pg_cron.
-- Needs the pg_cron extension (run `CREATE EXTENSION IF NOT EXISTS pg_cron;` first,
-- as a superuser in the SQL editor). If it is missing this does nothing and says so.
-- The job does nothing until internal_settings has the key (see migration 087 notes),
-- and chainMenuBuildsPerRun = 0 pauses it. Safe to re-run: it replaces the same job.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed: run CREATE EXTENSION IF NOT EXISTS pg_cron; then run this migration again. No job was scheduled.';
    RETURN;
  END IF;

  -- cron.unschedule(name) raises when the job does not exist yet.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chain-menu-builds') THEN
    PERFORM cron.unschedule('chain-menu-builds');
  END IF;
  PERFORM cron.schedule('chain-menu-builds', '7 * * * *', 'SELECT public.run_chain_menu_builds()');
  RAISE NOTICE 'Scheduled chain-menu-builds at minute 7 of every hour.';
END $$;
