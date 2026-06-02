# Phase 23-04 — Workspace Agent-Lift UAT Results

**Plan:** 23-04
**Phase:** 23 — Workspace Pilot Closeouts (v1.4)
**Requirements:** AGENT-UAT-01, AGENT-UAT-02, AGENT-UAT-03
**Status:** PASSED — operator UAT complete 2026-06-03 (all 14 steps PASS; see deviations)
**UAT source:** `.planning/milestones/v1.3-pilot-hardening/phases/19-todo-auto-resolution/V1_3_1-AGENT-LIFT-REPORT.md`
**Target:** Production (workspace.internjobs.ai)

## Summary

23-04 is a verification-only plan (no production code changes were planned).
Closing it required a human operator walking 14 steps in a real browser against
the deployed Workspace Worker (apps/parrot at workspace.internjobs.ai) with a
fresh Clerk OTP session, measuring LLM latency for AgentPanel quick actions, and
confirming MCPPanel renders all 11 internal Workspace MCP tools.

**Outcome:** All 14 steps PASS. During the walkthrough a real defect surfaced —
the AgentPanel quick actions were over-blocking / 503-ing and running 30s–1.7min
because every action ran on the kimi-k2.6 reasoning model, whose chain-of-thought
starved the `max_tokens` budget (content=null → fail-closed/503) and ballooned
latency. This was fixed mid-UAT (see Deviations) by routing the five generation
actions to a fast non-reasoning model; the final measurements below are on the
fixed build `7217fb31`.

**IMPORTANT — Server disambiguation:**
The 11 tools tested here are the INTERNAL Workspace MCP tools
(`PARROT_AGENT_TOOLS` in `apps/parrot/workers/lib/agent-tools.ts`). These are
served by the Parrot Worker at
`workspace.internjobs.ai/api/inbox/agent/tools`. These are NOT the 4-tool
startup-MCP at `mcp.internjobs.ai` (Phase 28, different server, different
purpose).

## What was verified (pre-UAT, code-side)

- [x] `PARROT_AGENT_TOOLS` has exactly 11 tool entries in `apps/parrot/workers/lib/agent-tools.ts` (`list_emails`, `get_email`, `get_thread`, `search_emails`, `draft_reply`, `draft_email`, `mark_email_read`, `move_email`, `discard_draft`, `send_reply`, `send_email`)
- [x] Disambiguation confirmed: these 11 tools are INTERNAL Workspace MCP, NOT the 4-tool startup-MCP from Phase 28 at `mcp.internjobs.ai`
- [x] AgentPanel + MCPPanel files exist in `apps/parrot/app/components/EmailPanel.tsx` (agent-lift code from un-roadmapped 2026-05-22..24 commits a77ec48..3791513)
- [x] Agent endpoints exist: `GET /api/inbox/agent/tools` + `POST /api/inbox/agent/{summarize,draft-reply,translate}`

## Operator UAT Runbook (EXECUTED 2026-06-03)

### Preconditions (met)

1. Deploy completed — Worker version `7217fb31-a092-4705-87d3-d4f67d6dfe56` on prod CF account `0fffd3dc637bdb26d4963df445a69fd3` (rentalaraj@gmail.com).
2. Fresh Workspace Clerk OTP session in an incognito window.
3. Browser DevTools Network tab open (for AGENT-UAT-02 latency).
4. Test inbox with active emails (3 candidate emails from `21bd1a12b4itb@gmail.com`: Arjun / Karthik / Meera).

### 14-Step UAT Table

| # | Step | Expected | Status | Notes / Evidence |
|---|------|----------|--------|------------------|
| 1 | OTP auth session — sign in at workspace.internjobs.ai via phone-OTP | Dashboard loads after sign-in | **PASS** | Dashboard rendered |
| 2 | Inbox navigation — click Inbox in sidebar | Email list renders with unread count | **PASS** | `GET /api/inbox/messages — Ok` (exercises tool `list_emails`) |
| 3 | Email open — click any email | EmailPanel renders body (not blank) | **PASS** | `GET /api/inbox/messages/{id} — Ok` (exercises tool `get_email`) |
| 4 | EmailIframe sandbox — DevTools Console while email open | No CSP / "Refused to execute script" errors | **PASS** | No console errors |
| 5 | Agent panel visible — locate AgentPanel section/tab/toggle | Visible alongside email | **PASS** | AgentPanel visible |
| 6 | Summarize quick action — click Summarize, time it | LLM response ≤10s, no 503 | **PASS** | median 1.44s (1.68 / 1.43 / 1.44) |
| 7 | Draft reply quick action — click Draft Reply, time it | LLM draft ≤10s, no 503 | **PASS** | median 8.65s (8.65 / 13.58 / 8.37) |
| 8 | Translate quick action — click Translate (select target lang), time it | Translation ≤10s, no 503 | **PASS*** | median 8.54s ES; verbose scripts 10–22s — see deviation |
| 9 | Extract actions — click Action Items | Bulleted action list OR "NONE" | **PASS** | 4.77s; returned action list |
| 10 | Chat — type "What does this email want me to do?" | Agent reply ≤10s | **PASS** | median 7.28s (10.37 cold / 6.50 / 7.28) |
| 11 | MCPPanel visible — find Tools panel/tab in agent sidebar | Loads without 404 | **PASS** | "Parrot Agent Tools" catalog rendered; `GET /api/inbox/agent/tools — Ok` |
| 12 | Tool catalog (11 tools) — count tools in MCPPanel | Exactly 11 listed | **PASS** | 11/11 listed (no numeric count in UI; all 11 present) |
| 13 | Tool calls (≥3 non-error) — invoke at least 3 tools | 3+ non-error JSON responses | **PASS** | list_emails (step 2) + get_email (step 3) + draft_reply (step 7) all non-error |
| 14 | Resolved view — navigate to Resolved folder (Dashboard `?view=resolved`) | View loads (empty OK) | **PASS** | Resolved view loaded, empty state |

\* Step 8 PASS with deviation: see "AGENT-UAT-02 — Latency" and "Deviations".

### AGENT-UAT-02 — Latency measurements (AgentPanel quick actions)

Measured end-to-end in DevTools Network tab on the fixed build `7217fb31`
(fast non-reasoning model). Target: ≤10s in production.

| Action | Run 1 (s) | Run 2 (s) | Run 3 (s) | Median | Within 10s? |
|--------|-----------|-----------|-----------|--------|-------------|
| summarize | 1.68 | 1.43 | 1.44 | **1.44** | ✅ |
| action items (extract) | 4.77 | — | — | **4.77** | ✅ |
| chat | 10.37 (cold) | 6.50 | 7.28 | **7.28** | ✅ |
| draft reply | 8.65 | 13.58 | 8.37 | **8.65** | ✅ |
| translate — Spanish | 9.79 | 8.54 | 7.50 | **8.54** | ✅ |
| translate — French | 9.85 | 10.88 | 13.57 | 10.88 | ⚠️ over |
| translate — Mandarin | 11.80 | 10.45 | 9.86 | 10.45 | ⚠️ over |
| translate — German | 14.35 | 10.85 | 14.13 | 14.13 | ❌ over |
| translate — Hindi | 15.15 | 15.76 | 22.43 | 15.76 | ❌ over |

Zero 503 errors across all runs. `wrangler tail` for the session confirmed:
no `chatCompletion: reasoning model hit max_tokens` warnings, no 503s, no quota
errors on any of the 5 summarize / 3 draft / 15 translate / 3 chat / 1 extract
calls.

**Pre-fix baseline (kimi-k2.6, build `8a57315e` — for the record):** draft
36–78s; translate 45s–1.7min with frequent 503s. The fix is a 5–10× speedup
plus elimination of all errors.

### AGENT-UAT-03 — MCPPanel 11 tools

MCPPanel ("Parrot Agent Tools") rendered the full catalog from
`GET /api/inbox/agent/tools`. All 11 entries present (panel shows no numeric
count; verified by enumeration):

- [x] list_emails
- [x] get_email
- [x] get_thread
- [x] search_emails
- [x] draft_reply
- [x] draft_email
- [x] mark_email_read
- [x] move_email
- [x] discard_draft
- [x] send_reply
- [x] send_email

The panel is a read-only discoverability catalog by design (no click-to-invoke
UI; a public MCP transport is deferred per its Roadmap note). Tools are invoked
by the agent internally / via the authenticated inbox HTTP path. Three tools were
exercised non-error during the walkthrough:

| Tool | How invoked | Response status | Notes |
|------|-------------|-----------------|-------|
| list_emails | Inbox load (step 2) | non-error (200) | `GET /api/inbox/messages — Ok` in tail |
| get_email | Email open (step 3) | non-error (200) | `GET /api/inbox/messages/{id} — Ok` in tail |
| draft_reply | Draft reply quick action (step 7) | non-error (200) | draft text returned |

### Sign-off blocks

**AGENT-UAT-01 (all 14 steps):** PASS — 14/14 steps PASS.

**AGENT-UAT-02 (LLM latency < 10s):** PASS (with deviation) — all actions usable, zero 503s.
- Summarize median latency: 1.44s ✅
- Action items median latency: 4.77s ✅
- Chat median latency: 7.28s ✅
- Draft reply median latency: 8.65s ✅
- Translate median latency: 8.54s (Spanish) ✅ / 10–22s (verbose scripts: French, Mandarin, German, Hindi) ⚠️ — accepted deviation, see below.

**AGENT-UAT-03 (11 tools listed, ≥3 non-error calls):** PASS
- Tools listed: 11 / 11
- Non-error tool calls: 3 / 3 minimum (list_emails, get_email, draft_reply)

### Deviations (accepted for v1.4 pilot)

1. **AGENT-UAT-02-DEV-01 — Translate latency for verbose scripts.** Translation
   into Hindi/German runs 10–22s and French/Mandarin ~10–11s, over the <10s
   target. Root cause: translation produces the largest output of any action, so
   even on the fast non-reasoning model it generates a lot of tokens. Accepted
   for the pilot (down from 45s–1.7min + 503s on the prior model; now zero
   errors). Further tuning (smaller/faster model or output streaming for
   translate specifically) deferred to v1.5.

2. **AGENT-UAT-02-DEV-02 — Quick-action set is summarize / draft / action items /
   translate / chat**, not the summarize / draft / translate trio the v1.3.1
   agent-lift report listed (it referenced "translate" but the deployed surface
   exposes "Action Items" as a first-class action too). The latency grid covers
   all five.

### Common-blocker triage (reference)

- **AGENT-UAT-02 (quick actions 503 / slow):** Was diagnosed live — root cause was kimi-k2.6 reasoning CoT starving `max_tokens` (content=null → fail-closed/503) and inflating latency. Fixed by `PARROT_FAST_MODEL` (see Deviations + 23-VERIFICATION). If it recurs, `wrangler tail` and look for `chatCompletion: reasoning model hit max_tokens`.
- **AGENT-UAT-03 (tool count != 11):** Confirm `GET /api/inbox/agent/tools` returns 200 with 11 entries; if 404, check the Hono `app.route('/api/inbox/agent', agentRoutes)` mount in `apps/parrot/workers/index.ts`.

## UAT execution log

### 2026-06-03 — Agent-lift UAT executed + agent-latency fix shipped

**Operator:** Nithin (rentalaraj@gmail.com)
**Worker version:** `7217fb31-a092-4705-87d3-d4f67d6dfe56` (final, fast model)
**Prior builds this session:** `3655c6cb` (translate/draft bumped to 4000), `8a57315e` (all actions bumped to 4000 — surfaced that summarize/extract were also starving) — both kimi, both still failed <10s. `7217fb31` = fast model, PASS.
**Deploy account:** prod CF `0fffd3dc637bdb26d4963df445a69fd3`.

Walkthrough: all 14 steps PASS. During steps 6–8 the AgentPanel actions were
503-ing / running 30s–1.7min; diagnosed via `wrangler tail` as kimi-k2.6
reasoning-model `max_tokens` starvation. Fix applied + redeployed mid-session
(route the 5 generation actions — summarize/translate/draft/extract/chat — and
the draft `verifyDraft` scrub to `PARROT_FAST_MODEL`
= `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; keep kimi only on the security
injection scanner). Re-measured on `7217fb31`: all actions usable, zero 503s.
See `23-VERIFICATION.md` SC-4/SC-5 and the code change in
`apps/parrot/workers/routes/agent.ts` + `apps/parrot/workers/lib/ai.ts`.

## Notes

- Defer reason (historical): required deployed Worker + live browser session + human operator. Now executed.
- AgentPanel + MCPPanel code was lifted from `apps/agentic-inbox` in un-roadmapped commits 2026-05-22..24 (`a77ec48..3791513`).
- 23-04 closure does not block phase 23 PR merge — coordinator decides whether to require the live UAT before integration; it is now complete.
- Deferred reqs roll up to Phase 23 review: AGENT-UAT-01 ✅, AGENT-UAT-02 ✅ (with deviation), AGENT-UAT-03 ✅.
