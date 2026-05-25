# Phase 23-04 — Workspace Agent-Lift UAT Results

**Plan:** 23-04
**Phase:** 23 — Workspace Pilot Closeouts (v1.4)
**Requirements:** AGENT-UAT-01, AGENT-UAT-02, AGENT-UAT-03
**Status:** DEFERRED — operator UAT pending
**UAT source:** `.planning/milestones/v1.3-pilot-hardening/phases/19-todo-auto-resolution/V1_3_1-AGENT-LIFT-REPORT.md`
**Target:** Production (workspace.internjobs.ai)

## Summary

23-04 is a verification-only plan (no production code changes). Closing it
requires a human operator walking 14 steps in a real browser against the
deployed Workspace Worker (apps/parrot at workspace.internjobs.ai) with a
fresh Clerk OTP session, measuring LLM latency for AgentPanel quick actions,
and confirming MCPPanel renders all 11 internal Workspace MCP tools.

Deferred for the same operator window as 23-02 + 23-03 — see
`apps/parrot/test/safety-email-verify.md` for the prerequisite CF token
rotation + `npm run deploy` runbook. A single deploy window unblocks all
three deferred live-verify halves at once (23-02 safety, 23-03 attachments,
23-04 agent-lift UAT).

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

## Operator UAT Runbook (deferred)

### Preconditions

1. Deploy completed (see `apps/parrot/test/safety-email-verify.md` "What remains" for the shared runbook: rotate `CLOUDFLARE_BROAD_API_TOKEN` then `cd apps/parrot && npm run deploy`).
2. Fresh Workspace Clerk OTP session in a browser (NOT a cached session from a prior test). Use incognito/private window.
3. Browser DevTools Network tab open (for latency measurement on AGENT-UAT-02).
4. At least one test inbox with active emails (for AgentPanel context).
5. (Optional) A second empty inbox for negative tests.

### 14-Step UAT Table

Operator: walk each of the 14 steps from `V1_3_1-AGENT-LIFT-REPORT.md`. For each, fill PASS / FAIL / SKIP and notes.

| # | Step | Expected | Status | Notes / Evidence |
|---|------|----------|--------|------------------|
| 1 | OTP auth session — sign in at workspace.internjobs.ai via phone-OTP | Dashboard loads after sign-in | TBD | |
| 2 | Inbox navigation — click Inbox in sidebar | Email list renders with unread count badge | TBD | |
| 3 | Email open — click any email | EmailPanel renders body (not blank) | TBD | |
| 4 | EmailIframe sandbox — DevTools Console while email open | No CSP / "Refused to execute script" errors | TBD | |
| 5 | Agent panel visible — locate AgentPanel section/tab/toggle | Visible alongside email | TBD | |
| 6 | Summarize quick action — click Summarize, time it | LLM response ≤10s, no 503 | TBD | latency: __ s |
| 7 | Draft reply quick action — click Draft Reply, time it | LLM draft ≤10s, no 503 | TBD | latency: __ s |
| 8 | Translate quick action — click Translate (select target lang), time it | Translation ≤10s, no 503 | TBD | latency: __ s |
| 9 | Extract actions — click Extract Actions | Bulleted action list OR "NONE" | TBD | |
| 10 | Chat — type "What does this email want me to do?" in agent chat | Agent reply ≤10s | TBD | latency: __ s |
| 11 | MCPPanel visible — find Tools panel/tab in agent sidebar | Loads without 404 | TBD | |
| 12 | Tool catalog (11 tools) — count tools in MCPPanel | Exactly 11 listed | TBD | count: __ / 11 |
| 13 | Tool calls (≥3 non-error) — invoke at least 3 tools | 3+ non-error JSON responses | TBD | tools tested: |
| 14 | Resolved view — navigate to Resolved folder | View loads (empty OK) | TBD | |

### AGENT-UAT-02 — Latency measurements (AgentPanel quick actions)

Run each quick action 3 times against a representative thread. Measure end-to-end latency in DevTools Network tab. Target: ≤10s in production per success criterion.

| Action | Run 1 (s) | Run 2 (s) | Run 3 (s) | Median | Within 10s? |
|--------|-----------|-----------|-----------|--------|-------------|
| summarize | TBD | TBD | TBD | TBD | TBD |
| draft     | TBD | TBD | TBD | TBD | TBD |
| translate | TBD | TBD | TBD | TBD | TBD |

### AGENT-UAT-03 — MCPPanel 11 tools

Open MCPPanel. Confirm the tool list shows EXACTLY these 11 entries (any missing or extra = FAIL):

- [ ] list_emails
- [ ] get_email
- [ ] get_thread
- [ ] search_emails
- [ ] draft_reply
- [ ] draft_email
- [ ] mark_email_read
- [ ] move_email
- [ ] discard_draft
- [ ] send_reply
- [ ] send_email

Pick any 3, invoke them, capture non-error responses below. Must return non-error per success criterion.

Option A — via MCPPanel UI click-to-invoke (if present).
Option B — via curl (grab `__session` cookie from DevTools → Application → Cookies):

```bash
TOKEN="<your __session cookie value>"
BASE="https://workspace.internjobs.ai"

# Tool 1: list_emails (via inbox messages endpoint)
curl -s -X GET "$BASE/api/inbox/messages?folder=INBOX&limit=5" \
  -H "Authorization: Bearer $TOKEN" | head -c 200

# Tool 2: search_emails
curl -s -X GET "$BASE/api/inbox/search?q=hello&limit=5" \
  -H "Authorization: Bearer $TOKEN" | head -c 200

# Tool 3: get_email (use a real message ID from list_emails output)
curl -s -X GET "$BASE/api/inbox/messages/{messageId}" \
  -H "Authorization: Bearer $TOKEN" | head -c 200
```

| Tool | Args | Response status | Notes |
|------|------|-----------------|-------|
| (operator's choice) | | TBD | |
| (operator's choice) | | TBD | |
| (operator's choice) | | TBD | |

### Sign-off blocks

**AGENT-UAT-01 (all 14 steps):** TBD — PASS / FAIL (N steps failed → see Notes column)

**AGENT-UAT-02 (LLM latency < 10s):** TBD — PASS / FAIL
- Summarize median latency: __ s
- Draft reply median latency: __ s
- Translate median latency: __ s

**AGENT-UAT-03 (11 tools listed, ≥3 non-error calls):** TBD — PASS / FAIL
- Tools listed: __ / 11
- Non-error tool calls: __ / 3 minimum

### Result aggregation

When operator completes the walk, update the Status field at the top of this file:
- All 14 steps + latency + 11-tool list pass → **Status: PASSED**
- Any FAIL → **Status: FAILED** — append details + remediation actions
- Operator unable to complete subset → **Status: PARTIAL** — list completed vs deferred

Then append a `## UAT execution log` section with operator name + date + Worker
version hash (from `wrangler deployments list` or the Cloudflare dashboard).

### Common-blocker triage (if any step FAILs)

- **AGENT-UAT-02 FAIL (quick actions returning 503):** Diagnose CF AI Gateway wiring. Run `wrangler tail` during a test call and inspect the error. Common fix: ensure `CLOUDFLARE_AI_API_TOKEN` and `PARROT_AI_GATEWAY_ID` are set as Worker secrets, and the AI binding is declared in `apps/parrot/wrangler.jsonc`.
- **AGENT-UAT-03 FAIL (tool count != 11):** Confirm `GET /api/inbox/agent/tools` returns 200 with 11 entries. If 404, the `agentRoutes` group may not be mounted in `apps/parrot/workers/index.ts` — check the Hono `app.route('/api/inbox/agent', agentRoutes)` line.
- **AGENT-UAT-03 FAIL (tool calls error):** Inspect the specific error JSON. 401 → session token not threaded through. 500 → grab the request ID from the response, look it up in `wrangler tail`.

## UAT execution log

(Empty — to be filled in by operator when UAT runs. Append entries here, do
not rewrite the file above.)

## Notes

- This file is a TEMPLATE designed to be appended-to, not rewritten, when the operator runs the UAT.
- Defer reason: requires deployed Worker + live browser session + human operator. Not a code defect.
- AgentPanel + MCPPanel code was lifted from `apps/agentic-inbox` in un-roadmapped commits 2026-05-22..24 (`a77ec48..3791513`). Code is on `main`. UAT validates that runtime behavior in the Workspace context matches expected.
- 23-04 closure status doesn't block phase 23 PR merge — coordinator decides whether to require the live UAT before integration or accept the deferral.
- Deferred reqs roll up to Phase 23 review: AGENT-UAT-01, AGENT-UAT-02, AGENT-UAT-03.
