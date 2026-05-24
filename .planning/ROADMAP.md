# Roadmap: InternJobs.ai

## Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 01–06 (shipped 2026-05-09)
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 07 (shipped 2026-05-15)
- ✅ **v1.2 Two-Sided Agent MVP** — Phases 08–17 (shipped 2026-05-19)
- ✅ **v1.3 Pilot Hardening** — Phases 18–20 shipped; Phase 21 skipped (sole-user deferral). Plus un-roadmapped Neon-exit shipped 2026-05-21.
- 🚧 **v1.4 Pilot Readiness** — Phases 22–27 (first team-mode milestone: `team-cms` + `team-workspace`)

## Overview

v1.4 closes v1.3's dangling work (closeTodoFact writer, Lakera live verification, attachment download, agent-lift UAT) and the un-roadmapped initiatives that landed after v1.3 ship-ready (Neon-exit verification + doc refresh). It also lights up the Workspace upgrades from the v1.3 backlog memo (Mattermost SSO, knowledge-graph reuse, admin invite UX, GenZ chat polish) and lays a Worker-side test floor. The milestone is split across two GitHub teams: `team-cms` (Marketing CMS + Student app) and `team-workspace` (Workspace + Mattermost + graph-api). Phase order serializes cross-team dependencies (Phase 23 needs Phase 22's Lakera schema verification) but otherwise the teams run in parallel on their own branches.

## Phases

**Phase Numbering:**
- Integer phases (22-27): Planned v1.4 work
- Decimal phases (e.g., 22.1): Reserved for urgent insertions during execution

- [ ] **Phase 22: Lakera Production Verification** — *team-cms*. Verify Lakera (Cisco AI Defense) v2 schema in production + run 3 student-SMS-path safety tests live
- [ ] **Phase 23: Workspace Pilot Closeouts** — *team-workspace*. closeTodoFact writer + Workspace email Lakera test + attachment download + agent-lift authenticated UAT
- [ ] **Phase 24: Neon-Exit Closeout** — *team-cms*. End-to-end verification of new student-app `/internal/safety-events` API + planning doc refresh
- [ ] **Phase 25: SSO Activation + Admin UX** — *team-workspace*. Mattermost OIDC SSO activation + frontend admin page with capability toggles + orphan Neon dep cleanup
- [ ] **Phase 26: Knowledge Graph + GenZ Polish** — *team-workspace*. FalkorDB `:Employee` namespace reuse for Workspace agent + Mattermost GIF picker + canvas-confetti micro-animations
- [ ] **Phase 27: Polish + Test Floor** — *team-workspace*. Daily.co theme retry + star-toggle API + `formatQuotedDate` cleanup + Vitest smoke tests for Workspace Worker routes

## Phase Details

### Phase 22: Lakera Production Verification

**Goal**: Make Lakera Guard pre-LLM safety screening actually functional end-to-end on the student SMS path. v1.3 shipped the code; v1.4 verifies it works in production against the post-Cisco-acquisition API.

**Team owner**: `team-cms`
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Nothing (first phase of v1.4)

**Requirements**: LAKERA-V2-01, LAKERA-V2-02, LAKERA-V2-03, SAFETY-VERIFY-LIVE-01, SAFETY-VERIFY-LIVE-02, SAFETY-VERIFY-LIVE-03

**Success Criteria** (what must be TRUE):
1. Live injection-test student SMS is hard-blocked, student receives the exact canned reply, `safety_events` row written with `action='blocked'`
2. Live benign student SMS produces zero `safety_events` log entries and the agent replies normally
3. Simulated Lakera 5xx produces a `passed_lakera_unavailable` row and the message proceeds (fail-open verified)
4. Lakera (Cisco AI Defense) v2 endpoint URL + response schema verified at `platform.lakera.ai`; parser blocks in `screen.mjs` + `safety.ts` match production reality
5. Pricing tier confirmed sufficient for 30k/month pilot volume (Community vs Pro decision documented)

**Plans**: TBD (likely 2 — schema-verify + run-3-tests)

Plans:
- [ ] 22-01: Lakera v2 schema verification + parser-block updates if needed (LAKERA-V2-01..03)
- [ ] 22-02: 3 production-path SAFETY-VERIFY-LIVE tests against student SMS (SAFETY-VERIFY-LIVE-01..03)

**Research flags**: Unlikely (Lakera docs available; reuses existing helpers)

---

### Phase 23: Workspace Pilot Closeouts

**Goal**: Close the v1.3-shipped-but-incomplete Workspace items so Workspace is functionally pilot-ready. Includes the missing `closeTodoFact` writer (without which Phase 19's auto-clear cron is inert), the Workspace-side Lakera test, the attachment download endpoint, and the agent-lift UAT.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 22 (SAFETY-VERIFY-LIVE-04 needs the v2 Lakera schema verified first)

**Requirements**: CLOSETODO-01, CLOSETODO-02, CLOSETODO-03, CLOSETODO-04, SAFETY-VERIFY-LIVE-04, ATTACH-DOWN-01, ATTACH-DOWN-02, ATTACH-DOWN-03, AGENT-UAT-01, AGENT-UAT-02, AGENT-UAT-03

**Success Criteria** (what must be TRUE):
1. Agent reply containing resolution-acknowledgement phrase writes `:Todo.valid_to` in FalkorDB; next auto-clear tick closes the linked SQLite todo within 30s; todo appears in Resolved view
2. Injection email from a non-startup_members sender is silently hard-blocked; `safety_events` row written with no auto-reply
3. Clicking an attachment in Workspace inbox downloads the file in Chrome + Safari (no 404)
4. AgentPanel quick actions (summarize, draft, translate) return live LLM results in production within 10s
5. MCPPanel lists all 11 MCP tools and tool calls return non-error responses

**Plans**: TBD (likely 4)

Plans:
- [ ] 23-01: `closeTodoFact` Cypher helper + Workspace reply-path integration + structured logging (CLOSETODO-01..04)
- [ ] 23-02: SAFETY-VERIFY-LIVE-04 — Workspace email injection test
- [ ] 23-03: Attachment download route + auth + EmailPanel wire-up (ATTACH-DOWN-01..03)
- [ ] 23-04: 14-step authenticated UAT for agent-lift features (AGENT-UAT-01..03)

**Research flags**: Unlikely (all reuses existing infrastructure)

---

### Phase 24: Neon-Exit Closeout

**Goal**: Verify the Neon-exit migration (shipped 2026-05-21 un-roadmapped) is correct end-to-end through the new student-app `/internal/safety-events` API, then refresh planning docs that still describe the old Neon topology.

**Team owner**: `team-cms` (owns student-app API + coordinator role for docs)
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Nothing — code is already shipped, this verifies + documents

**Requirements**: NEONEX-VER-01, NEONEX-VER-02, NEONEX-VER-03, NEONEX-VER-04, NEONEX-DOC-01, NEONEX-DOC-02, NEONEX-DOC-03

**Success Criteria** (what must be TRUE):
1. Live Lakera-blocked inbound triggers successful POST from Workspace Worker to student-app `/internal/safety-events` with valid Bearer auth
2. `/ops/safety` in Workspace renders the resulting row by reading through the new API
3. Bearer secret mismatch returns 401; student app logs the failed attempt without crashing
4. Unreviewed-count badge in Workspace updates correctly via `/internal/safety-events/unreviewed-count`
5. `HANDOFF.md §4`, `ROADMAP.md`, and `infisical-project` memory all reflect the post-migration topology

**Plans**: TBD (likely 2)

Plans:
- [ ] 24-01: End-to-end safety_events API verification + negative tests (NEONEX-VER-01..04)
- [ ] 24-02: Docs refresh — HANDOFF.md, ROADMAP.md note, infisical-project memory (NEONEX-DOC-01..03)

**Research flags**: Unlikely (verification work; no new tech)

---

### Phase 25: SSO Activation + Admin UX

**Goal**: Activate Mattermost OIDC SSO so chat is single-sign-on for employees (code already shipped in v1.2; this is the mmctl config step), and complete the admin invite UX so Ridhi can invite + manage employee capabilities through the frontend (not just the API). Folds in the orphan `@neondatabase/serverless` dep cleanup from Neon-exit since team-workspace is the only team that touches `apps/parrot/package.json`.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 23 (sequential on team-workspace branch)

**Requirements**: MMSSO-01, MMSSO-02, MMSSO-03, ADMIN-UX-01, ADMIN-UX-02, ADMIN-UX-03, ADMIN-UX-04, NEONEX-DEP-01

**Success Criteria** (what must be TRUE):
1. User signing into `chat.internjobs.ai` clicks "GitLab" button → bounces through Workspace OIDC → lands signed in to Mattermost in <5s
2. New employee (invited via admin UX) auto-provisions a Mattermost user on first OIDC sign-in
3. Ridhi can open `/admin`, see employees with capability toggles (email/chat/meetings/phone/sms/campaigns), and edit them post-invite
4. Invite form creates Clerk phone-OTP user + CF Email Routing rule + WorkspaceDO row + sends personalized welcome email from Ridhi
5. `@neondatabase/serverless` removed from `apps/parrot/package.json`; `npm run build` still passes

**Plans**: TBD (likely 3)

Plans:
- [ ] 25-01: Mattermost SSO mmctl activation + first-login Mattermost user auto-provisioning (MMSSO-01..03)
- [ ] 25-02: `/admin` frontend page + capability-toggle UI + invite form (ADMIN-UX-01..04)
- [ ] 25-03: Drop orphan `@neondatabase/serverless` from Workspace package.json (NEONEX-DEP-01)

**Research flags**: Unlikely (Mattermost OIDC docs known; admin backend exists)

---

### Phase 26: Knowledge Graph + GenZ Polish

**Goal**: Lift Workspace agent extraction quality by reusing the existing FalkorDB instance for cross-conversation `:Employee` context (mirroring the student app's `getStudentSummary` pattern — unblocked by v1.3 Phase 18 making the graph reachable from Workspace). Add GenZ-friendly chat polish (Mattermost GIF picker + canvas-confetti) for the HS/college-intern audience.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 25 (sequential on team-workspace branch)

**Requirements**: KGRAPH-01, KGRAPH-02, KGRAPH-03, KGRAPH-04, KGRAPH-05, GENZ-01, GENZ-02, GENZ-03

**Success Criteria** (what must be TRUE):
1. Workspace agent extraction reads `getEmployeeContext` from the `:Employee` namespace and prepends it to the kimi extraction prompt
2. Post-extraction fire-and-forget writes new `:Todo` + `:MENTIONS` + `:BLOCKED_BY` edges into the `:Employee` namespace
3. Cross-namespace isolation verified — `:Employee` queries return zero `:Student` nodes and vice versa
4. Qualitative A/B comparison on 10 real extractions shows reduced duplicate-todo rate
5. Mattermost GIF/sticker plugin live and reachable from chat composer; first-todo-cleared + 5-emails-responded confetti animations fire; parrot-mascot loading state replaces generic spinner

**Plans**: TBD (likely 2)

Plans:
- [ ] 26-01: `getEmployeeContext` + write-back + cross-namespace isolation + A/B comparison (KGRAPH-01..05)
- [ ] 26-02: Mattermost GIF plugin + canvas-confetti + parrot-mascot loading (GENZ-01..03)

**Research flags**: Likely (KGRAPH-01..03 — verify FalkorDB Cypher patterns for namespace isolation; reuse student app's `getStudentSummary` as template)

---

### Phase 27: Polish + Test Floor

**Goal**: Land the small UX/quality items deferred from v1.3 (Daily.co theme retry, star-toggle API) and establish a Vitest smoke-test baseline for Workspace Worker so future regressions are caught at PR time. Includes the cross-app `formatQuotedDate` cleanup that touches both `apps/agentic-inbox/` and `apps/parrot/` (both team-workspace-owned).

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 26 (sequential on team-workspace branch)

**Requirements**: DAILY-THEME-01, STAR-API-01, DATES-01, WSTEST-01, WSTEST-02, WSTEST-03

**Success Criteria** (what must be TRUE):
1. Daily.co Prebuilt themed with Campus Aurora palette (accent `#7C3AED`, bg `#FAFAFA`); verified in `/meetings` iframe
2. Star toggle in EmailPanel persists state via `PATCH /api/inbox/messages/:id`; UI reflects the change
3. `formatQuotedDate` callers in `apps/agentic-inbox/` + `apps/parrot/` use `packages/shared/src/dates`; 3 `@deprecated` re-exports deleted
4. `npm test` in `apps/parrot/` runs Vitest smoke tests covering `/healthz` and each route file; all pass
5. `apps/parrot/README.md` documents how to run tests locally; ideally wired into a GitHub Action on the team branch

**Plans**: TBD (likely 2)

Plans:
- [ ] 27-01: Daily.co theme + star API + dates cleanup (DAILY-THEME-01, STAR-API-01, DATES-01)
- [ ] 27-02: Vitest harness + route smoke tests + README + optional CI wiring (WSTEST-01..03)

**Research flags**: Unlikely (all reuses known patterns)

---

## Progress

**Execution Order (team-aware):**

- `team-cms`: Phase 22 → Phase 24 (sequential on `rrr/v1.4/team-cms`)
- `team-workspace`: Phase 23 → Phase 25 → Phase 26 → Phase 27 (sequential on `rrr/v1.4/team-workspace`)

**Cross-team dependency:** Phase 23 cannot start until Phase 22 is verified (SAFETY-VERIFY-LIVE-04 depends on LAKERA-V2-02 parser truth). Otherwise teams run in parallel.

| Phase | Milestone | Owner | Plans Complete | Status | Completed |
|-------|-----------|-------|----------------|--------|-----------|
| 22. Lakera Production Verification | v1.4 | team-cms | 0/TBD | Not started | — |
| 23. Workspace Pilot Closeouts | v1.4 | team-workspace | 0/TBD | Not started | — |
| 24. Neon-Exit Closeout | v1.4 | team-cms | 0/TBD | Not started | — |
| 25. SSO Activation + Admin UX | v1.4 | team-workspace | 0/TBD | Not started | — |
| 26. Knowledge Graph + GenZ Polish | v1.4 | team-workspace | 0/TBD | Not started | — |
| 27. Polish + Test Floor | v1.4 | team-workspace | 0/TBD | Not started | — |

<details>
<summary>✅ v1.3 Pilot Hardening (Phases 18-21) — SHIPPED partial 2026-05-19</summary>

3 of 4 planned phases shipped; Phase 21 skipped (sole-user deferral). Plus un-roadmapped Neon-exit shipped 2026-05-21 (Mattermost + student DB → self-hosted Fly Postgres; all 3 Neon projects deleted). See `.planning/milestones/v1.3-pilot-hardening/SHIP-READY.md` and `infra/NEON-EXIT.md` for ship details.

- [x] **Phase 18: Graph Bridge Runtime** — Fly REST proxy + Workspace Worker rewire (commits be38369, 3449299, 1664d67, 1d13b1d)
- [x] **Phase 19: Todo Auto-Resolution** — cron infra + Resolved view + Undo (commits 6415650, 218d879, d03ff15, cdbc8ab). **Caveat:** cron inert until v1.4 CLOSETODO-01 writer ships.
- [x] **Phase 20: Pre-LLM Safety Screening** — Lakera helpers + insertion + `safety_events` table + `/ops/safety` (commits fd24477, 6f33854, 30ca491, 98cea02). **Caveat:** verification carried into v1.4 Phase 22.
- [ ] **Phase 21: Credential Rotation** — SKIPPED (sole-user). Reopens in v1.5 when first pilot user identifiable.

**Plus un-roadmapped Neon-exit (2026-05-21):** internjobs has zero Neon dependency. New Fly apps `internjobs-mattermost-db` + `internjobs-student-db`. Verification carried into v1.4 Phase 24.

</details>

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

Marketing site + LinkedIn Clerk auth + Postgres schema + Photon/Spectrum SMS + welcome message + LinkedIn ingestion + ops health. See `.planning/milestones/v1.0-waitlist-app/` for archive.

</details>

---

## v1.5 Candidates (deferred polish + reopens)

- **SEC-ROTATE-ALL** — Reopens from v1.3 Phase 21 when first pilot user is identifiable. RUNBOOK preserved.
- **DAILY-VANITY-01** — Custom Daily.co subdomain `meet.internjobs.ai`. Scale-plan upgrade gate.
- **AGENTIC-INBOX-TESTS** — Test coverage for `apps/agentic-inbox/workers/` (zero `.test.ts` files today).
- **INTEG-01-PROD-RUN** — Two-sided 11-step smoke executed in production by a human operator (never run since v1.2).
- **SAFETY-OUTBOUND-01** — Lakera Guard on agent outbound messages (gate: first pilot reputational-harm report).
- **SAFETY-HARD-BLOCK-EXPAND-01** — Convert student SMS soft-flag → hard-block once 30 days of pilot FP data exists.
- **MAC-BRIDGE-ALERTING** — Monitor BlueBubbles + tunnel health.
- **WORKERS-VPC-REVISIT** — Retire `internjobs-graph-api` Fly proxy if Workers VPC GA with viable pricing.
- **KGRAPH-METRICS** — Quantitative metric on duplicate-todo-rate reduction (qualitative pass in v1.4).
- **PARROT-NAME-AUDIT** — Decide whether to rename `apps/parrot/` → `apps/workspace/` (cosmetic).

---

**Next Steps:**
1. (Optional) `/rrr:assign-phases` — formalize team assignments per phase in `.planning/team-mode.json`
2. `/rrr:plan-phase 22` — Build the execution plan for Phase 22 (Lakera Production Verification) — *team-cms*
3. In parallel: `/rrr:dispatch-team --team team-workspace` to prep the Workspace branch
4. Optionally `/rrr:discuss-phase 22` first to surface implementation context
