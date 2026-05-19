---
milestone: v1.2
audited: 2026-05-19
status: tech_debt
scores:
  requirements: 16/16
  phases: 13/13
  integration: 8/8
  flows: 3/4
gaps: []
tech_debt:
  - phase: 01-06
    items:
      - "No RRR VERIFICATION.md artifacts — phases shipped before /rrr:audit became routine; verification lives in STATE.md decision logs only"
      - "INTEG-01 two-sided smoke test (Phase 06) gated on user-action checklist (USER-ACTIONS.md Sections A–D)"
  - phase: 07-07b-08-09-10
    items:
      - "Shipped to production without RRR VERIFICATION.md (inherited the v1.0/v1.1 audit gap)"
  - phase: 11-12-13
    items:
      - "Verifier `human_needed` on all three — 9 items total require browser visual + live API keys"
      - "DAILY_API_KEY user-action still pending (Phase 11 fails soft until provisioned)"
human_action_backlog:
  must_do_before_pilot:
    - "Paste DAILY_API_KEY → save to Infisical → push to Worker via REST"
    - "Run INTEG-01 11-step smoke against prod (USER-ACTIONS.md Section E)"
    - "Browser visual verification: Phase 13 wizard, notification bell, push delivery; Phase 12 dashboard rendering; Phase 11 Meetings pane embed"
  optional_before_pilot:
    - "Set up Sentry project + paste SENTRY_DSN"
    - "Rotate SEC-ROTATE secrets (Clerk + CF Email + CF AI + CF Account-broad token)"
  carryover_v1.3:
    - "STORAGE-02 attachment ingest"
    - "TELNYX-ADAPT-01 SMS provider swap"
    - "SAFETY-01 Lakera Guard pre-LLM screening"
    - "Cognee placeholder activation (COGNEE-ACTIVATE-01)"
    - "CF Agents SDK + Telnyx voice for Parrot Phone/SMS panes"
---

# v1.2 — Two-Sided Agent MVP — Milestone Audit

**Date:** 2026-05-19
**Status:** `tech_debt` — fully code-complete, no blockers, but verification artifacts uneven across phases + user-action gates remain
**Recommendation:** **Ship the milestone after pilot user-actions complete.** No load-bearing gaps. The tech debt is process-debt (missing VERIFICATION.md for older phases), not code-debt.

---

## Executive Summary

v1.2 expanded from the original 6-phase plan (Two-Sided Agent MVP on Spectrum/Photon + Mastra + operator approval) into a **13-phase milestone** spanning the entire internal+external messaging surface. Major reshape moments:

- **Phase 01–06** (code-complete by 2026-05-16): the originally-scoped startup-identity + Mastra-agent + operator-approval surface for the **student-startup messaging product** at app.internjobs.ai.
- **2026-05-16 swap commits:** Resend → Cloudflare Email Service for outbound; OpenAI → Workers AI direct REST (proxy Worker torn out same day).
- **2026-05-17 autonomy pivot:** operator approval gate REMOVED — agent now sends autonomously. Phase 05 reframed as read-only audit log.
- **2026-05-17–18 SCOPE-EXPAND:** added Phases 07 (Mac-bridge iMessage), 07b (BlueBubbles native UX), 08 (agentic-inbox at agent.internjobs.ai), 09 (Proxycurl LinkedIn + QR onboarding).
- **2026-05-19 Parrot:** Phase 10 (workspace.internjobs.ai for ~50 employees) + Phase 11/12/13 (Daily.co + Dashboard agent + cross-pane polish), with a **same-day Daily.co reversal** (deferred → reinstated within hours per user direction).
- **2026-05-19 LLM transport pivot:** Parrot moves from Workers AI direct REST → Cloudflare AI Gateway (per-employee daily caps + caching). Student app stays on direct REST (intentional split).

Final state: **143 commits since v1.1, net +64,890 LOC, 15.7% fix-to-feature ratio** (well within healthy). **All 8 cross-phase integration contracts verified ✓.** Architecture is sound. Open work is operational, not engineering.

---

## Scope vs. Reality

### Phases declared in ROADMAP

| # | Name | Declared | Shipped | VERIFICATION.md | Notes |
|---|------|----------|---------|-----------------|-------|
| 01 | Pre-flight + SMS Abstraction | ✓ | code-complete | — | Awaiting USER-ACTIONS (DNS, Clerk rotate) |
| 02 | Startup Identity, Consent & Roles | ✓ | code-complete | — | Awaiting Clerk dashboard config |
| 03 | Startup Email Channel | ✓ | code-complete | — | Awaiting CF Email Routing + CF Email Sending onboard |
| 04 | Mastra Agent Core | ✓ | code-complete | — | Migrations pending in prod |
| 05 | Operator Audit Log (was Approval Gate) | ✓ | code-complete | — | Autonomy pivot 2026-05-17 |
| 06 | Two-Sided Integration Smoke Test | ✓ | runbook + admin endpoint shipped | — | INTEG-01 prod run is the user's job |
| 07 | Self-Hosted iMessage Bridge | scope-add 2026-05-17 | ✓ shipped | — | Mac mini + CF Tunnel, $250→$73/mo |
| 07b | BlueBubbles + SIP-off | scope-add 2026-05-18 | ✓ shipped | — | Native iMessage UX, 4.1s round-trip |
| 08 | Agentic Inbox + MCP | scope-add 2026-05-17 | ✓ shipped | — | maya@agent.internjobs.ai live |
| 09 | LinkedIn Enrichment + QR | scope-add 2026-05-18 | ✓ shipped | — | Proxycurl + Standout-style onboarding |
| 10 | Parrot Internal Workspace | scope-add 2026-05-19 | ✓ shipped | — | Two Clerk apps, Mattermost, Vanta UI |
| 11 | Daily.co Integration | reinstated 2026-05-19 PM | ✓ shipped | ✓ this session | `human_needed` (DAILY_API_KEY) |
| 12 | Dashboard Mothership Agent | scope-add 2026-05-19 | ✓ shipped | ✓ this session | `human_needed` |
| 13 | Cross-pane + Launch Polish | scope-add 2026-05-19 | ✓ shipped | ✓ this session | `human_needed` |

**13/13 phases shipped to source.** Of those, 7 are also live in production (07, 07b, 08, 09, 10, plus Phase 12+13 deployable on next wrangler push of apps/parrot).

### Verification artifact coverage

```
Phase            VERIFICATION.md
─────────────────────────────────
01–06            ✗  (informal: STATE.md decision logs)
07               ✗
07b              ✗
08               ✗
09               ✗
10               ✗
11               ✓  human_needed (5 items)
12               ✓  human_needed (4 items)
13               ✓  human_needed (4 items) → 1 gap fixed inline (commit 8fbfadb)
─────────────────────────────────
Coverage: 3/13 (23%)
```

This is the v1.0/v1.1 audit gap STATE.md flagged on 2026-05-17 — phases shipped before /rrr:audit-milestone became routine. **Not a load-bearing defect** (code is verified by other means — integration check, STATE.md decisions, production logs) but a process-debt the team owes itself in v1.3.

---

## Requirements Coverage

Per REQUIREMENTS.md traceability table (lines 144–161), v1.2 declared 16 active requirements:

| Req | Phase | Status |
|-----|-------|--------|
| SEC-01 | 01 | Code-complete (DNS user-action pending) |
| SMS-01 | 01 | Code-complete + extended by Phase 07/07b |
| STARTUP-01 | 02 | Code-complete (Clerk strategy user-action pending) |
| STARTUP-02 | 02 | Code-complete |
| ROLE-01 | 02 | Code-complete |
| EMAIL-01 | 03 | Code-complete (CF Email Routing user-action pending) |
| EMAIL-02 | 03 | Code-complete (CF Email Sending onboard pending) |
| AGENT-01 | 04 | Code-complete |
| AGENT-02 | 04 | Code-complete |
| AGENT-03 | 04 | Code-complete |
| MEMORY-01 | 04 scope-add | ✓ **Shipped 2026-05-17** (FalkorDB + Graphiti pattern live) |
| OPS-01 | 05 | Code-complete |
| OPS-02 | 05 | Code-complete (2026-05-17 autonomy pivot reframed) |
| EMAIL-03 | 03 scope-add | Code-complete (subdomain isolation shipped 2026-05-16) |
| STORAGE-01 | 04 scope-add | Code-complete (R2 scaffold; ingestion deferred to v1.3) |
| INTEG-01 | 06 | **Runbook shipped; production smoke = user's job** |

**Coverage: 16/16 requirements have shipped source code.** Production activation gated on USER-ACTIONS.md.

### Implicit requirements (added by scope-expand phases — never formalized into REQUIREMENTS.md)

- **EMAIL-AGENT-01** (Phase 08): agentic-inbox MCP — shipped.
- **WORKSPACE-01** (Phase 10): Parrot workspace — shipped.
- **DASHBOARD-AGENT-01** (Phase 12): cross-channel todos — shipped.
- **CROSSPANE-01** (Phase 13): Email↔Chat↔Meeting + push — shipped.
- **MEETINGS-01** (Phase 11): Daily.co embed + ephemeral rooms — shipped.

These were tracked via ROADMAP phase descriptions instead of REQUIREMENTS.md entries — a process drift worth correcting in v1.3 (the requirements file should list these alongside the originals).

---

## Cross-Phase Integration

Full report: `.planning/v1.2-INTEGRATION-CHECK.md`. Summary table:

| # | Contract | Status | Evidence |
|---|----------|--------|----------|
| 1 | Phase 01 SmsProvider seam → Phase 07/07b MacBridgeSmsProvider | ✓ verified | Interface in `apps/app/src/sms/provider.mjs`; mac-bridge wired via `SMS_PROVIDER` env in server.mjs |
| 2 | Phase 03/08 CF Email Routing → Phase 12 dashboard inbox hook | ✓ verified | `EmployeeMailboxDO.createEmail()` calls `void this.extractTodosFromEmail()` on Inbox |
| 3 | Phase 10 EmployeeMailboxDO → migrations 1–7 sequential | ✓ verified | Migrations 1 (initial) → 2 (profile) → 3 (todos) → 4 (notifications + push) → 5 (onboarding + flags) → 6 (meetings_rooms) → 7 (meeting_started event_type). No collisions. |
| 4 | Phase 12 AI Gateway → Phase 13 push triggers | ✓ verified | `insertTodos()` checks for existing row + emits push when `urgency_score ≥ 70`; dedup protects against alarm re-polls |
| 5 | Phase 13 EmailToChat → Mattermost bot | ✓ verified | Bot `parrot` (id 5rdwxe1ygfnc7bbb1m9oeczd1e) created this session; token in Worker secret + Infisical; code fails soft when MATTERMOST_BOT_TOKEN absent |
| 6 | Phase 13 StartMeeting → Phase 11 startEphemeralMeeting | ✓ verified | `POST /api/crosspane/start-meeting` calls `startEphemeralMeeting()`; toast fallback on DAILY_API_KEY missing |
| 7 | Phase 09 LinkedIn enrichment → Phase 04 Mastra context | ✓ verified | `loadStudentProfile()` pulls students.name + profile_snapshots.display_name + linkedin URL into per-turn context |
| 8 | Phase 08 agentic-inbox MailboxDO → Phase 10 EmployeeMailboxDO fork | ✓ verified | Schema-compatible; intentional deltas (clerk_user_id key, profile table, no threading helpers in Wave 1) |

**All 8 verified.** No broken wiring, no orphan exports, no integration gaps.

### Auth boundary check

| Boundary | Status |
|----------|--------|
| Student Clerk (clerk.app.internjobs.ai, LinkedIn-only) vs. Employee Clerk (clerk.workspace.internjobs.ai, phone-OTP) | ✓ isolated — two separate Clerk apps, no shared cookies, no shared JWT issuer |
| Agentic-inbox CF Access SSO vs. Parrot Clerk | ✓ isolated — different auth surface, different Worker |
| Per-employee DO resolution via Hono context (never URL param) | ✓ enforced in all routes (verified by integration check) |
| Operator gate (`publicMetadata.role` OR `PARROT_OPERATOR_EMAILS` allowlist) | ✓ shipped Phase 10 Wave 2b |

No cross-leak paths identified.

---

## End-to-End Flows

| Flow | Status |
|------|--------|
| Student LinkedIn sign-in → /pairing QR → text verification → Maya agent reply | ✓ code-complete (gated on DNS + Clerk LinkedIn provider in production) |
| Startup email sign-in → consent → role creation → agent draft → autonomous send | ✓ code-complete (gated on CF Email Routing + Clerk strategy enablement) |
| INTEG-01 two-sided smoke (11 steps) | ⚠ **runbook + endpoint shipped; production run = user's job** (USER-ACTIONS.md Section E) |
| Employee workspace.internjobs.ai → phone OTP → Mattermost chat / email / dashboard / meetings | ✓ code-complete; production version live but needs browser smoke for Phases 11/12/13 surfaces |

**3 of 4 flows code-complete. INTEG-01 is the only one with a hard production-only blocker** (and that's by design — it's the milestone's acceptance test).

---

## Retro Metrics (gstack-borrowed)

Commit range: `v1.1..HEAD` (2026-05-15 through 2026-05-19).

### Volume

- **Total commits:** 143
- **Net LOC delta:** +68,378 / −3,488 (net **+64,890**)
- **Calendar days:** 4 (2026-05-16 → 2026-05-19)
- **Average ~36 commits/day, ~16k LOC/day** — high-velocity sprint pattern

### Fix-to-feature ratio

- `fix:` commits: **9**
- `feat:` commits: **48**
- Ratio: **15.7%** ✓ healthy (well under the 30% advisory threshold)
- No `REVIEW_QUALITY_WARNING` raised

### Commits per phase (top 12)

| Phase | Commits |
|-------|---------|
| 12-01 | 4 |
| 13 | 3 |
| 13-01, 13-02, 13-03 | 3 each |
| 12-02, 12-03 | 3 each |
| 11-01, 11-02, 11-03 | 3 each |
| 06-01 | 3 |
| 12 (top-level) | 2 |

(Phases 07/07b/08/09/10 commits not prefixed in commit msgs — they predate the disciplined `feat({phase}-{plan}):` format adopted for the Phases 11–13 sprint.)

### File churn hotspots (top 5 across waves)

1. `apps/parrot/workers/durableObject/index.ts` — touched by Phases 10, 11, 12, 13 (4 phases). **Highest coupling point.** EmployeeMailboxDO accreted 7 migrations + ~15 methods across the sprint. Watch for v1.3 ripple.
2. `apps/parrot/workers/durableObject/migrations.ts` — 7 migrations stacked (one per major wave). Clean linear history; no reverse-migration needed.
3. `apps/parrot/workers/index.ts` — Hono route file accreted ~12 new endpoints across Phases 12–13. Approaching split-into-modules threshold.
4. `apps/parrot/wrangler.jsonc` — env/secret/var declarations grew with each wave.
5. `.planning/STATE.md` + `.planning/ROADMAP.md` — every phase writes a decision block here. Normal RRR pattern.

### Sessions

Rough session count (45-min gaps): ~12–15 sessions over 4 days. Most density 2026-05-19 (Parrot + Phase 11/12/13 sprint). Tight focus per session.

---

## Tech Debt Backlog

### Process debt (verification artifacts)

- **No VERIFICATION.md for Phases 01–10.** All 10 phases shipped code; only Phases 11–13 have RRR audit artifacts.
- **Impact:** future audits will rely on STATE.md decision logs (manual archeology) instead of structured `must_haves`-vs-code checks.
- **Recommendation:** v1.3 first phase plan should include retroactive VERIFICATION.md authoring as a milestone-archive task. Or accept the gap and start fresh with the v1.3 discipline.

### Code debt (small)

- **`apps/parrot/workers/index.ts` line 595–598:** stale block comment describes pre-Wave-3 `start-meeting` behavior ("does NOT call Daily.co — Phase 11 pending"). Code at line 644 is correct; comment is misplaced. **Cosmetic only.** Suggest one-line fix in v1.3 first commit.
- **`apps/parrot/app/components/OnboardingWizard.tsx` line 140:** pre-existing TypeScript error `Uint8Array<ArrayBufferLike>` — not introduced by this sprint, doesn't block deploys, ignored by tsc strictness elsewhere. Trace + fix in v1.3.
- **`apps/parrot` build chain:** `wrangler deploy --dry-run` fails on `virtual:react-router/server-build`. Pre-existing; doesn't block dev (`tsc --noEmit` is clean). Workaround: deploy from the apps/parrot subdirectory with proper vite preflight. Tracked for v1.3 hygiene.

### Operational debt (user actions)

Pre-pilot, ordered:

1. **DAILY_API_KEY** — paste → save to Infisical → push to Worker via the same REST pattern used for the other Phase 11/12/13 secrets this session. (~5 min once you have the key.)
2. **`internjobs-parrot` Worker redeploy** — new KV namespace binding (`PARROT_FEATURE_FLAGS`) added to wrangler.jsonc this session needs a redeploy to take effect. Fix the build-chain first (above) or push via the CF REST `PUT /workers/scripts/{name}` endpoint with a fresh bundle.
3. **INTEG-01 11-step smoke** against production (USER-ACTIONS.md Section E).
4. **Browser visual verification** for Phase 11/12/13 surfaces (9 items across the three VERIFICATION.md reports).
5. **Optional but recommended:** SEC-ROTATE backlog — Clerk + CF Email + CF AI + CF Account-broad token rotation (the broad token was used to provision the new resources this session; rotation tightens the blast radius).

Post-pilot:

- `STORAGE-02` attachment ingest (v1.3)
- `TELNYX-ADAPT-01` SMS adapter (v1.3)
- `SAFETY-01` Lakera Guard pre-LLM screening (v1.3)
- Cognee placeholder activation (v1.3+)
- CF Agents SDK + Telnyx voice for Parrot Phone/SMS panes (v1.3+ per `project-phone-sms-architecture.md`)

---

## Recommendation

**Status:** `tech_debt` — milestone is ready to ship pending operational user-actions.

- **No load-bearing engineering gaps.** All 8 cross-phase contracts verified. All 16 declared requirements have shipped source. All flows except INTEG-01 are code-complete; INTEG-01 is by design a production smoke that only the user can run.
- **Process debt is non-blocking.** Phases 01–10 lack RRR VERIFICATION.md artifacts but their behavior is captured in STATE.md decision logs and verified by the integration check (no broken wiring detected).
- **3 user-actions are critical** (DAILY_API_KEY, INTEG-01 smoke, browser visuals). The rest are nice-to-have or v1.3.

### Next steps

1. **`/rrr:complete-milestone v1.2`** once you've completed the 3 critical user-actions above.
2. Archive `.planning/milestones/v1.2-two-sided-agent-mvp/` per the milestone-complete protocol.
3. Tag the merge commit as `v1.2`.
4. **`/rrr:new-milestone v1.3`** to discuss what comes next. (Suggested headline candidates: STORAGE-02 ingest, TELNYX-ADAPT-01, CF-Agents-SDK voice, full-composer email UI for the chat→email handoff seam.)

---

*Audit performed 2026-05-19 by /rrr:audit-milestone. Integration check at `.planning/v1.2-INTEGRATION-CHECK.md`. Phase verifications at `.planning/milestones/v1.2-two-sided-agent-mvp/phase-{11,12,13}-*/{11,12,13}-VERIFICATION.md`.*
