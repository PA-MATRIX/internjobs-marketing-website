-- migration: 0009_v1_3_safety_events
-- description: safety_events table for SAFETY-01 Lakera Guard pre-LLM screening log
--
-- Lives in Neon (not per-employee DO SQLite) because /ops/safety is a
-- cross-employee operator view that must aggregate across all channels.
-- Queried by the Parrot Worker's /api/ops/safety route via NEON_DATABASE_URL
-- (uses @neondatabase/serverless HTTP-based driver) and by the Fly student
-- app via store.pool.

create table if not exists safety_events (
  id              uuid primary key default gen_random_uuid(),
  -- Channel that was screened
  channel         text not null check (channel in ('sms', 'email', 'unknown')),
  -- Lakera action taken (or operator-derived hard-block)
  action          text not null check (action in (
                    'passed',
                    'flagged',
                    'blocked',
                    'passed_lakera_unavailable'
                  )),
  -- Top Lakera reason category (e.g. 'prompt_injection', 'jailbreak')
  reason          text,
  -- Lakera prompt_injection confidence score (0.0-1.0)
  score           numeric(5,4),
  -- Sender identifier — HASHED or last-4 only for PII safety.
  -- Store the full value hashed with SHA-256; display layer shows only last 4 chars.
  sender_hash     text,
  -- Last 4 characters of the sender identifier (phone last-4 or email last-4 before @)
  sender_last4    text,
  -- 80-character truncated preview of the screened message (no full body stored)
  preview         text,
  -- Employee whose mailbox received the message (nullable — student SMS path has no employee)
  employee_id     text,
  -- Whether an operator has reviewed this flag
  reviewed        boolean not null default false,
  reviewed_at     timestamptz,
  reviewed_by     text,
  -- Timestamp of the screening event
  created_at      timestamptz not null default now()
);

create index if not exists safety_events_created_at_idx
  on safety_events (created_at desc);

create index if not exists safety_events_reviewed_idx
  on safety_events (reviewed, created_at desc)
  where reviewed = false;

create index if not exists safety_events_channel_idx
  on safety_events (channel, created_at desc);
