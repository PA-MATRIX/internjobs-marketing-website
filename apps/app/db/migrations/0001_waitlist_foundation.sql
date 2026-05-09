create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  name text,
  linkedin_profile_url text,
  status text not null default 'started',
  channel_type text,
  channel_address text,
  channel_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists waitlist_status (
  student_id uuid primary key references students(id) on delete cascade,
  status text not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists channel_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  code text not null unique,
  status text not null default 'active',
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists channel_pairing_codes_student_active_idx
  on channel_pairing_codes(student_id, status, expires_at);

create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  consent_type text not null,
  granted boolean not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (student_id, consent_type)
);

create table if not exists profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  provider text not null,
  provider_user_id text,
  display_name text,
  profile_url text,
  headline text,
  photo_url text,
  raw_metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create table if not exists student_profile_context (
  student_id uuid primary key references students(id) on delete cascade,
  interests text[] not null default '{}'::text[],
  projects text not null default '',
  preferred_work text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messaging_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  student_id uuid references students(id) on delete set null,
  direction text not null,
  channel_type text not null,
  channel_address text,
  event_type text not null,
  delivery_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete set null,
  event_type text not null,
  actor text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_student_created_idx on audit_events(student_id, created_at desc);
