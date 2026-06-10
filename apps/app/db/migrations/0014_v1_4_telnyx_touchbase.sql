-- migration: 0014_v1_4_telnyx_touchbase
-- description: Add last_touchbase_at to startup_channel_links for Phase 29 cron.
--   opt_in_flags (jsonb) already added in 0011; this adds only the timestamp column
--   plus a composite index tuned for the Phase 29-03 weekly cron query.
--
-- Phase 29-03 cron query (target shape):
--   WHERE channel_type='telnyx-sms'
--     AND (opt_in_flags->>'weekly_touchbase')::boolean = true
--     AND (last_touchbase_at IS NULL OR last_touchbase_at < now() - INTERVAL '7 days')
--
-- All DDL is idempotent (`if not exists`) and runs inside the migrate.mjs
-- BEGIN/COMMIT (same runner that applied 0011/0012/0013).

ALTER TABLE startup_channel_links
  ADD COLUMN IF NOT EXISTS last_touchbase_at timestamptz;

-- Composite index for the weekly cron query. The partial WHERE clause keeps
-- the index small — we only ever filter to opted-in rows. NULL last_touchbase_at
-- sorts low naturally, so the cron sees never-touchbased startups first.
CREATE INDEX IF NOT EXISTS startup_channel_links_touchbase_idx
  ON startup_channel_links(channel_type, last_touchbase_at)
  WHERE (opt_in_flags->>'weekly_touchbase')::boolean = true;

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
