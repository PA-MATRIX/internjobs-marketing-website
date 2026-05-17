-- migration: 0008_v1_2_pairing_sessions
-- description: v1.2 Phase 09 — Standout-style QR / sms-deeplink onboarding.
--
-- Short-lived pairing codes that bind a student row (created via Clerk
-- LinkedIn OAuth, no phone yet) to a phone number (claimed when the
-- student sends "START-XXXXXX" through iMessage and the Mac bridge forwards
-- it to /webhooks/mac-bridge). Distinct from the legacy
-- `channel_pairing_codes` table (0001) — that one is 15-min hex codes for
-- the old waitlist flow; this one is 24h dash-prefixed alphanumeric codes
-- (START-AB12CD) that double as a human-readable handle the student can
-- read aloud or copy-paste.
--
-- code is the primary key (no separate uuid) — codes are themselves
-- unique-by-construction (random 6 chars from a 32-char alphabet =
-- ~1 billion codes; 24h expiry; claim-once). PK on text is fine at our
-- scale and lets the claim path do a single index lookup.
--
-- claimed_phone records WHICH phone number sent the iMessage that
-- redeemed the code. After claim, students.phone (or
-- students.channel_address — same field, different name) is updated to
-- this phone so future inbounds from that number route to this student.
--
-- source — qr (desktop scan), mobile-deeplink (mobile sms:// button),
-- manual (operator-assist path, future).

create table if not exists pairing_sessions (
  code          text primary key,
  student_id    uuid not null references students(id) on delete cascade,
  expires_at    timestamptz not null,
  claimed_at    timestamptz,
  claimed_phone text,
  source        text not null default 'qr',
  created_at    timestamptz not null default now()
);

create index if not exists pairing_sessions_student_idx on pairing_sessions(student_id);
-- Sweeper index for the background expiry job (v1.3) — partial so it only
-- covers rows that COULD still be claimed.
create index if not exists pairing_sessions_unclaimed_idx on pairing_sessions(expires_at) where claimed_at is null;
