---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "human_needed"
last_activity: "2026-05-26 (Phase 23 verified — status: human_needed; 1/5 code_verified, 4/5 deferred to one ~90-min operator window)"
---

# team-workspace Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode.

## Assignment

GitHub team: @PA-MATRIX/team-workspace
Branch: rrr/v1.4/team-workspace-23
Sprite: rrr-internjobs-marketing-website-v1-4-team-workspace
Phases: 23 (active), 25, 26, 27 (queued)

## Current Position

Status: human_needed — Phase 23 verified 2026-05-26. 1/5 success criteria code_verified (SC-1 closeTodoFact); 4/5 deferred to operator (SC-2 Lakera email, SC-3 attachment download, SC-4 AgentPanel UAT, SC-5 MCPPanel UAT) — all behind the same single ~90-min deploy window. No code gaps found by rrr-verifier.
Current phase: 23 (Workspace Pilot Closeouts) — verification report: `.planning/milestones/v1.4-pilot-readiness/phases/23-workspace-pilot-closeouts/23-VERIFICATION.md` (223 lines, status: human_needed)
Current plan: All 4 Phase 23 plans closed; phase rollup ready for `/rrr:submit-phase 23 --team team-workspace`
Blockers: None for code work. All four deferred live-verify halves consolidated under ONE shared operator deploy window — see Open Items below.

## Phase 23 Plan Status

| Plan | Objective | Wave | Status |
|------|-----------|------|--------|
| 23-01 | closeTodoFact Cypher helper + reply path integration | 1 | **complete** (1b0b509 + d6681d7; deploy + smoke PASS 2026-05-26) |
| 23-02 | SAFETY-VERIFY-LIVE-04 — email injection test | 1 | **code-complete / live-verify-deferred** (c7973ca + 9ec84db + 3be2e53 — 2026-05-26) |
| 23-03 | Attachment download route + EmailPanel wire-up | 1 | **code-complete / browser-verify-deferred** (f00e388 + cff5234 + 1345769 — 2026-05-26) |
| 23-04 | 14-step authenticated agent-lift UAT | 1 | **template-complete / walkthrough-deferred** (5e7ca08 + 36bd3f1 — 2026-05-26) |

All 4 plans are Wave 1 — fully parallel (no file overlap between plans). All 4 closed in isolation. 23-04 shipped only its result-template file (`apps/parrot/test/agent-uat-results.md`, 164 lines) with no code changes — operator walkthrough deferred to the same window as 23-02 + 23-03.

## Open Items (operator follow-up)

ALL THREE deferred plans (23-02, 23-03, 23-04) share the SAME operator-credential
blocker — a single ~90-minute deploy + verify session unblocks all three live-
verify halves at once. Consolidating reduces operator ops cost from three
sessions to one.

- **23-02 SAFETY-VERIFY-LIVE-04 live evidence — pending operator with prod CF deploy access.** Code-side shipped (`source_id` field on email-path safety_events rows). Live test (4 emails + SQL row verify + Sent-folder check) blocked on operator steps below.

- **23-03 ATTACH-DOWN browser verify pending (Chrome + Safari, deployed Worker).** Code-side shipped (handleAttachmentDownload route + EmailAttachmentList chip wire). Live test (Chrome click → download, Safari click → download, curl 403 non-owner, curl 404 missing attachmentId) blocked on the SAME operator steps. Deferral consolidated with 23-02.

- **23-04 AGENT-UAT-01..03 walkthrough pending (14 browser steps + 3x3 latency grid + 11-tool MCPPanel checklist).** Template-side shipped (`apps/parrot/test/agent-uat-results.md`, 164 lines — full runbook with sign-off blocks + curl recipes + common-blocker triage). Live walkthrough (fresh Clerk OTP incognito session → 14 steps → record results) blocked on the SAME operator steps. Deferral consolidated with 23-02 + 23-03.

**Shared operator runbook (unblocks 23-02, 23-03, AND 23-04 in one session):**
  1. Rotate `CLOUDFLARE_BROAD_API_TOKEN` in Infisical at `/internjobs-ai/CLOUDFLARE_BROAD_API_TOKEN` — current value is rejected by Cloudflare `/user/tokens/verify` as invalid (`code:1000`). Scopes for replacement: Workers Scripts:Edit + KV:Edit + R2:Edit + Account Settings:Read + Zone Workers Routes:Edit on internjobs.ai.
  2. Run `cd apps/parrot && npm run deploy` with the rotated token.
  3. Open fresh incognito browser → sign in to workspace.internjobs.ai via phone-OTP.
  4. Run the 23-02 test set (`apps/parrot/test/safety-email-verify.md` "What remains").
  5. Run the 23-03 test set (`apps/parrot/test/attachment-download-verify.md` "What remains").
  6. Run the 23-04 UAT walkthrough (`apps/parrot/test/agent-uat-results.md` "Operator UAT Runbook").
  7. Append results to all three evidence files; flip each Status field from `DEFERRED` to `PASSED`/`FAILED`/`PARTIAL`.

## 23-01 Decisions Captured

- RFC-5322 threadId (from buildReferencesChain) is NOT the :Todo key — `c.req.param('id')` (DO-internal UUID) is what recordTodoFact stored as source_id. Documented inline in reply-forward.ts.
- ACK regex intentionally loose (`got it / fixed / done / sent / shipped`, case-insensitive). False positives acceptable; false negatives not.
- closeTodoFact is fail-soft (returns null on any error). The reply 202 must succeed even when the graph layer is down — graph state is best-effort.
- graph-api Cypher uses `SET t.valid_to = timestamp()` (no datetime() / duration() — FalkorDB doesn't implement those openCypher temporal functions). The 5-minute grace window is enforced cron-side.
- Worker deploy (`cd apps/parrot && wrangler deploy`) deferred to coordinator integration — graph-api side ships standalone and is live.

## Key Context

- Naming: code says `parrot`, narrative says `Workspace`. Both used consistently.
- FalkorDB writes go through infra/graph-api Fly proxy (never direct from Worker).
- closeTodoFact: new POST /close-todo endpoint on graph-api + new closeTodoFact() in graph.ts.
- Safety email path: binary-flag parser (flagged===true || score>=0.8) already fixed in 22-01.
  23-02 verifies it live on the email path + adds source_id to safety_events payload.
- Attachment R2 key convention: attachments/{clerk_user_id}/{messageId}/{attachmentId}/{filename}
- PARROT_AGENT_TOOLS (11 tools) vs startup-MCP (4 tools at mcp.internjobs.ai) — completely
  separate servers. 23-04 tests the internal Workspace tools ONLY.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".

Phase 22 (Lakera v2 parser fix) shipped 2026-05-24 and is a hard dependency for
Phase 23's SAFETY-VERIFY-LIVE-04. Confirmed unblocked per STATE.md "Blockers: None".
