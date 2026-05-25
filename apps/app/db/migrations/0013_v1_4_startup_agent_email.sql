-- migration: 0013_v1_4_startup_agent_email
-- description: Per-startup agent email address column on `startups`.
--
-- Phase 28.5 ships a `<slug>@startups.internjobs.ai` agent address per
-- startup. The slug is minted from the company name in apps/startup/workers/
-- lib/slug.ts (`mintSlug` + `reserveUniqueSlug`) and persisted here so the
-- catch-all Cloudflare Email Routing handler can resolve recipient →
-- startup_id via the partial index below.
--
-- The actual recipient → startup_id lookup at email-receive time goes
-- through `startup_channel_links WHERE channel_type='email' AND
-- channel_external_id='<slug>@startups.internjobs.ai'` (created in 0011);
-- the column on `startups` is the canonical attribute used for outbound
-- `From:` rendering and for the dedupe constraint enforced by the
-- per-startup slug reservation path.
--
-- UNIQUE ensures no two startups can share the same `<slug>@startups.…`
-- address. CREATE INDEX is a no-op given the UNIQUE constraint already
-- creates a backing btree index, but we keep an explicit named index for
-- planner visibility + parity with the rest of this migration set.

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS agent_email text UNIQUE;

-- Index for fast slug lookup in catch-all email routing path.
-- (The UNIQUE constraint above already provides this implicitly; the named
-- index makes the lookup intent self-documenting in psql `\d startups`.)
CREATE INDEX IF NOT EXISTS startups_agent_email_idx
  ON startups(agent_email)
  WHERE agent_email IS NOT NULL;

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
