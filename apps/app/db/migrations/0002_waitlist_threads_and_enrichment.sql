create table if not exists profile_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  provider text not null,
  profile_url text not null,
  status text not null default 'pending_provider_setup',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, provider)
);

create table if not exists student_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  provider text not null default 'cognee',
  thread_key text not null,
  external_thread_id text,
  channel_address text,
  status text not null default 'pending_provider_setup',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, thread_key)
);

create index if not exists students_channel_address_normalized_idx
  on students ((regexp_replace(coalesce(channel_address, ''), '[^0-9+]', '', 'g')))
  where channel_confirmed_at is not null;
