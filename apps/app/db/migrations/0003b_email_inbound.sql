-- migration: 0003b_email_inbound
-- description: conditional inbound_messages table for v1.2 Phase 03 (email channel).
--
-- Phase 04 (Mastra Agent Core) will create this table canonically with a
-- full migration matching ARCHITECTURE.md Section 4. We use `if not exists`
-- here so the two migrations coexist idempotently — whichever runs first
-- defines the table, the other is a no-op. The columns + indexes below
-- mirror ARCHITECTURE.md exactly so the Phase 04 migration can keep its
-- `if not exists` and never need to ALTER.

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

-- Partial unique index: dedupe across (provider, provider_event_id) but only
-- when provider_event_id is set. Web-origin rows have no provider_event_id.
create unique index if not exists inbound_messages_provider_event_uidx
  on inbound_messages(provider, provider_event_id)
  where provider_event_id is not null;

-- Agent-consumer index: scan unprocessed rows in insertion order.
create index if not exists inbound_messages_unprocessed_idx
  on inbound_messages(created_at)
  where processed_at is null;

insert into schema_migrations (version) values ('0003b_email_inbound')
  on conflict do nothing;
