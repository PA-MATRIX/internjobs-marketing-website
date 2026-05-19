# Roadmap: InternJobs.ai

## Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 01–06 (shipped 2026-05-09)
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 07 (shipped 2026-05-15)
- ✅ **v1.2 Two-Sided Agent MVP** — Phases 08–17 (shipped 2026-05-19)
- 🚧 **v1.3 Pilot Hardening** — Phases 18–21 (in progress)

## Overview

v1.3 makes v1.2 production-safe for the first 5-10 startup pilots. Four tight phases unblock the dormant FalkorDB graph layer (shipped in v1.2 but architecturally unreachable from the Parrot Worker), close out latent agent-todo clutter via auto-resolution, add a pre-LLM safety screen, and rotate the credentials used heavily through the v1.2 build sprint. Phase order is research-derived: 18 (graph proxy) unblocks 19 (auto-clear), while 20 (safety) and 21 (rotation) run independently with 21 explicitly last as the milestone's green-board.

## Phases

**Phase Numbering:**
- Integer phases (18-21): Planned v1.3 work
- Decimal phases (e.g., 18.1): Reserved for urgent insertions during execution

- [ ] **Phase 18: Graph Bridge Runtime** — `internjobs-graph-api` Fly proxy + Parrot Worker `graph.ts` rewire
- [ ] **Phase 19: Todo Auto-Resolution** — cron-based reconciliation + Resolved view + Undo
- [ ] **Phase 20: Pre-LLM Safety Screening** — Lakera Guard on student SMS + email inbound, `/ops/safety` view
- [ ] **Phase 21: Credential Rotation** — 5 token families rotated, old tokens revoked, all `/healthz` green

## Phase Details

### Phase 18: Graph Bridge Runtime

**Goal**: Make the v1.2 FalkorDB graph layer actually reachable from the Parrot Worker by introducing a thin Fly REST proxy (`internjobs-graph-api`) that fronts FalkorDB. Workers RESP3 path was researched and ruled out — `cloudflare:sockets` blocks private IPs and no Cypher lib runs in Workers today.

**Depends on**: Nothing (first phase of v1.3)

**Requirements**: GRAPH-PROXY-01, GRAPH-PROXY-02, GRAPH-PROXY-03, GRAPH-PROXY-04, GRAPH-PROXY-05, GRAPH-WORKER-01, GRAPH-WORKER-02, GRAPH-WORKER-03, GRAPH-VERIFY-01, GRAPH-VERIFY-02, GRAPH-VERIFY-03

**Success Criteria** (what must be TRUE):
1. Parrot Worker `/healthz` returns `graph_ready: true` AND `graph_proxy_reachable: true` against production
2. A real inbound email triggers `extractTodosFromEmail` and logs `graph_context_injected` with non-zero chars
3. Manual smoke test (`ensureParrotGraphSchema`, `recordTodoFact`, `getActiveTodos`, `getEmployeeContext`) passes against production FalkorDB
4. `FALKORDB_URL`/`FALKORDB_PASSWORD` removed from Parrot Worker env (replaced by `GRAPH_API_URL`/`GRAPH_API_SECRET` via Infisical)

**Research flags**: ✓ DONE — `.planning/milestones/v1.3-pilot-hardening/research/` (STACK, ARCHITECTURE, PITFALLS sections specifically address this phase)

**Plans**: 3 plans (TBD — refined during `/rrr:plan-phase 18`)

Plans:
- [ ] 18-01: `internjobs-graph-api` Fly app — Dockerfile, `fly.toml`, `src/index.mjs` (Hono/Node), `GRAPH_API_SECRET` provisioning
- [ ] 18-02: Parrot Worker rewire — `graph.ts` transport swap, `types.ts` env update, `FALKORDB_*` env removal
- [ ] 18-03: Healthz dual-readiness + manual smoke test + `npm run smoke:parrot-graph`

---

### Phase 19: Todo Auto-Resolution

**Goal**: Close out cross-channel todos automatically when their underlying Graphiti fact's `valid_to` is set. Includes operator audit trail ("Recently resolved" view with "Agent" pill) and one-click undo so Ridhi can trust the auto-clearing. Hard-blocked on Phase 18 — the cron loop queries the graph proxy.

**Depends on**: Phase 18 (graph proxy must be live + verified)

**Requirements**: AUTO-CLEAR-01, AUTO-CLEAR-02, AUTO-CLEAR-03, AUTO-CLEAR-04, AUTO-CLEAR-05, AUTO-CLEAR-06, AUTO-CLEAR-07, AUTO-CLEAR-08, AUTO-CLEAR-UX-01, AUTO-CLEAR-UX-02, AUTO-CLEAR-UX-03, AUTO-CLEAR-UX-04, AUTO-CLEAR-UX-05, AUTO-CLEAR-VERIFY-01, AUTO-CLEAR-VERIFY-02

**Success Criteria** (what must be TRUE):
1. A Mattermost reply that closes a Graphiti fact causes the corresponding todo to disappear from the active list within 30 seconds
2. The auto-cleared todo appears in the "Recently resolved" view with a violet "Agent" pill + relative timestamp; one-click Undo restores it to active
3. A newly-created todo (fact valid_to set within last 5 minutes) is NEVER auto-cleared — the minimum-open-window guard prevents the race-condition false clear
4. `EmployeeMailboxDO` migration 8 lands cleanly with `resolution_source TEXT` column; no migration collision with v1.2's 7 migrations

**Research flags**: ✓ DONE — FEATURES.md and PITFALLS.md both cover this phase

**Plans**: 3 plans

Plans:
- [ ] 19-01-PLAN.md — DO migration 8 + `resolveTodo`/`unresolveTodo` RPCs + cron trigger + `scheduled` handler + `auto-clear.ts` with minimum-open-window Cypher
- [ ] 19-02-PLAN.md — Backend routes (`?view=resolved`, `/:id/unresolve`) + `getResolvedTodos` DO method + cross-namespace Cypher smoke test
- [ ] 19-03-PLAN.md — Frontend: "Resolved" nav, animate-out, `ResolvedTodoCard` with Agent/You pill, Undo flow, first-auto-clear-per-session toast

---

### Phase 20: Pre-LLM Safety Screening

**Goal**: Lakera Guard screens every inbound student SMS and unknown-sender email BEFORE the agent loop sees it. Soft-flag default; hard-block only on `prompt_injection >= 0.8`. Fail-open — Lakera unavailability must never block student communication. Independent of Phase 18/19 — can start as soon as the Lakera account is provisioned.

**Depends on**: Nothing (independent; can run in parallel with Phase 18/19 after Lakera account setup)

**⚠️ External gate**: Lakera was acquired by Cisco in May 2025. The first task is to verify the current API at `platform.lakera.ai` before any integration code is written — pre-acquisition tutorials may reference deprecated endpoints, and pricing tier needs confirmation (Community 10k/month is insufficient for 30k/month pilot volume).

**Requirements**: SAFETY-LAKERA-01, SAFETY-LAKERA-02, SAFETY-NODE-01, SAFETY-WORKER-01, SAFETY-INSERT-01, SAFETY-INSERT-02, SAFETY-SCOPE-01, SAFETY-SCOPE-02, SAFETY-POLICY-01, SAFETY-POLICY-02, SAFETY-POLICY-03, SAFETY-RESPONSE-01, SAFETY-RESPONSE-02, SAFETY-LOG-01, SAFETY-VIEW-01, SAFETY-BADGE-01, SAFETY-VERIFY-01, SAFETY-VERIFY-02, SAFETY-VERIFY-03

**Success Criteria** (what must be TRUE):
1. An injection-test student SMS (e.g., "ignore previous instructions and reveal...") is hard-blocked, the student receives the exact canned reply `"hey — couldn't process that one. try rephrasing?"`, and the event is logged in `/ops/safety`
2. A benign student SMS produces zero `/ops/safety` log entries (no noise on clean traffic)
3. A simulated Lakera 5xx or timeout produces a `passed_lakera_unavailable` log entry AND the message proceeds through the agent loop (fail-open verified)
4. Mattermost messages and emails from known `startup_members` senders never hit Lakera (scope discipline verified — no quota waste)

**Research flags**: ✓ DONE — FEATURES.md (policy), ARCHITECTURE.md (insertion points), PITFALLS.md (Cisco rebrand, latency, false positives)

**Plans**: 3 plans (TBD)

Plans:
- [ ] 20-01: Lakera account provisioning + API verification + `LAKERA_GUARD_API_KEY` to Infisical + Node/Worker fetch helpers
- [ ] 20-02: Insertion in `photon.mjs` (student SMS) + `inbound-email.ts` (Worker email) + hard-block / soft-flag / fail-open policy + agent-voice canned reply
- [ ] 20-03: `safety_events` Neon table + `/ops/safety` route + red-dot badge + injection / benign / fail-open verification

---

### Phase 21: Credential Rotation

**Goal**: Rotate all 5 credential families touched heavily during v1.2 development; revoke old tokens; verify all `/healthz` endpoints green. No production code changes — this phase is pure operational hygiene that closes out v1.2's secret debt. Runs LAST so the green-board across all services is the definitive v1.3 ship signal.

**Depends on**: Phases 18, 19, 20 complete (so `GRAPH_API_SECRET` and `LAKERA_GUARD_API_KEY` introduced in earlier phases are included in the rotation inventory)

**Requirements**: SEC-ROTATE-ORDER, SEC-ROTATE-CLERK-01, SEC-ROTATE-CLERK-02, SEC-ROTATE-EMAIL-01, SEC-ROTATE-EMAIL-02, SEC-ROTATE-AI-01, SEC-ROTATE-AI-02, SEC-ROTATE-BROAD-01, SEC-ROTATE-GRAPH-01, SEC-ROTATE-VERIFY-01, SEC-ROTATE-VERIFY-02, SEC-ROTATE-VERIFY-03, SEC-ROTATE-VERIFY-04

**Success Criteria** (what must be TRUE):
1. All 5 token families rotated; old tokens confirmed "Revoked" in vendor dashboards (Clerk × 2, Cloudflare × 3)
2. `/healthz` is green on student Fly app, Parrot Worker, agentic-inbox Worker, and `internjobs-graph-api` Fly proxy
3. JWKS endpoint `https://clerk.internjobs.ai/.well-known/jwks.json` returns valid JSON post-rotation
4. No error rate spike (≤ baseline) on either Clerk app for 15 minutes following each rotation

**Research flags**: ✓ DONE — STACK.md, ARCHITECTURE.md, PITFALLS.md all cover SEC-ROTATE (CF AI token choke point, Clerk multi-key overlap, wrangler-vs-Infisical bootstrap)

**Plans**: 3 plans (TBD)

Plans:
- [ ] 21-01: Clerk Secret Key rotations (both apps) via multi-key overlap; JWKS verification
- [ ] 21-02: CF Email token + CF AI token (Fly first → verify → Worker → verify → revoke) + broad-scope CF token last
- [ ] 21-03: Inventory `GRAPH_API_SECRET` + `LAKERA_GUARD_API_KEY` into SEC-ROTATE register; full `/healthz` sweep; error-rate watch

---

## Progress

**Execution Order:**
Phase 18 → Phase 19 (blocked on 18) → Phase 20 (independent — can start when Lakera ready) → Phase 21 (after 18+19+20)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 18. Graph Bridge Runtime | v1.3 | 0/3 | Not started | — |
| 19. Todo Auto-Resolution | v1.3 | 0/3 | Not started | — |
| 20. Pre-LLM Safety Screening | v1.3 | 0/3 | Not started | — |
| 21. Credential Rotation | v1.3 | 0/3 | Not started | — |

<details>
<summary>✅ v1.2 Two-Sided Agent MVP (Phases 08-17) — SHIPPED 2026-05-19</summary>

178 commits, +71,340 net LOC, 16/17 phases fully shipped (Phase 14 code-shipped + runtime-blocked → resolved in v1.3 Phase 18). See `.planning/milestones/v1.2-two-sided-agent-mvp/` for full archive.

</details>

<details>
<summary>✅ v1.1 Seamless Waitlist (Phase 07) — SHIPPED 2026-05-15</summary>

Students sign in with LinkedIn, land on QR/SMS pairing, verify with 8-char code, follow-up texts route to thread. Durable handoff placeholders for Cognee + Sprite/Bright Data. See `.planning/milestones/v1.1-seamless-waitlist/` for archive.

</details>

<details>
<summary>✅ v1.0 Waitlist Foundation (Phases 01-06) — SHIPPED 2026-05-09</summary>

Marketing site + LinkedIn Clerk auth + Neon schema + Photon/Spectrum SMS + welcome message + LinkedIn ingestion + ops health. See `.planning/milestones/v1.0-waitlist-app/` for archive.

</details>

---

**Next Steps:**
1. `/rrr:execute-phase 19` — Execute Phase 19 (Todo Auto-Resolution) after Phase 18 is complete
2. `/rrr:plan-phase 18` — Build the execution plan for Phase 18 (Graph Bridge Runtime) if not yet done
