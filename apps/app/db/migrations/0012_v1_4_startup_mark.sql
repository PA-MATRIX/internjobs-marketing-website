-- migration: 0012_v1_4_startup_mark
-- description: Add startup_mark column to inbound_messages for Phase 28
--              mark_candidate action (PATCH /v1/threads/:id/mark).
--
-- startup_mark values: 'interested' | 'not_interested' | 'shortlisted' | 'rejected'
-- Partial index on (startup_id, startup_mark) WHERE startup_mark IS NOT NULL
-- keeps the index small (most rows are unmarked).

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS startup_mark text;

CREATE INDEX IF NOT EXISTS inbound_messages_startup_mark_idx
  ON inbound_messages(startup_id, startup_mark)
  WHERE startup_mark IS NOT NULL;

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
