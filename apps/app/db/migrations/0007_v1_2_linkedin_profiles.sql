-- migration: 0007_v1_2_linkedin_profiles
-- description: v1.2 Phase 09 — Standout-style LinkedIn enrichment.
--
-- One row per student capturing the fields we pull from an enrichment
-- provider (Proxycurl in v1.2, Apollo or PDL as fallbacks; the column
-- `enriched_via` records which one wrote the row). Composite/array fields
-- live in JSONB so we don't have to drag along a forest of side tables for
-- schools/experiences/skills — the agent reads them as opaque arrays.
--
-- 1:1 with students. The student_id is UNIQUE so an UPSERT on
-- (student_id) is the canonical write pattern (see store.linkUserLinkedInProfile).
-- ON DELETE CASCADE keeps the table garbage-free if a student row is
-- ever hard-deleted (privacy/right-to-erasure path — not wired in v1.2,
-- but the constraint is the cheapest place to enforce it).
--
-- raw — full provider response stored for fallback / replay. Helpful when
-- the agent prompt asks for a field we haven't normalized yet; v1.3 may
-- add columns for certifications, languages, publications, etc.
--
-- enriched_via is a free-form text rather than an enum so we don't have to
-- ship a follow-up migration if we add a new provider seam. Recognized
-- values today: 'proxycurl', 'apollo', 'pdl'.

create table if not exists linkedin_profiles (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid unique references students(id) on delete cascade,
  linkedin_url    text,
  linkedin_id     text,
  headline        text,
  summary         text,
  current_company text,
  current_title   text,
  schools         jsonb not null default '[]'::jsonb,
  experiences     jsonb not null default '[]'::jsonb,
  skills          jsonb not null default '[]'::jsonb,
  enriched_at     timestamptz not null default now(),
  enriched_via    text not null default 'proxycurl',
  raw             jsonb,
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists linkedin_profiles_student_idx on linkedin_profiles(student_id);
create index if not exists linkedin_profiles_url_idx on linkedin_profiles(linkedin_url) where linkedin_url is not null;
