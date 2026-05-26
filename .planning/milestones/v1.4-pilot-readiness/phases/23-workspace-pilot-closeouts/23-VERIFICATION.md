---
phase: 23-workspace-pilot-closeouts
team: team-workspace
status: human_needed
verified_at: 2026-05-26
goal: Workspace is functionally pilot-ready end-to-end
---

# Phase 23: Workspace Pilot Closeouts -- Verification Report

**Phase Goal:** Workspace is functionally pilot-ready end-to-end: agent reply triggers todo auto-clear, employee email path is Lakera-screened the same way the student SMS path is, attachments download, agent-lift UI features work in a live authenticated UAT.

**Branch:** rrr/v1.4/team-workspace-23 (16 commits ahead of main)
**Verified:** 2026-05-26
**Status:** human_needed -- all automated/structural checks PASS; 3 of 5 success criteria deferred to operator (no code gaps)
**Re-verification:** No -- initial verification

---

## Architectural Context Loaded

- .planning/workstreams/team-workspace/STATE.md -- team-workspace execution memory confirmed in-scope for modification; root .planning/STATE.md confirmed coordinator-only.
- git log main..HEAD -- .planning/STATE.md returned empty. Root STATE.md unmodified. COMPLIANT.
- git log main..HEAD -- .planning/team-mode.json returned empty. COMPLIANT.

---

## Success Criteria Classification

| # | Criterion | Classification | Evidence |
|---|-----------|----------------|----------|
| 1 | Agent reply sets :Todo.valid_to in FalkorDB; auto-clear cron closes SQLite todo within 10 min; Resolved view updated | code_verified | Full code chain confirmed; graph-api Fly deploy 2/2 healthy; Cypher smoke 3/3 PASS |
| 2 | Injection email from non-startup_members sender silently hard-blocked; safety_events row written; no auto-reply | deferred_to_operator | Code shipped (c7973ca); 4-email live test blocked on CF token rotation + Worker deploy |
| 3 | Clicking attachment in Workspace inbox downloads in Chrome + Safari (no 404) | deferred_to_operator | Code shipped (f00e388 + cff5234); browser click-test blocked on Worker deploy |
| 4 | AgentPanel quick actions return live LLM results in production within 10s | deferred_to_operator | UAT template shipped (agent-uat-results.md, 164 lines); walkthrough blocked on Worker deploy |
| 5 | MCPPanel lists all 11 internal Workspace MCP tools; tool calls return non-error | deferred_to_operator | UAT template shipped with 11-tool checklist + curl recipes; walkthrough blocked on Worker deploy |

---

## Plan-by-Plan Code Verification

### 23-01 -- closeTodoFact + Reply-Path Integration

**Checker-forced fix 1 -- DO UUID vs RFC-5322 (reply-forward.ts lines 186-190):**

The inline comment is present verbatim in the file:

    // IMPORTANT: Use id from c.req.param(id) -- that is the original email
    // DO-internal UUID (crypto.randomUUID()), which is what recordTodoFact
    // stored as :Todo.source_id. Do NOT use the RFC-5322 threadId from
    // buildReferencesChain -- that is a Message-ID header string and will
    // match zero :Todo nodes in FalkorDB.

closeTodoFact called with id = c.req.param(id) at reply-forward.ts line 199. CONFIRMED.

**10-minute timing correction:** 23-01-PLAN.md, 23-01-SUMMARY.md, and infra/graph-api/src/index.mjs line 176 all reference 10 minutes (5-min grace window + up to 5-min cron interval). No 30s references. CONFIRMED.

**Artifact verification:**

| Artifact | Exists | Lines | Key Symbol | Wired | Status |
|----------|--------|-------|------------|-------|--------|
| infra/graph-api/src/index.mjs | YES | 248 | POST /close-todo handler at line 182 | Live on Fly (2/2 healthy) | VERIFIED |
| apps/parrot/workers/lib/graph.ts | YES | 929 | export async function closeTodoFact at line 869 | Imported in reply-forward.ts:44 | VERIFIED |
| apps/parrot/workers/routes/reply-forward.ts | YES | 506 | ACK_PATTERN at line 54; waitUntil(closeTodoFact(...)) at lines 197-203 | Mounted in index.ts | VERIFIED |

**Key link verification:**

| From | To | Via | Status |
|------|----|-----|--------|
| reply-forward.ts:44 | lib/graph.ts | import { closeTodoFact } | WIRED |
| reply-forward.ts:197-203 | closeTodoFact call | c.executionCtx.waitUntil(closeTodoFact(...)) on ACK match | WIRED |
| graph.ts:877 | graph-api /close-todo | fetch(GRAPH_API_URL + /close-todo) with Bearer | WIRED |
| graph-api:205-210 | FalkorDB :Todo | SET t.valid_to = timestamp() parameterized Cypher | WIRED |

**Structured log:** event: todo_fact_closed at graph.ts line 908. CONFIRMED.

**Live smoke evidence (from 23-01-SUMMARY.md, 3/3 PASS):**

| Probe | Result |
|-------|--------|
| GET /health regression | HTTP 200 |
| POST /close-todo no Bearer | HTTP 401 |
| POST /close-todo Bearer + valid body, non-existent thread | HTTP 200 {ok:true,closed_count:0} |
| POST /close-todo Bearer + missing employee_id | HTTP 400 {error:thread_id_and_employee_id_required} |

**SC-1: code_verified** -- graph-api deployed and smoking; full code chain verified at all four levels. End-to-end SQLite close-out (cron tick -> Resolved view) exercises implicitly during the operator UAT session.

---

### 23-02 -- Lakera v2 on Workspace Email Safety Path

**Code change (apps/parrot/workers/lib/inbound-email.ts line 273):**

    source_id: originalMessageId ?? messageId,

Confirmed present. Comment at lines 270-272 documents the RFC-5322/UUID fallback rationale. Hard-block gate at line 228 (flagged === true || injectionScore >= 0.8) unchanged from Phase 22-01. No auto-reply on hard-block branch (SAFETY-RESPONSE-02 confirmed). safety.ts not modified in this phase.

**Deferred evidence file:** apps/parrot/test/safety-email-verify.md exists with full operator runbook. CONFIRMED.

**Deferral blocker:** CLOUDFLARE_BROAD_API_TOKEN in Infisical rejected (code:1000); operator lacks prod CF deploy access.

**SC-2: deferred_to_operator** -- code complete, no code gap.

---

### 23-03 -- Attachment Download Route + EmailPanel Wire-up

**Checker-forced fix 2 -- snake_case clerk_user_id (attachments.ts lines 104-111):**

    const employeeWithSnake = employee as unknown as { clerk_user_id?: string; };
    const userId = employeeWithSnake.clerk_user_id ?? employee.employeeId ?? employee.email;
    // r2Key = attachments/{userId}/{messageId}/{attachmentId}/{filename}

clerk_user_id (snake_case) is primary key matching inbound-email.ts:155 convention. Header comment at file line 10 documents the R2 key convention. CONFIRMED.

**Checker-forced fix 3 -- handleAttachmentDownload import name (index.ts line 19):**

    import { handleAttachmentDownload } from ./routes/attachments;

Correct name (not attachmentRoutes). Route mounted at index.ts lines 385-389 under requireEmployeeMailbox. CONFIRMED.

**EmailAttachmentList chip wire (EmailAttachmentList.tsx line 56):**

    download={att.filename}

Confirmed present in anchor element. CONFIRMED.

**Deferred evidence file:** apps/parrot/test/attachment-download-verify.md exists with Chrome + Safari runbook. CONFIRMED.

**SC-3: deferred_to_operator** -- code complete, no code gap.

---

### 23-04 -- 14-Step Authenticated Agent-Lift UAT

**UAT template:** apps/parrot/test/agent-uat-results.md -- 164 lines confirmed. Contains: 14-step table (all TBD), AGENT-UAT-02 latency grid (3 actions x 3 runs), AGENT-UAT-03 11-tool checklist with curl recipes, sign-off blocks, common-blocker triage, internal-vs-startup MCP disambiguation note. No .ts/.tsx changes; tsc regression risk is zero.

**Pre-UAT code checks (without Worker deploy):**

| Check | Result |
|-------|--------|
| agentRoutes imported and mounted at /api/inbox/agent (index.ts:396) | CONFIRMED |
| Agent routes gated by requireEmployeeMailbox (index.ts:395) | CONFIRMED |
| Dev smoke at index.ts:1549 asserts tools_count >= 11 | CONFIRMED |
| UAT template line count >= 60 | 164 lines CONFIRMED |

**SC-4 and SC-5: deferred_to_operator** -- template complete, no code gap.

---

## Team-Mode Compliance

| Check | Result |
|-------|--------|
| Root .planning/STATE.md modified by this branch | NO -- COMPLIANT |
| .planning/team-mode.json modified by this branch | NO -- COMPLIANT |
| .planning/workstreams/team-workspace/STATE.md modified | YES -- correct per team-mode rules |
| All commits on rrr/v1.4/team-workspace-23 | CONFIRMED (16 commits) |

---

## Anti-Patterns Scan

No stub patterns, TODO/FIXME comments, placeholder content, or empty implementations found in any phase-modified file. All new functions contain substantive implementations.

### Security Pass (gstack Pass 1 -- CRITICAL)

Files scanned: infra/graph-api/src/index.mjs, apps/parrot/workers/lib/graph.ts, apps/parrot/workers/routes/reply-forward.ts, apps/parrot/workers/lib/inbound-email.ts, apps/parrot/workers/routes/attachments.ts, apps/parrot/app/components/EmailAttachmentList.tsx.

| Category | Finding | Blocks Phase |
|----------|---------|-------------|
| SQL & Data Safety | Cypher uses parameterized queries throughout; no string interpolation | No -- CLEAN |
| Shell Injection | No subprocess, os.system, eval, or exec calls | No -- CLEAN |
| LLM Output Trust Boundary | No LLM-provided values written to DB or used as URLs in new code | No -- CLEAN |
| Race Conditions | R2 key reconstruction is read-only; DO ownership check is single-path | No -- CLEAN |
| Enum/Value Completeness | ACK_PATTERN is additive; no new enum consumers; allowlist logic unchanged | No -- CLEAN |

Security Pass: No Pass 1 issues found in phase-modified files.

---

## Human Verification Required

All three items share one ~90-minute operator window (same CF token rotation blocker).

### 1. Deploy Precondition (gate for items 2-4)

**Action:** Rotate CLOUDFLARE_BROAD_API_TOKEN in Infisical at /internjobs-ai/CLOUDFLARE_BROAD_API_TOKEN (current value rejected: code:1000 Invalid API Token). Required scopes: Workers Scripts:Edit + KV:Edit + R2:Edit + Account Settings:Read + Zone Workers Routes:Edit on internjobs.ai. Then run: cd apps/parrot && npm run deploy.
**Why human:** Requires Cloudflare account membership the executor does not have.

### 2. SC-2 -- Safety Email Injection Test (23-02)

**Runbook:** apps/parrot/test/safety-email-verify.md section: What remains.
**Test:** Send 3 prompt-injection email variants + 1 benign control from a non-allowlisted external sender to a monitored Workspace inbox.
**Expected:** 3 safety_events rows (action=blocked, channel=email, source_id populated); 0 rows from benign send; 0 auto-replies in Sent folder.
**Why human:** Requires deployed Worker + real email delivery + SQL row inspection in production D1/SQLite.

### 3. SC-3 -- Attachment Download Browser Test (23-03)

**Runbook:** apps/parrot/test/attachment-download-verify.md section: What remains.
**Test:** Open email with attachment in Chrome and Safari; click an attachment chip.
**Expected:** File downloads (no 404, no navigation). Negative: curl with different-employee session returns 403; curl with bogus attachmentId returns 404.
**Why human:** Requires deployed Worker + real browser interaction + cross-browser coverage.

### 4. SC-4 and SC-5 -- Agent-Lift UAT Walkthrough (23-04)

**Runbook:** apps/parrot/test/agent-uat-results.md -- 14-step table + AGENT-UAT-02 latency grid + AGENT-UAT-03 11-tool checklist with curl recipes.
**Test:** Fresh incognito Clerk OTP session -- walk all 14 steps; record summarize/draft/translate latencies (3 runs each); open MCPPanel, confirm 11 tools listed, run >=3 curl tool calls.
**Expected:** >=11 of 14 steps PASS; all latency medians <=10s; all 11 internal MCP tools visible; >=3 tool calls non-error.
**Why human:** Requires live Worker + fresh Clerk OTP in real browser + human latency observation.

---

## Recommended Next Steps for Coordinator

One operator window (~90 min) closes all three deferred plans. The canonical 7-step shared runbook is in .planning/workstreams/team-workspace/STATE.md section: Open Items. Gate: steps 1-2 (CF token rotation + npm run deploy) unblock SC-2, SC-3, SC-4, and SC-5 simultaneously.

After the operator appends results to safety-email-verify.md, attachment-download-verify.md, and agent-uat-results.md, re-run this verification to produce a final live_verified classification for SC-2 through SC-5. SC-1 is code_verified and does not require further action before PR merge.

---

_Verified: 2026-05-26_
_Verifier: Claude (rrr-verifier, claude-sonnet-4-6)_
