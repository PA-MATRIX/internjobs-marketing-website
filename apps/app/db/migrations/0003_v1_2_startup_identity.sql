-- migration: 0003_v1_2_startup_identity
-- description: startup identity, consent, and roles schema for v1.2

-- ─── Startup identity ────────────────────────────────────────────────────────

create table if not exists startups (
  id           uuid primary key default gen_random_uuid(),
  clerk_org_id text unique,
  name         text not null,
  domain       text,
  website      text,
  status       text not null default 'onboarding',  -- 'onboarding' | 'active' | 'paused'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists startup_members (
  id            uuid primary key default gen_random_uuid(),
  startup_id    uuid not null references startups(id) on delete cascade,
  clerk_user_id text not null unique,
  role          text not null default 'founder',  -- 'founder' | 'member'
  email         text not null,
  name          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists startup_members_startup_idx
  on startup_members(startup_id);

create index if not exists startup_members_clerk_user_id_idx
  on startup_members(clerk_user_id);

-- ─── Consent ─────────────────────────────────────────────────────────────────

create table if not exists startup_consents (
  id                      uuid primary key default gen_random_uuid(),
  startup_id              uuid not null references startups(id) on delete cascade,
  consent_type            text not null,  -- 'messaging_on_behalf'
  granted                 boolean not null,
  granted_by_clerk_user_id text not null,
  created_at              timestamptz not null default now(),
  unique (startup_id, consent_type)
);

-- ─── Roles catalog ───────────────────────────────────────────────────────────

create table if not exists roles (
  id           uuid primary key default gen_random_uuid(),
  startup_id   uuid not null references startups(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  requirements text not null default '',
  status       text not null default 'active',  -- 'active' | 'paused' | 'filled'
  location     text,
  comp_range   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists roles_startup_status_idx
  on roles(startup_id, status);

-- ─── Schema migration record ─────────────────────────────────────────────────

insert into schema_migrations (version) values ('0003_v1_2_startup_identity')
  on conflict do nothing;
