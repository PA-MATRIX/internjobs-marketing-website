-- migration: 0006_v1_2_agent_emails
-- description: agent_emails table — stores inbound mail to dedicated agent
-- mailboxes (agent-mac@agent.internjobs.ai and future per-channel agents).
--
-- Distinct from inbound_messages.channel_type='email' (which is for student
-- conversation aliases conv-{uuid}@) because:
--   • agent mailboxes have NO student relationship at the wire level — they
--     are the agent's own identity (Apple ID verification, startup
--     onboarding pings, vendor alerts, etc.)
--   • the conv-{uuid} schema assumes a known conversation/student; agent-mac
--     emails are unassociated until/unless the agent decides to thread them.
--
-- Cloudflare email-worker (apps/email-worker) decides routing at the
-- subdomain level: conv-* → /webhooks/email (existing), agent-mac@ →
-- /webhooks/agent-mail (new, this migration's table).

create table if not exists agent_emails (
  id                 uuid primary key default gen_random_uuid(),
  provider_event_id  text,                  -- dedupe key from worker (worker_uuid + ts)
  to_address         text not null,         -- e.g. agent-mac@agent.internjobs.ai
  from_address       text not null,
  subject            text not null default '',
  body               text not null default '',  -- raw RFC 5322 body (capped 1 MB at worker)
  headers            jsonb not null default '{}'::jsonb,
  received_at        timestamptz not null default now(),
  -- forward links for future threading / agent recall
  conversation_id    uuid references conversations(id) on delete set null,
  startup_id         uuid references startups(id) on delete set null,
  -- agent processing state
  processed_at       timestamptz,           -- null = not yet consumed by agent
  metadata           jsonb not null default '{}'::jsonb
);

-- Dedupe key: worker assigns a stable id per inbound message. Partial
-- unique index (only when set) so backfills with NULL don't conflict.
create unique index if not exists agent_emails_provider_event_uidx
  on agent_emails(provider_event_id)
  where provider_event_id is not null;

-- Inbox scan: newest first
create index if not exists agent_emails_received_desc_idx
  on agent_emails(received_at desc);

-- Per-mailbox filter (we may add more agent inboxes later: agent-startup@,
-- agent-billing@, etc.)
create index if not exists agent_emails_to_idx
  on agent_emails(to_address);

-- Unprocessed queue for future Mastra workflow consumption
create index if not exists agent_emails_unprocessed_idx
  on agent_emails(received_at)
  where processed_at is null;

-- (schema_migrations row inserted by migrate.mjs after this SQL commits.)
