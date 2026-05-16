---
milestone: v1.1
audited: 2026-05-15
auditor: claude (rrr:audit-milestone, executed as orchestrator inline)
status: gaps_found
scores:
  requirements: 6/6
  phases_verified_with_artifact: 0/1
  integration: passed
  e2e_flows_runtime: 4/5
gaps:
  procedural:
    - "Phase 7 (`v1.1-seamless-waitlist/phase-01-seamless-student-waitlist`) has SUMMARY.md but no VERIFICATION.md. RRR verify-phase step was never run for this milestone. Same is true for all v1.0 phases — they were verified outside RRR."
    - "Phase 2 plan `02-01` (Clerk production LinkedIn activation) was completed today via manual configuration. Not driven by RRR execute-plan, no verification artifact."
  runtime:
    - "End-to-end LinkedIn → Clerk → app sign-in flow has not been exercised against the live prod Clerk instance since prod keys went live in Fly. `/healthz` reports `clerk:true` (config present) but does not exercise an OAuth round-trip."
tech_debt:
  - phase: phase-01-seamless-student-waitlist
    items:
      - "pg library SSL warning: 'prefer/require/verify-ca' aliased to 'verify-full' — library will change defaults in next major; update connection string before pg v9."
      - "Cognee + Sprite/Bright Data: partner activation is intentionally gated, but no concrete trigger documented for when placeholders transition to real provider calls. Activation runbook missing."
  - phase: phase-02-clerk-linkedin-waitlist-auth
    items:
      - "`CLERK_SECRET_KEY` was pasted in chat 2026-05-15 and is in conversation history. User declined rotation; track as accepted residual risk."
  - cross_cutting:
      - "No RRR VERIFICATION.md artifacts exist for any phase in v1.0 or v1.1. Future audits will repeatedly flag this until the project either (a) runs verify-phase retroactively or (b) the audit process tolerates externally-verified phases."
      - "ROADMAP.md labels both 'Student Agent MVP' and 'Startup Access MVP' as v1.2 (collision). Resolve before next milestone planning."
---

# v1.1 Milestone Audit — Seamless Waitlist and Student Threading

## Overall Status: `gaps_found`

**Substance:** all 6 requirements satisfied, code wiring traced, production live and healthy.
**Procedure:** RRR verify-phase artifacts missing for every phase. The audit follows its own rules and flags this as a blocker even though external verification was done.

> **Operator note:** This milestone was driven *outside* RRR (manual STATE.md / ROADMAP.md edits, direct deploys). The actual work is real and verified; the artifacts to prove it via RRR's chain-of-evidence are not. Treat the `gaps_found` status as procedural, not substantive.

## Requirements Coverage

| Requirement | Phase | Status | Evidence |
|---|---|---|---|
| WAIT-01: authenticated users land on QR/SMS pairing | 7 | ✅ | `server.mjs` redirects `/` → `/waitlist`; post-auth flow routes to `/pairing` |
| WAIT-02: exact verification text with code | 7 | ✅ | `views.mjs:86` — `` `Hey internjobs.ai! My verification code is ${pairing.code}. What's next?` `` |
| WAIT-03: short, unique, textable pairing code | 7 | ✅ | 8-character code generated in `store.mjs` `createOrRefreshPairingCode` |
| THREAD-01: same-phone follow-ups attach to verified student | 7 | ✅ | `store.mjs:362` — normalized regex match on `channel_address`; `recordInboundMessage` resolves student by normalized phone |
| GRAPH-01: durable Cognee thread placeholder | 7 | ✅ | `ensureStudentThread` called from `confirmPairingCode` (trigger=`pairing_confirmed`) and `recordInboundMessage` (trigger=`student_reply`); inserts into `student_threads` with `status='pending_provider_setup'` |
| ENRICH-01: durable Sprite/Bright Data enrichment job | 7 | ✅ | `queueProfileEnrichment` called from `upsertStudentFromAuth`; inserts into `profile_enrichment_jobs` |

**Coverage: 6/6.**

## Phase Verification

| Phase | SUMMARY.md | VERIFICATION.md | Live-system check | Status |
|---|---|---|---|---|
| 7 — Seamless Student Waitlist (v1.1) | ✅ present | ❌ missing | ✅ `/healthz` 200, `/config/status` `{"missing":[]}`, migrations applied | **Unverified (no artifact)** |

The only phase formally in v1.1 (phase-01-seamless-student-waitlist) lacks a VERIFICATION.md. Phase 2 plan `02-01` was also completed during the v1.1 cycle (Clerk prod activation today) with no plan-level verification artifact.

## Cross-Phase Integration

| Flow | Verified | Notes |
|---|---|---|
| Clerk auth → `upsertStudentFromAuth` → `queueProfileEnrichment` | ✅ | Code traced: `server.mjs` → `store.mjs:57/263` |
| Pairing confirmation → `ensureStudentThread` | ✅ | `store.mjs:126/345` invokes after `confirmPairingCode` |
| Follow-up inbound → phone normalization → existing student | ✅ | `store.mjs:362` regex; `recordInboundMessage` attaches to confirmed student |
| Webhook idempotency (duplicate `provider_event_id`) | ✅ | `messaging_events` insert pattern; live `/config/status` reports webhook config present |
| Live `/healthz` over HTTPS | ✅ | 200 OK with `clerk/database/photonNumber/photonWebhook/spectrumListener` all `true` |

## End-to-End Flows

| Flow | Code traced | Live runtime | Notes |
|---|---|---|---|
| Anonymous → marketing CTA → `app.internjobs.ai/waitlist` | ✅ | ✅ | DNS resolves, HTTPS 200, redirect to `/waitlist` |
| LinkedIn sign-in via Clerk prod → onboarding | ✅ | ⚠️ NOT EXERCISED | Prod Clerk keys are live in Fly; no end-to-end OAuth round-trip has been performed since they went live |
| QR/SMS code dispatch → student texts code → channel confirmed | ✅ | Not re-tested today | Live verification of the inbound webhook path requires sending a real text |
| Follow-up inbound from confirmed phone | ✅ | Not re-tested today | |
| Cognee + Sprite/BrightData record insertion | ✅ | Indirect — `student_threads` and `profile_enrichment_jobs` exist in schema, code wired | No provider call attempted (correct per gating policy) |

**1 critical runtime gap: live LinkedIn-prod sign-in has not been smoke-tested.**

## Tech Debt

### Phase 7
- **pg SSL warning** — current connection string uses `sslmode=require` (or alias). pg v9 will change behavior. Update before next major pg upgrade.
- **Provider activation runbook** — placeholders work, but the trigger that turns `pending_provider_setup` into real Cognee/Sprite/BrightData calls is not documented as a runbook. Adds friction when partners are ready.

### Phase 2
- **`CLERK_SECRET_KEY` in chat history (2026-05-15)** — user declined rotation. Tracked as accepted residual risk. Anyone with access to this session transcript has held the key.

### Cross-cutting
- **No VERIFICATION.md anywhere in `.planning/milestones/`** — v1.0 and v1.1 phases were driven outside RRR.
- **v1.2 naming collision** — ROADMAP.md lists both Student Agent MVP and Startup Access MVP as v1.2. Must resolve.

## Retro Metrics (gstack-borrowed)

Commit range: 2026-05-09 12:00 → HEAD (post-v1.0 cycle).

**Commits per phase:**
| Phase | Commits |
|---|---|
| 7 (seamless waitlist) | 1 (`fd004a7`) |
| Cross-cutting docs | 1 (`9ee3657`) |
| Uncommitted (today) | 3 working-tree changes: Dockerfile, STATE.md, ROADMAP.md |

**Fix-to-feature ratio:** 0% — healthy (no fix commits this cycle).
**Top churn files:** `README.md`, `apps/app/docs/photon-spectrum-contract.md`, `apps/app/docs/fly-deploy.md`, `package-lock.json`, `apps/app/src/views.mjs`.
**Sessions detected:** 2 work sessions (2026-05-09 evening, 2026-05-15 today).
**Net LOC delta (committed only):** +1896 / −105 (net +1791).

No quality-warning thresholds tripped.

## Recommendations

1. **Run live LinkedIn-prod smoke test** — the only substantive verification gap. Sign in with a real LinkedIn account against `app.internjobs.ai`, walk through QR/SMS code dispatch, send one text from a real phone to confirm. ~5 minutes; covers WAIT/THREAD/AUTH end-to-end against the live config.
2. **Either backfill VERIFICATION.md retroactively OR accept that this project is "RRR-flavored but not RRR-driven"** — and capture that in `.planning/config.json` or PROJECT.md so future audits stop flagging it. (Backfill is cheap if you keep it brief: one short VERIFICATION.md per phase referencing the SUMMARY.md + live endpoint evidence.)
3. **Resolve v1.2 milestone collision** before any v1.2 planning runs. Decide: single fat v1.2, or split into v1.2 Student Agent + v1.3 Startup Access?
4. **Document partner activation runbook** so when Cognee / Sprite.dev / Bright Data credentials arrive, the path from placeholder → live record is a written checklist, not a discovery.

## Next Actions

Given `gaps_found` status, RRR's recommended path is `/rrr:plan-milestone-gaps` to plan gap closure. In this case, "gap closure" amounts to:

- A short live-smoke-test phase (LinkedIn signup + 1 SMS round-trip) — likely 30 min not a phase.
- A procedural decision: backfill VERIFICATION.md vs. acknowledge non-RRR provenance.

If you'd rather not run a gap-closure phase, you can proceed to `/rrr:complete-milestone v1.1` and accept the tech debt as captured here. The substantive work is shipped and the audit is on file.
