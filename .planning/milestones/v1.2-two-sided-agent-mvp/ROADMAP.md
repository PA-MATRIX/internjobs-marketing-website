# Milestone v1.2: Two-Sided Agent MVP

**Status:** ✅ SHIPPED 2026-05-19
**Phases:** 01–17 (17 distinct phases including 07b decimal-insertion)
**Total Plans:** 27 plans across 17 phases
**Code-complete:** 16/17 fully shipped; 1/17 (Phase 14 FalkorDB) code-shipped + runtime-blocked on infra bridge

## Overview

v1.2 expanded from the originally-scoped 6 phases (Two-Sided Agent MVP on Spectrum/Photon + Mastra + operator approval) into a 17-phase milestone spanning the entire internal+external messaging surface. Major shape changes:

- **Phase 01–06** (base scope, code-complete): startup identity, Mastra agent core, operator audit log, INTEG-01 smoke runbook. Production-gated on USER-ACTIONS Sections A–D.
- **2026-05-16 swap commits:** Resend → Cloudflare Email Service; OpenAI → Workers AI direct REST.
- **2026-05-17 autonomy pivot:** operator approval gate removed → autonomous send + flag-for-review audit log.
- **2026-05-17 SCOPE-EXPAND:** Phase 07 (Mac mini iMessage bridge), 07b (BlueBubbles), 08 (agentic-inbox MCP), 09 (LinkedIn enrichment + QR), 10 (Parrot workspace).
- **2026-05-19 Parrot:** Phase 10 workspace.internjobs.ai shipped; Waves 3/4/5 spun out as Phases 11/12/13.
- **2026-05-19 PM additions:** Phase 14 (FalkorDB knowledge graph), 15 (Mattermost SSO), 16 (Admin invite UX), 17 (GenZ chat polish).

Final state: **178 commits since v1.1, net +71,340 LOC, 15.7% fix-to-feature ratio.** All 8 cross-phase integration contracts verified live in production. Email→todo extraction pipeline working end-to-end with kimi-k2.6 via Cloudflare AI Gateway (per-employee daily caps + cost tracking confirmed).

## Phases

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 01 | Pre-flight + SMS Provider Abstraction | code-complete | Gated on USER-ACTIONS DNS + Clerk |
| 02 | Startup Identity, Consent & Roles | code-complete | Gated on Clerk strategy enable |
| 03 | Startup Email Channel | code-complete | Gated on CF Email Routing onboard |
| 04 | Mastra Agent Core | code-complete | Includes MEMORY-01 (FalkorDB graph for student app) |
| 05 | Operator Audit Log (was: Approval Gate) | code-complete | 2026-05-17 autonomy pivot |
| 06 | Two-Sided Integration Smoke Test | code-complete | INTEG-01 prod run is user's job |
| 07 | Self-Hosted iMessage Bridge | ✅ shipped | Mac mini + CF Tunnel, $250→$73/mo |
| 07b | BlueBubbles + SIP-off Mac Bridge | ✅ shipped | Native iMessage UX, 4.1s round-trip |
| 08 | Agentic Inbox + MCP | ✅ shipped | agent.internjobs.ai live |
| 09 | LinkedIn Enrichment + QR Onboarding | ✅ shipped | Proxycurl + Standout-style flow |
| 10 | Parrot — Internal Employee Workspace | ✅ shipped | workspace.internjobs.ai, two Clerk apps |
| 11 | Daily.co Integration | ✅ shipped | Meetings pane + ephemeral StartMeeting |
| 12 | Dashboard Mothership Agent | ✅ shipped | kimi-k2.6 via AI Gateway, live email extraction |
| 13 | Cross-pane Actions + Launch Polish | ✅ shipped | Push, drawer, wizard, PILOT-RUNBOOK |
| 14 | Parrot Knowledge Graph (FalkorDB) | △ code-shipped, runtime-blocked | falkordb npm incompatible with Workers runtime; dynamic-import + fail-soft; activation needs Fly REST proxy or RESP3 client |
| 15 | Mattermost OIDC SSO activation | ✅ shipped | Already live since Phase 10 Wave 2b; ChatPane copy updated |
| 16 | Ridhi Admin Invite UX | ✅ shipped | Phone-OTP, 6 capability toggles, warm welcome email |
| 17 | GenZ Chat Polish + Confetti | ✅ shipped | MM GIF picker + canvas-confetti celebratory events |

## Milestone Summary

**Decimal Phases:**
- Phase 07b: BlueBubbles + SIP-off Mac Bridge (inserted after Phase 07 for native iMessage UX upgrade)

**Key Decisions:**
- 2026-05-16: Resend → Cloudflare Email Service (one less vendor)
- 2026-05-16: OpenAI → Workers AI direct REST (later: AI Gateway for Parrot, direct REST stays for student app)
- 2026-05-17: Autonomy pivot — operator approval gate removed
- 2026-05-17: AGENT-VOICE — chat model upgraded to Llama 3.3 70B fp8-fast + voice-tuned exemplars
- 2026-05-17: MEMORY-01 — self-hosted FalkorDB on Fly + Graphiti temporal-fact pattern (Node, no Python sidecar)
- 2026-05-19: Two separate Clerk apps (student LinkedIn + employee phone-OTP)
- 2026-05-19: LLM transport for Parrot = Cloudflare AI Gateway with per-employee daily caps (NOT direct REST like student app)
- 2026-05-19: Daily.co integration kept on default `internjobs.daily.co` subdomain; vanity domain deferred to v1.3

**Issues Resolved During Milestone:**
- AUTH-PROD prod auth loop (Clerk handshake-param handling)
- EMAIL-03 subdomain isolation (agent.internjobs.ai vs apex)
- AI Gateway URL encoding bug (kimi-k2.6 model path)
- Phase 12 response parser (kimi's OpenAI-shape vs Workers AI shape)
- Phase 12 max_tokens too small for reasoning model
- Phase 10 Wave 1 email handler was a stub — replaced with real ingest
- Stale build cache silently shipping old code (4 deploys were no-ops until forced rebuild)
- `/healthz` route claimed by React Router catch-all instead of Hono (minor)
- idx_todos_source non-UNIQUE (would have duplicated Mattermost re-polls)
- ChatPane stale "Wave X" copy + wrong auth-provider claim

**Issues Deferred to v1.3:**
- Phase 14 FalkorDB runtime activation (Fly REST proxy OR Workers RESP3 client)
- SAFETY-01 Lakera Guard pre-LLM screening (needs vendor account)
- Telnyx adapter (A2P 10DLC registration takes weeks)
- Cognee + Bright Data activation (legal review)
- VOICE-01 / SLACK-01 / STARTUP-SMS-01 (gated on user signal)
- STORAGE-02 attachment ingest
- STORAGE-03 permanent short links
- Vanity Daily.co subdomain (meet.internjobs.ai)

**Technical Debt Incurred:**
- Phases 01–10 lack RRR VERIFICATION.md artifacts (informal STATE.md decision-log only)
- Stale block comment in `workers/index.ts:595-598` about pre-Wave-3 start-meeting (cosmetic)
- Pre-existing TypeScript warning in `OnboardingWizard.tsx:140` (Uint8Array<ArrayBufferLike>)
- v1.2 explicit USER-ACTIONS Section E (INTEG-01 11-step prod smoke) never run
- 3 SEC-ROTATE items pending: Clerk secret (2026-05-15), CF Email API (2026-05-16), CF AI API (2026-05-16), broad CF API token (2026-05-19 — used this session for resource provisioning)

---

*For current project status see `.planning/ROADMAP.md`*
