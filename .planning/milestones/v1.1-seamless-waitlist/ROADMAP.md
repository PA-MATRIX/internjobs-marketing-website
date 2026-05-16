# Milestone v1.1: Seamless Waitlist and Student Threading

**Status:** ✅ SHIPPED 2026-05-15
**Phases:** 7 (incremental over v1.0)
**Total Plans:** 1

## Overview

Make the InternJobs.ai waitlist feel like one natural student flow: LinkedIn sign-in → QR/SMS pairing → 8-character verification text → confirmed student state → durable phone-thread routing for follow-up messages, with handoff records for Cognee graph memory and Sprite/Bright Data enrichment created without running unapproved enrichment.

## Phases

### Phase 7: Seamless Student Waitlist

**Goal:** Make the waitlist feel like one natural student flow from LinkedIn to text verification.
**Depends on:** Phases 2-6.
**Requirements:** WAIT-01, WAIT-02, WAIT-03, THREAD-01, GRAPH-01, ENRICH-01
**Plans:** 1 plan

**Success Criteria:**

1. Student login routes directly to QR/SMS pairing.
2. QR opens the exact InternJobs.ai verification message with a unique 8-character code.
3. First inbound Spectrum message confirms the student.
4. Later inbound messages from that same phone number attach to the same student thread.
5. Cognee hosted and Sprite/Bright Data handoff records are created without running unapproved enrichment.

Plans:

- [x] 07-01: Wire seamless waitlist flow, phone-number routing, and provider handoff records.

**Details:**

- Routed authenticated students directly to `/pairing` (post-auth landing).
- Generated short, unique, textable 8-character pairing codes in `store.mjs` `createOrRefreshPairingCode`.
- QR/SMS deep link opens the exact verification text: `Hey internjobs.ai! My verification code is {CODE}. What's next?` (verified at `views.mjs:86`).
- Inbound webhook (`store.mjs:362`) normalizes `channel_address` and matches follow-up texts to verified students via regex on normalized phone numbers (THREAD-01 confirmed by audit).
- `ensureStudentThread` invoked from `confirmPairingCode` (trigger `pairing_confirmed`) and `recordInboundMessage` (trigger `student_reply`) inserts `student_threads` rows with `status='pending_provider_setup'` — Cognee handoff record without provider call (GRAPH-01).
- `queueProfileEnrichment` called from `upsertStudentFromAuth` inserts `profile_enrichment_jobs` rows — Sprite/Bright Data handoff record gated behind compliance review (ENRICH-01).
- Optional Spectrum SDK listener can reply in-channel when enabled.
- Migrations `0001_waitlist_foundation` (2026-05-09) and `0002_waitlist_threads_and_enrichment` (2026-05-10) applied in prod and verified via `schema_migrations`.
- Dockerfile updated to ship `scripts/` and `db/` so migrations are runnable from the image; redeployed to Fly app `internjobs-ai-student-app` under `internjobs-sios-org`.

**Deploy activation (out-of-band, 2026-05-15):**

- Clerk production instance configured with LinkedIn OAuth provider.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` stored in Infisical (project `26995afd-9a6f-4690-912f-01cbcebb76d5`, org `2c12f042-e98f-4fb3-8b40-16aec29f9b91`, env `prod`, path `/internjobs-ai`).
- Clerk prod keys imported into Fly via `flyctl secrets import`; rolling deploy succeeded.
- `/healthz` returns 200 with `clerk/database/photonNumber/photonWebhook/spectrumListener` all `true`.
- `/config/status` returns `{"missing":[]}`.

---

## Milestone Summary

**Requirements satisfied:** 6/6 v1.1 requirements + AUTH-01 (carried from v1.0).

| Requirement | Phase | Status | Evidence |
|---|---|---|---|
| WAIT-01: authenticated users land on QR/SMS pairing | 7 | ✅ | `server.mjs` redirects `/` → `/waitlist`; post-auth routes to `/pairing` |
| WAIT-02: exact verification text with code | 7 | ✅ | `views.mjs:86` |
| WAIT-03: short, unique, textable pairing code | 7 | ✅ | 8-character code in `store.mjs createOrRefreshPairingCode` |
| THREAD-01: same-phone follow-ups attach to verified student | 7 | ✅ | `store.mjs:362` normalized regex match on `channel_address` |
| GRAPH-01: durable Cognee thread placeholder | 7 | ✅ | `student_threads` row with `status='pending_provider_setup'` |
| ENRICH-01: durable Sprite/Bright Data enrichment job | 7 | ✅ | `profile_enrichment_jobs` row queued from `upsertStudentFromAuth` |
| AUTH-01: Clerk LinkedIn primary (carried from v1.0) | 2 | ✅ | Clerk prod activated 2026-05-15, Fly deploy verified |

**Key Decisions:**

- Move Fly app from `projecta-labs` to `internjobs-sios-org` — product runtime lives in the customer-specific SIOS org.
- Use Infisical `prod`/`/internjobs-ai` as the single source of truth for InternJobs.ai secrets (project `26995afd`, org `2c12f042`); the older `0484b3ce` Infisical project is dead.
- Keep Cognee hosted and Sprite/Bright Data integrations as durable placeholder rows (`pending_provider_setup`) — write the data shape now, light up provider calls behind a compliance gate later.
- Use normalized phone-number routing on the shared Spectrum number rather than dedicating numbers per student — keeps v1.1 single-number while still threading correctly.

**Issues Resolved:**

- Dockerfile did not ship `scripts/` and `db/`; migrations were not runnable from the image. Fixed and redeployed.
- Initial pairing code length and uniqueness ergonomics — settled on 8-character codes.
- Follow-up texts from a verified student previously could trigger a new pairing attempt — resolved via normalized phone-number resolution.

**Issues Deferred:**

- Live LinkedIn → Clerk → app sign-in not exercised end-to-end against prod Clerk. Blocked by Cloudflare DNS proxy state on `accounts.internjobs.ai` and `clerk.internjobs.ai` (should be DNS-only, currently proxied). Carry into v1.2 pre-flight.
- No RRR `VERIFICATION.md` artifacts for any v1.1 phase — verification was done outside RRR. Audit flagged `gaps_found` on procedural grounds; substance is verified.
- Same procedural gap exists for all v1.0 phases (verified outside RRR).
- `CLERK_SECRET_KEY` was pasted in chat 2026-05-15. User declined rotation. Tracked as accepted residual risk.

**Technical Debt Incurred:**

- `pg` library SSL warning: `prefer/require/verify-ca` is aliased to `verify-full`; library will change defaults in next major. Update connection string before `pg` v9.
- No documented activation runbook for transitioning Cognee + Sprite/Bright Data placeholders to real provider calls.
- ROADMAP previously labeled both "Student Agent MVP" and "Startup Access MVP" as v1.2 (version collision) — resolved in v1.2 scoping by collapsing both into a single Two-Sided Agent MVP milestone.

---

*For current project status, see `.planning/ROADMAP.md`. For audit detail, see `MILESTONE-AUDIT.md` in this folder.*
