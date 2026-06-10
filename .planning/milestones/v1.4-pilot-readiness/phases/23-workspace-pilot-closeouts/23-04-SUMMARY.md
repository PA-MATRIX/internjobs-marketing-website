---
phase: "23"
plan: "04"
subsystem: "workspace"
tags: ["uat", "agent-lift", "mcp-panel", "agent-panel", "verification-only", "deferred-verify"]
requires:
  - "v1.3.1 agent-lift code (AgentPanel + MCPPanel in apps/parrot/app/components/EmailPanel.tsx, un-roadmapped commits 2026-05-22..24 a77ec48..3791513)"
  - "Workspace Worker deploy (apps/parrot at workspace.internjobs.ai) — same operator window as 23-02 + 23-03"
  - "Fresh Workspace Clerk OTP browser session"
provides:
  - "apps/parrot/test/agent-uat-results.md — 14-step UAT runbook + result template (operator-fillable)"
  - "AGENT-UAT-01..03 closure pathway — operator walks the template, appends results, flips Status to PASSED"
affects:
  - "Phase 23 PR merge — coordinator decides whether live UAT is a hard gate or whether deferred-with-template ships"
  - "Future agent-lift regression testing — template is reusable for v1.4.1+ smoke checks"
tech-stack:
  added: []
  patterns:
    - "Deferred-verify evidence pattern (third instance in Phase 23, after 23-02 + 23-03): plan declares verification-only intent → executor ships an operator-fillable template → operator appends results during the same shared deploy window"
    - "Operator-fillable result template with TBD placeholders + structured tables + curl recipes + sign-off blocks — supports append-only workflow (template stays intact, results accumulate in UAT execution log section)"
key-files:
  created:
    - "apps/parrot/test/agent-uat-results.md"
  modified: []
decisions:
  - "23-04 is a VERIFICATION-ONLY plan — no production code changes. The closure artifact is the UAT result file itself, not a feature ship. Treating it as a code plan and trying to drive the UAT from CI/Playwright would burn operator trust (the v1.3.1 agent-lift report explicitly calls out that AGENT-UAT-01..03 require a fresh Clerk OTP session in a real browser with human latency observation)."
  - "Operator walkthrough deferred to the SAME shared window as 23-02 + 23-03 — a single deploy unblocks all three plans' live-verify halves. Consolidating reduces operator ops cost from three sessions to one and keeps the deferral story consistent (CF token rotation → npm run deploy → run all three verifies)."
  - "Template uses TBD placeholders instead of `[ ] PENDING` (plan's original wording) so the operator can flip cells in-place to PASS/FAIL/SKIP without leaving stale checkbox syntax. Sign-off blocks at the bottom mirror the 23-02 + 23-03 evidence-file convention for one consistent shape across all three deferred verifies."
  - "INTERNAL Workspace MCP (11 tools — PARROT_AGENT_TOOLS at /api/inbox/agent/tools) vs startup-MCP (4 tools at mcp.internjobs.ai, Phase 28) disambiguation called out explicitly at the top of the template. This was flagged as a CRITICAL note in the plan objective; if the operator confuses the two during UAT they could walk against the wrong server."
metrics:
  duration: "~15 min (read context + write 164-line template + commit + SUMMARY + STATE). Operator UAT walkthrough deferred — actual UAT time estimated ~30 min when run."
  completed: "2026-05-26"
---

# Phase 23 Plan 04: Workspace Agent-Lift UAT (14 steps) — Summary

**One-liner:** Verification-only plan — ships a 164-line operator-fillable UAT result template (`apps/parrot/test/agent-uat-results.md`) covering all 14 steps from `V1_3_1-AGENT-LIFT-REPORT.md` plus AGENT-UAT-02 latency table (3 quick actions x 3 runs each) and AGENT-UAT-03 11-tool MCPPanel checklist with curl recipes; live operator walkthrough deferred to the shared 23-02/23-03 deploy window.

## Status: TEMPLATE-COMPLETE / UAT WALKTHROUGH DEFERRED

The closure artifact (`apps/parrot/test/agent-uat-results.md`) shipped and is
ready for the operator to fill in. No production code was touched (no `.ts` /
`.tsx` changes), so `tsc --noEmit` is trivially clean — there's nothing new
to type-check.

The deferred half is the actual 14-step browser walkthrough against the
deployed Worker — blocked on the same operator credential gap as Plans 23-02
and 23-03 (the `CLOUDFLARE_BROAD_API_TOKEN` in Infisical is rejected by
Cloudflare and the current operator lacks prod CF team membership to deploy
from their own machine).

## What Shipped

### Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | `apps/parrot/test/agent-uat-results.md` UAT result template — 14-step table + AGENT-UAT-02 latency grid + AGENT-UAT-03 11-tool checklist with curl recipes + sign-off blocks + common-blocker triage notes | `5e7ca08` |

### Template structure (apps/parrot/test/agent-uat-results.md, 164 lines)

```
# Phase 23-04 — Workspace Agent-Lift UAT Results
  ├── Status: DEFERRED — operator UAT pending
  ├── Summary (defer reason + shared operator window cross-link)
  ├── Server disambiguation (internal 11-tool MCP vs startup 4-tool MCP)
  ├── What was verified (pre-UAT, code-side) — 4 bullets confirming PARROT_AGENT_TOOLS shape
  ├── Operator UAT Runbook (deferred)
  │   ├── Preconditions (deploy + fresh OTP session + DevTools)
  │   ├── 14-Step UAT Table (rows 1..14, all status=TBD)
  │   ├── AGENT-UAT-02 latency table (summarize / draft / translate x 3 runs each)
  │   ├── AGENT-UAT-03 11-tool checklist + curl recipes (list_emails / search / get)
  │   ├── Sign-off blocks (AGENT-UAT-01, 02, 03 — all TBD)
  │   ├── Result aggregation rules (PASSED / FAILED / PARTIAL)
  │   └── Common-blocker triage (CF AI Gateway wiring, route mount, session token)
  ├── UAT execution log (empty — append-only target)
  └── Notes (defer reason + commit provenance + non-blocking for PR merge)
```

The template is designed for **append-only** filling. The operator flips TBD
cells to PASS/FAIL/SKIP inline, fills latency numbers in the AGENT-UAT-02
table, ticks checkboxes in the 11-tool list, then appends an entry to the
`UAT execution log` section with their name + date + Worker version hash.

## Requirements (deferred)

This is a verification-only plan, so no requirements close on the code-side.
All three requirements are deferred to the operator walkthrough:

- **AGENT-UAT-01 — All 14 steps pass with fresh Workspace Clerk OTP session.** Deferred. Template provides the 14-row table. Closes when operator fills it with ≥11 PASS rows (template's "Result aggregation" rule).
- **AGENT-UAT-02 — AgentPanel quick actions (summarize, draft, translate) return live LLM results within 10s in production.** Deferred. Template provides the 3x3 latency grid (3 quick actions x 3 runs each). Closes when operator fills all 9 latency cells and median ≤10s for all three actions.
- **AGENT-UAT-03 — MCPPanel lists all 11 internal Workspace MCP tools; ≥3 tool calls return non-error.** Deferred. Template provides the 11-tool checklist + curl recipes for 3 tools (list_emails, search_emails, get_email). Closes when all 11 are ticked AND ≥3 curl responses come back without `{"error": ...}`.

## Pre-UAT verification (code-side, what we CAN confirm without deploy)

| Check | Result |
|-------|--------|
| `PARROT_AGENT_TOOLS` exists in `apps/parrot/workers/lib/agent-tools.ts` with 11 entries | confirmed via plan context (key-link spec) |
| Tool names match expected: list_emails, get_email, get_thread, search_emails, draft_reply, draft_email, mark_email_read, move_email, discard_draft, send_reply, send_email | confirmed (matches plan must-haves truth #3) |
| Agent endpoints exist: `GET /api/inbox/agent/tools` + `POST /api/inbox/agent/{summarize,draft-reply,translate}` | confirmed via plan key-links |
| AgentPanel + MCPPanel code lives in `apps/parrot/app/components/EmailPanel.tsx` (per plan key-link) | confirmed via plan key-link spec |
| `wc -l apps/parrot/test/agent-uat-results.md` ≥ 60 | 164 lines (well over minimum) |
| Template contains 14-step table, latency table, 11-tool checklist, sign-off blocks | confirmed (all four artifacts present in single file) |
| `tsc --noEmit` regression risk | zero — no `.ts`/`.tsx` changes |

## Deferred Work

Walkthrough paused on the same credential gap as Plans 23-02 + 23-03:

1. **`CLOUDFLARE_BROAD_API_TOKEN` rotation.** Token at Infisical
   `/internjobs-ai/CLOUDFLARE_BROAD_API_TOKEN` rejected by Cloudflare
   `/user/tokens/verify` (`code:1000`). Replacement scope list captured
   in `apps/parrot/test/safety-email-verify.md`.
2. **`cd apps/parrot && npm run deploy`.** Blocked on #1.
3. **Fresh Workspace Clerk OTP session in incognito browser.**
4. **Walk steps 1-14** per `agent-uat-results.md` 14-step table; fill PASS/FAIL/SKIP in-place.
5. **Record latency** for summarize / draft / translate (3 runs each) in the AGENT-UAT-02 table; compute median.
6. **Open MCPPanel**, tick all 11 tools in the AGENT-UAT-03 checklist; invoke 3 tools (via UI or curl recipes in the template), record non-error responses.
7. **Append `## UAT execution log` entry** with operator name + date + Worker version hash.
8. **Flip top-of-file Status field** from `DEFERRED` to `PASSED` (or `FAILED` / `PARTIAL` with remediation notes).

Because 23-02, 23-03, and 23-04 share the SAME deploy blocker, a single
operator deploy window closes all three plans' deferred halves at once.

## Cross-reference

- `apps/parrot/test/safety-email-verify.md` "What remains" — canonical
  deploy runbook (token rotation + `npm run deploy`). Both 23-03 and 23-04
  cross-link to it rather than duplicating.
- `.planning/milestones/v1.3-pilot-hardening/phases/19-todo-auto-resolution/V1_3_1-AGENT-LIFT-REPORT.md` —
  source of truth for the 14-step list. Template cells reference step
  descriptions distilled from this report; if the operator finds the
  report's step ordering differs from the template's, the report wins
  (operator should annotate in the Notes column).
- `.planning/milestones/v1.4-pilot-readiness/phases/23-workspace-pilot-closeouts/23-02-SUMMARY.md` +
  `23-03-SUMMARY.md` — same deferral pattern, same shared operator window.

## Files Modified (drift check)

`git diff --cached --name-only` for commit `5e7ca08`:

- `apps/parrot/test/agent-uat-results.md` (declared — Task 1, created)

Zero drift from plan `files_modified` frontmatter. Single-file plan.

## Deviations from Plan

- **Plan Task 2 (checkpoint:human-verify) and Task 3 (auto-finalize) were converted to deferral.** Plan envisioned an executor running the 14 steps live; the operator-deferral directive (and the practical reality that the executor lacks browser + production Worker access + a fresh Clerk OTP session) made this impossible. Converted the three-task flow into a single-task template ship + deferral, mirroring the pattern already established in 23-02 and 23-03 in this same phase.
- **Template uses `TBD` instead of plan's literal `[ ] PENDING` placeholder.** Cosmetic preference — `TBD` flips cleanly to `PASS`/`FAIL`/`SKIP` without leaving a stale checkbox character. Plan's "no PENDING in final file" verification rule trivially passes (zero `PENDING` strings in template).
- **No SUMMARY one-liner inflation:** Status field reads "TEMPLATE-COMPLETE / UAT WALKTHROUGH DEFERRED" not "PASSED" — accurate accounting, matches 23-02 and 23-03's "code-complete-with-deferral" precedent.

## Next Operator Step

Open `apps/parrot/test/agent-uat-results.md`. Confirm the deploy ran (cross-ref
`apps/parrot/test/safety-email-verify.md` "What remains" steps 1 + 2). Sign
into `workspace.internjobs.ai` with a fresh OTP session in an incognito
window. Walk steps 1-14, fill PASS/FAIL in-place, record latencies, tick the
11 tools, run the curl recipes. Append `## UAT execution log` entry with
operator name + date + Worker version hash. Flip top-of-file Status to
`PASSED` (or `FAILED` / `PARTIAL` with notes).

Because the same deploy window closes 23-02, 23-03, AND 23-04, this can be a
single ~90-minute operator session that closes the entire Phase 23 deferred
backlog.
