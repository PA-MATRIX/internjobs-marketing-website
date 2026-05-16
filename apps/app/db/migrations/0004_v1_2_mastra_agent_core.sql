-- migration: 0004_v1_2_mastra_agent_core
-- description: Mastra agent core schema for v1.2 Phase 04 — AGENT-01/02/03.
--
-- Scope:
--   • mastra schema reservation (Mastra owns mastra.* tables, auto-populated
--     by Mastra init() on first run — never created manually here).
--   • inbound_messages canonical shape (idempotent; 0003b created the same
--     shape conditionally, so this is a no-op on dev branches that already
--     ran 0003b).
--   • conversations: two-sided link (student × startup × role) — Phase 05
--     reads this when joining drafts to participants.
--   • drafts: approval gate row — Phase 04 inserts with status='pending';
--     Phase 05 reads status='pending' and transitions to 'approved'/'sent'.
--   • draft_feedback: rejected/edited drafts feed agent training in v1.3+.
--   • pgvector extension + student_embeddings + role_embeddings, both with
--     vector(1536) for OpenAI text-embedding-3-small (locked — see comment
--     below).
--   • HNSW indexes on both embedding tables. NOT CONCURRENTLY: migrate.mjs
--     runs each file inside BEGIN/COMMIT; CREATE INDEX CONCURRENTLY is
--     incompatible with explicit transactions. Data volume at v1.2 launch
--     is low (single-digit rows), so the table-lock cost is negligible.
--     Revisit if/when student_embeddings exceeds ~10k rows.
--   • Flag 2 data migration: student_threads rows written with
--     provider='cognee' by v1.1 / Phase 02 path are flipped to
--     provider='mastra' so Phase 04 lookups by (provider, thread_key) work.
--   • Flag 3 fix is in code (store.mjs), not schema. No DDL required.
--
-- NOT in scope (deferred to v1.3 Telnyx adapter rollout):
--   • students.sms_provider column.
--
-- Embedding model lock (PITFALLS #18):
--   model:      text-embedding-3-small
--   dimension:  1536
--   distance:   cosine (vector_cosine_ops)
--   index:      HNSW (PITFALLS #10), m=16, ef_construction=64
--   Changing any of these requires a full re-embed + index rebuild. Do not
--   bump in-place.

-- ─── Mastra schema reservation ───────────────────────────────────────────────
-- PITFALLS #1: schemaName='mastra' is MANDATORY for PostgresStore + PgVector.
-- Tables under mastra.* are managed by Mastra; we just reserve the namespace.
create schema if not exists mastra;
comment on schema mastra is 'Mastra-owned tables (threads, messages, vectors). Auto-populated by Mastra init(). Do not create or alter manually.';

-- ─── inbound_messages canonical shape (mirrors 0003b) ────────────────────────
-- Idempotent: 0003b already created this table on environments that ran
-- Phase 03 first. Repeated `if not exists` guards make this safe to run
-- regardless of order.
create table if not exists inbound_messages (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,           -- 'spectrum' | 'telnyx' | 'email' | 'web'
  provider_event_id text,                   -- dedupe key (nullable for web-origin)
  channel_type     text not null,           -- 'sms' | 'email' | 'web'
  channel_address  text,                    -- normalized phone or email address
  student_id       uuid references students(id) on delete set null,
  startup_id       uuid references startups(id) on delete set null,
  direction        text not null default 'inbound',
  body             text not null default '',
  metadata         jsonb not null default '{}'::jsonb,
  processed_at     timestamptz,             -- null = not yet consumed by agent
  created_at       timestamptz not null default now()
);

create unique index if not exists inbound_messages_provider_event_uidx
  on inbound_messages(provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists inbound_messages_unprocessed_idx
  on inbound_messages(created_at)
  where processed_at is null;

-- ─── conversations (two-sided link) ──────────────────────────────────────────
create table if not exists conversations (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id) on delete cascade,
  startup_id          uuid not null references startups(id) on delete cascade,
  role_id             uuid references roles(id) on delete set null,
  status              text not null default 'active',  -- 'active' | 'closed' | 'paused'
  student_thread_key  text,                            -- mastra thread_key for student side
  startup_thread_key  text,                            -- mastra thread_key for startup side
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (student_id, startup_id, role_id)
);

create index if not exists conversations_student_idx on conversations(student_id);
create index if not exists conversations_startup_idx on conversations(startup_id);

-- ─── drafts (operator approval queue) ────────────────────────────────────────
-- Phase 04 inserts rows here with status='pending_review'. Phase 05 owns the
-- transitions to 'approved' / 'sent' / 'rejected'. Phase 04 NEVER calls any
-- send API — see hard constraint in PLAN.md.
--
-- Note: PLAN.md Step 4 says status='pending', but the prompt's verification
-- step requires status='pending_review'. We use 'pending_review' as the
-- default (matches the prompt; Phase 05 will read either via a status check
-- helper). The constraint allows both for forward-compat.
create table if not exists drafts (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid references conversations(id) on delete set null,
  inbound_message_id  uuid references inbound_messages(id) on delete set null,
  recipient_type      text not null,                   -- 'student' | 'startup'
  channel             text not null,                   -- 'sms' | 'email'
  channel_address     text not null,                   -- phone or email
  body                text not null,
  status              text not null default 'pending_review',
                                                       -- 'pending_review' | 'approved'
                                                       -- | 'rejected' | 'sent' | 'failed'
  operator_id         text,                            -- clerk_user_id once reviewed
  operator_note       text,
  sent_at             timestamptz,
  provider_message_id text,
  agent_metadata      jsonb not null default '{}'::jsonb,
                                                       -- match_source, model, prompt_tokens, etc.
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists drafts_pending_idx
  on drafts(created_at)
  where status = 'pending_review';

create index if not exists drafts_conversation_idx on drafts(conversation_id);

-- ─── draft_feedback (rejection/edit log for agent training) ──────────────────
create table if not exists draft_feedback (
  id              uuid primary key default gen_random_uuid(),
  draft_id        uuid not null references drafts(id) on delete cascade,
  operator_id     text not null,
  feedback_type   text not null,                       -- 'rejected' | 'edited'
  original_body   text not null,
  corrected_body  text,
  reason          text,
  created_at      timestamptz not null default now()
);

-- ─── pgvector + embedding tables ─────────────────────────────────────────────
-- Locked dimension/model — see header comment.
create extension if not exists vector;

create table if not exists student_embeddings (
  student_id  uuid primary key references students(id) on delete cascade,
  embedding   vector(1536) not null,
  model       text not null default 'text-embedding-3-small',
  updated_at  timestamptz not null default now()
);

create table if not exists role_embeddings (
  role_id     uuid primary key references roles(id) on delete cascade,
  embedding   vector(1536) not null,
  model       text not null default 'text-embedding-3-small',
  updated_at  timestamptz not null default now()
);

-- HNSW (PITFALLS #10), not IVFFlat. NOT CONCURRENTLY because migrate.mjs
-- wraps each file in BEGIN/COMMIT. See header comment.
create index if not exists student_embeddings_hnsw_idx
  on student_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists role_embeddings_hnsw_idx
  on role_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ─── Flag 2 data migration (PROJECT cleanup) ─────────────────────────────────
-- v1.1/Phase 02 wrote student_threads rows with provider='cognee' as a
-- placeholder for "agent thread, not yet wired." Phase 04 owns the agent
-- thread under provider='mastra'. Flip in place so existing rows are
-- discoverable by the new code path.
update student_threads
   set provider = 'mastra',
       status = 'active',
       updated_at = now()
 where provider = 'cognee';

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
