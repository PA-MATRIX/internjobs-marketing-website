-- migration: 0011_v1_4_startup_mcp
-- description: MCP token columns, channel-adapter table, action audit log,
--              and outbound_messages table for Phase 28 (startup MCP server).
--
-- Scope:
--   • startups.mcp_token_hash, mcp_token_issued_at, mcp_token_rotated_at
--   • startup_channel_links (adapter table — mcp/telnyx/slack/email/...)
--   • startup_action_log    (execute() audit trail)
--   • outbound_messages     (NEW — was assumed by Phase 28 plan but never
--                            created by prior migrations; create here so the
--                            startup-mcp Worker's reply_to_candidate action
--                            has a target table)
--
-- All DDL is idempotent (`if not exists`) and runs inside the migrate.mjs
-- BEGIN/COMMIT.

-- ─── MCP token columns on startups ───────────────────────────────────────────
-- mcp_token_hash: SHA-256 hex of the raw per-startup install token.
-- Never store plaintext. Token is returned once at issuance; all subsequent
-- lookups compare the hash of the incoming Authorization: Bearer token.
ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS mcp_token_hash       text unique,
  ADD COLUMN IF NOT EXISTS mcp_token_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS mcp_token_rotated_at timestamptz;

CREATE INDEX IF NOT EXISTS startups_mcp_token_hash_idx
  ON startups(mcp_token_hash)
  WHERE mcp_token_hash IS NOT NULL;

-- ─── Channel-adapter table ────────────────────────────────────────────────────
-- Maps (channel_type, channel_external_id) → (startup_id, member_id).
-- channel_type values: 'mcp' | 'telnyx-sms' | 'telnyx-voice' | 'slack' | 'discord' | 'teams' | 'email'
-- channel_external_id: for 'mcp' = startup_id (one link per startup);
--   for 'telnyx-sms' = E.164 phone number; for 'slack' = workspace_id:channel_id.
-- Phase 29 adds rows with channel_type='telnyx-sms' without modifying this schema.
CREATE TABLE IF NOT EXISTS startup_channel_links (
  id                   uuid        primary key default gen_random_uuid(),
  startup_id           uuid        not null references startups(id) on delete cascade,
  member_id            uuid        references startup_members(id) on delete set null,
  channel_type         text        not null,
  channel_external_id  text        not null,
  status               text        not null default 'active',  -- 'active' | 'paused' | 'opted_out'
  opt_in_flags         jsonb       not null default '{}',      -- {"weekly_touchbase": true}
  metadata             jsonb       not null default '{}',      -- channel-specific extras
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  UNIQUE (startup_id, channel_type, channel_external_id)
);

CREATE INDEX IF NOT EXISTS startup_channel_links_startup_idx
  ON startup_channel_links(startup_id);

CREATE INDEX IF NOT EXISTS startup_channel_links_lookup_idx
  ON startup_channel_links(channel_type, channel_external_id)
  WHERE status = 'active';

-- ─── Action audit log ─────────────────────────────────────────────────────────
-- Every execute() call writes one row. channel='mcp' for Phase 28;
-- Phase 29 adds rows with channel='telnyx-sms' or 'telnyx-voice'.
-- params_hash: SHA-256 hex of JSON.stringify(params) — audit trail only, not for replay.
CREATE TABLE IF NOT EXISTS startup_action_log (
  id           uuid        primary key default gen_random_uuid(),
  member_id    uuid        references startup_members(id) on delete set null,
  startup_id   uuid        not null references startups(id) on delete cascade,
  channel      text        not null,   -- 'mcp' | 'telnyx-sms' | 'telnyx-voice' | ...
  action       text        not null,   -- 'post_role' | 'reply_to_candidate' | ...
  params_hash  text,                   -- SHA-256 hex of JSON.stringify(params)
  status       text        not null,   -- 'ok' | 'error'
  error_code   text,
  latency_ms   int,
  ip_hash      text,                   -- SHA-256 of request IP (fraud investigation)
  user_agent   text,
  created_at   timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS startup_action_log_startup_idx
  ON startup_action_log(startup_id, created_at DESC);

CREATE INDEX IF NOT EXISTS startup_action_log_member_idx
  ON startup_action_log(member_id, created_at DESC);

-- ─── outbound_messages (DEVIATION: not created by prior migrations) ──────────
-- Phase 28 plan assumed `outbound_messages` already existed (Phase 04 drafts
-- table is the v1.2 approval-queue analogue, but it has different semantics —
-- pending_review → approved → sent — and we want a clean per-channel send log
-- for MCP and Phase 29 Telnyx). Create the table here so the Phase 28
-- /v1/messages endpoint and Phase 29 SMS adapter can both write to it.
--
-- channel values: 'mcp' | 'telnyx-sms' | 'telnyx-voice' | 'email' | 'slack' | ...
-- thread_id is a free-form text (uuid stringified) — for MCP it's the
-- inbound thread the reply belongs to; for first-touch outbound it can be a
-- freshly-generated uuid that future inbound rows attach to.
CREATE TABLE IF NOT EXISTS outbound_messages (
  id                  uuid        primary key default gen_random_uuid(),
  startup_id          uuid        not null references startups(id) on delete cascade,
  member_id           uuid        references startup_members(id) on delete set null,
  thread_id           text        not null,
  content             text        not null,
  channel             text        not null default 'mcp',
  direction           text        not null default 'outbound',
  provider_message_id text,
  delivery_status     text        not null default 'pending',  -- 'pending' | 'sent' | 'delivered' | 'failed'
  metadata            jsonb       not null default '{}',
  created_at          timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS outbound_messages_startup_thread_idx
  ON outbound_messages(startup_id, thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_messages_channel_idx
  ON outbound_messages(channel, created_at DESC);

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
