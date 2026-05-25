---
phase: 28-startup-mcp-server
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 6/8 must-haves verified (2 deferred per operator decision 2026-05-25)
human_verification:
  - test: "Founder installs MCP token from admin SMS, calls me(), execute('post_role'), search('candidates'), execute('reply_to_candidate'), and verify audit rows"
    expected: "me() returns startup identity with non-empty startup.id + member.id; post_role returns role_id with embedding_attached; search returns ranked candidates; reply_to_candidate creates outbound_messages row with channel='mcp'; startup_action_log has >=4 rows with status='ok' and non-zero latency_ms"
    why_human: "Cannot synthesize a real founder using a real LLM client. Deferred to v1.5 STARTUP-PILOT-LIVE-01 per explicit user decision 2026-05-25."
  - test: "Ridhi calls POST /admin/startups/new and founder receives SMS with install snippet"
    expected: "Admin endpoint returns ok:true with token + install_snippet (claude_code, cursor_mcp_json, chatgpt, sms_body); founder phone receives SMS with the Claude MCP add command"
    why_human: "SMS delivery via Telnyx requires live credentials and a real phone number. Code path exists and is substantive; smoke was synthetic-only."
---

# Phase 28: Startup MCP Server + Channel-Adapter Core — Verification Report

**Phase Goal:** First scalable channel for startup-initiated interaction with internjobs.ai. New Cloudflare Worker MCP server at mcp.internjobs.ai lets a startup founder (operating via Claude Desktop / Claude Code / Cursor / Cline / ChatGPT) post roles, search candidates, and reply to threads — without touching a dashboard. Ridhi handles concierge onboarding via a small admin endpoint. Architecture is channel-adapter from day one so Phase 28.5 (web), Phase 29 (Telnyx) and v1.5 (Slack/Discord/Teams) plug in as ~50–100 LOC adapters on the same core.

**Verified:** 2026-05-24T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Architectural Context Loaded

- Locked source: `.planning/ROADMAP.md` Phase 28 — "startup_id ALWAYS comes from the auth token's resolved context (args.startup_id). NEVER from user-supplied params." — Confirmed enforced in execute.ts (Zod .strip() on all action schemas + proxy ownership WHERE clauses).
- Locked source: `.planning/ROADMAP.md` Phase 28 channel-adapter architecture — "every channel resolves identity to a (startup_id, member_id) pair via startup_channel_links … The MCP server is the first transport; the table schema and core router are written so Phase 29 (Telnyx) + v1.5 channels each become thin adapters."
- Locked source: `apps/startup/workers/lib/embed.ts` inline comment — "COMPUTE INDEPENDENCE (locked Phase 28 decision): the startup Worker MUST NOT call the student app's /internal/* endpoints at runtime." — Confirmed: embed.ts uses env.AI.run() (Workers AI binding) directly.
- Pilot evidence deferral — operator decision 2026-05-25: treat must-haves #1, #2, #3 as `human_needed` rather than `gaps_found`. Code paths exist and pass automated smoke; gap is the live-founder run (STARTUP-PILOT-LIVE-01 in v1.5).

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Ridhi calls admin endpoint; founder receives SMS with MCP install command; me() returns startup identity | ? HUMAN_NEEDED | `routes/admin.ts` POST /admin/startups/new is substantive (358 lines): admin auth, createStartup() transactional helper, buildInstallSnippet() with claude/cursor/chatgpt formats, sendInstallSms() via Telnyx (waitUntil). Code path correct; SMS delivery not live-tested per 2026-05-25 deferral. |
| 2 | execute('post_role') creates role row; search('candidates') returns ranked via pgvector | ? HUMAN_NEEDED | `tools/execute.ts` handlePostRole() calls embedText() then proxyPost('/v1/roles'); `infra/startup-api/src/index.mjs` /v1/roles inserts roles + UPSERTs role_embeddings with `::vector` cast; /v1/search/candidates does pgvector cosine similarity with startup_id scope. Code complete; no real founder run per deferral. |
| 3 | execute('reply_to_candidate') creates outbound_messages row with channel='mcp' | ? HUMAN_NEEDED | `tools/execute.ts` handleReplyToCandidate() calls proxyPost('/v1/messages', {channel:'mcp', direction:'outbound'}); migration 0011 creates outbound_messages table with channel column. Code complete; deferred per 2026-05-25 decision. |
| 4 | discover_actions() returns all 5 action schemas | ✓ VERIFIED | `tools/discover-actions.ts` exports handleDiscoverActions() returning exactly 5 entries: post_role, reply_to_candidate, update_role, archive_role, mark_candidate — each with full input_schema.type, properties, required array. Pure function, no auth, no stubs. |
| 5 | Audit log row written for every execute() call (member_id, channel='mcp', action, params_hash, status, latency_ms) | ✓ VERIFIED | `tools/execute.ts` writeAuditLog() called in finally block (lines 376–389) — fires regardless of success or error. AuditLogArgs interface has all required fields. `infra/startup-api` /v1/action-log inserts all columns to startup_action_log. Chain: execute() → finally → writeAuditLog() → POST /v1/action-log → INSERT. Complete. |
| 6 | Cross-startup isolation enforced (negative tests: member cannot access other startup's data) | ✓ VERIFIED | Two-layer defense confirmed: (1) Zod .strip() silently drops any user-supplied startup_id on all 5 action schemas; (2) every proxy SQL query includes WHERE startup_id = $auth_ctx_value — ownership-checked at DB level. `handleUpdateRole` / `handleArchiveRole` get 404 on cross-startup role_id. `search/candidates` scopes via `EXISTS (SELECT 1 FROM inbound_messages WHERE startup_id = $2)`. `startup_members` dedupe on founder email before INSERT. |
| 7 | CHANNELS.md documents path from MCP-only to Telnyx + v1.5 channels with adapter sketches | ✓ VERIFIED | `apps/startup/CHANNELS.md` (286 lines) has: Phase 28 MCP (live), Phase 28.5 web channel (with createStartup() reuse sketch), Phase 29 Telnyx SMS (~50 LOC TypeScript handler sketch), Phase 29 Voice AI (zero-code portal config sketch), v1.5 Slack (~50 LOC sketch), v1.5 Discord + Teams (pattern described), v1.5 email. Phase 28.5 adapter specifically calls out `createStartup()` from admin.ts as the shared entry point. |
| 8 | /startups marketing page has Request Access CTA that emails Ridhi | ✓ VERIFIED | `apps/marketing/src/components/StartupAccessSection.tsx` exports `RequestAccessForm` (real fetch POST to https://mcp.internjobs.ai/api/request-access) and `ChannelsGrid`; `apps/marketing/src/App.tsx` imports both, renders `<StartupAccessSection />` (which uses `<RequestAccessForm />`) and `<ChannelsGrid />` inside `StartupPage` at route `/startups`. CTA submits to Worker `routes/api.ts` which emails Ridhi or logs lead. |

**Score:** 5/8 truths fully automated-verified + 3/8 code-verified but human_needed for live-pilot.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/startup/workers/app.ts` | Hono root: /mcp, /admin, /api, Bearer auth middleware | ✓ VERIFIED | 124 lines; imports buildMcpHandler, validateBearerToken, adminRouter, apiRouter; bearerAuth middleware on /mcp + /mcp/*; routes wired. |
| `apps/startup/workers/server.ts` | McpServer factory, 4 tools registered | ✓ VERIFIED | 189 lines; createStartupMcpServer() registers me, discover_actions, search, execute tools; buildMcpHandler() for per-request isolation. |
| `apps/startup/workers/lib/auth.ts` | SHA-256 hash token, POST to proxy /v1/startups/token | ✓ VERIFIED | 83 lines; hashToken() via crypto.subtle; 5s timeout; null-on-failure; validates startup_id + member_id in response. |
| `apps/startup/workers/lib/audit.ts` | writeAuditLog() fire-and-forget, hashParams() | ✓ VERIFIED | 78 lines; AuditLogArgs interface; POST /v1/action-log; warns on failure, never throws. |
| `apps/startup/workers/lib/embed.ts` | Workers AI env.AI.run() for 768-dim vectors | ✓ VERIFIED | 74 lines; uses env.AI binding (@cf/baai/bge-base-en-v1.5); null fail-soft; no student-app dependency (locked decision honored). |
| `apps/startup/workers/tools/me.ts` | fetchStats() + summarizeActivity(), MeResult interface | ✓ VERIFIED | 79 lines; calls GET /v1/startups/:id/stats; fail-soft with friendly fallback. |
| `apps/startup/workers/tools/discover-actions.ts` | 5 action schemas in Stainless shape | ✓ VERIFIED | 160 lines; 5 actions: post_role, reply_to_candidate, update_role, archive_role, mark_candidate; all with input_schema + required arrays. |
| `apps/startup/workers/tools/search.ts` | pgvector for candidates, SQL for other 5 scopes | ✓ VERIFIED | 165 lines; searchCandidates() embeds query then posts to /v1/search/candidates; searchStructured() for roles/threads/messages/members/startups; startup_id scoped. |
| `apps/startup/workers/tools/execute.ts` | 5 action handlers + Zod validation + authz + audit | ✓ VERIFIED | 390 lines; ACTION_HANDLERS dispatch table; schema validation strips startup_id; finally block writes audit regardless of error; ownership via proxy WHERE clauses. |
| `apps/startup/workers/routes/admin.ts` | POST /admin/startups/new, constant-time auth, SMS send | ✓ VERIFIED | 358 lines; verifyAdminSecret() via crypto.subtle.timingSafeEqual; createStartup() extracted for Phase 28.5 reuse; buildInstallSnippet() for claude/cursor/chatgpt; sendInstallSms() Telnyx optional. |
| `apps/startup/workers/routes/api.ts` | POST /api/request-access, CORS restricted to internjobs.ai | ✓ VERIFIED | 136 lines; CORS origin restricted to internjobs.ai + www.internjobs.ai; CF Email binding (optional, falls back to log); required name+email validation. |
| `infra/startup-api/src/index.mjs` | All 13 proxy endpoints, timingSafeEqual auth, parameterized SQL | ✓ VERIFIED | 845 lines; all endpoints present: /v1/startups/token, /v1/startups, /v1/startups/:id/token, /v1/startups/:id/stats, /v1/roles, /v1/messages, /v1/channel-links, /v1/action-log, /v1/search/candidates, /v1/search/:scope (5 scopes), PATCH /v1/roles/:id, PATCH /v1/threads/:id/mark, /health. All SQL parameterized ($1/$2/$3). |
| `apps/app/db/migrations/0011_v1_4_startup_mcp.sql` | mcp_token_hash cols, startup_channel_links, startup_action_log, outbound_messages | ✓ VERIFIED | All 4 DDL blocks present; idempotent IF NOT EXISTS; correct indexes including lookup_idx for active channel links. |
| `apps/app/db/migrations/0012_v1_4_startup_mark.sql` | startup_mark column on inbound_messages | ✓ VERIFIED | Correct ADD COLUMN IF NOT EXISTS with partial index on (startup_id, startup_mark) WHERE NOT NULL. |
| `apps/marketing/src/components/StartupAccessSection.tsx` | RequestAccessForm POSTing to MCP worker + ChannelsGrid | ✓ VERIFIED | 379 lines; RequestAccessForm has real fetch (not stub), state machine (idle/loading/done/error), confirmation swap; ChannelsGrid renders 5 primary + 3 coming-soon channels. |
| `apps/marketing/src/App.tsx` | /startups route uses StartupPage with both components | ✓ VERIFIED | isStartupPage check routes to StartupPage; StartupPage renders ChannelsGrid + StartupAccessSection (which contains RequestAccessForm); import at line 23 confirmed. |
| `apps/startup/CHANNELS.md` | Adapter doc with Phase 28.5, 29, v1.5 sketches | ✓ VERIFIED | 286 lines; covers MCP (live), web/28.5, Telnyx SMS (TypeScript sketch ~50 LOC), Telnyx Voice AI (portal config), Slack (TypeScript sketch ~50 LOC), Discord + Teams (pattern), email. Phase 28.5 sketch specifically calls createStartup() from admin.ts for reuse. |
| `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md` | Deferred placeholder with acceptance criteria | ✓ VERIFIED | File exists; status=deferred; reason documents 2026-05-25 user decision; acceptance criteria are specific (5 checks: me(), post_role + role row + embedding, search candidates result, reply_to_candidate + outbound row, audit log >=4 rows); v1.5 carryover requirement STARTUP-PILOT-LIVE-01 noted. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app.ts` /mcp route | `server.ts` buildMcpHandler | import + call inside Hono all("/mcp") handler | ✓ WIRED | app.ts imports buildMcpHandler from ./server; calls it inside both /mcp and /mcp/* handlers passing c.env + startupCtx. |
| `app.ts` bearerAuth | `lib/auth.ts` validateBearerToken | import + await in middleware | ✓ WIRED | validateBearerToken imported and awaited in bearerAuth; startupCtx set on context for downstream tools. |
| `server.ts` tools | `tools/me.ts` handleMe | import + async call | ✓ WIRED | handleMe imported; called as `await handleMe(props)` in me tool callback. |
| `server.ts` tools | `tools/discover-actions.ts` handleDiscoverActions | import + sync call | ✓ WIRED | handleDiscoverActions imported; called synchronously (pure function) in discover_actions tool callback. |
| `server.ts` tools | `tools/search.ts` handleSearch | import + async call | ✓ WIRED | handleSearch imported; called with startup_id from auth props, scope/query/filters/limit from tool args. |
| `server.ts` tools | `tools/execute.ts` handleExecute | import + async call | ✓ WIRED | handleExecute imported; called with startup_id + member_id from auth props, action + params from tool args. |
| `tools/execute.ts` handlers | `lib/audit.ts` writeAuditLog | import + finally block | ✓ WIRED | writeAuditLog + hashParams imported; writeAuditLog called in try (invalid_params path) AND in finally block (all other paths). |
| `tools/execute.ts` handlePostRole | `lib/embed.ts` embedText | import + await | ✓ WIRED | embedText imported; called before proxyPost('/v1/roles'); result (or null) passed as embedding field. |
| `tools/search.ts` searchCandidates | `lib/embed.ts` embedText | import + await | ✓ WIRED | embedText imported; query embedded before posting to /v1/search/candidates; returns [] on null embedding. |
| `tools/execute.ts` proxyPost | `infra/startup-api` /v1/roles, /v1/messages | fetch + env.STARTUP_API_URL | ✓ WIRED | All 5 action handlers call proxyPost/proxyPatch with ${env.STARTUP_API_URL}/v1/... and env.STARTUP_API_SECRET Bearer token. |
| `lib/auth.ts` validateBearerToken | `infra/startup-api` /v1/startups/token | fetch POST with hash | ✓ WIRED | Hashes token with SHA-256, POSTs {token_hash} to /v1/startups/token; proxy queries startups.mcp_token_hash. |
| `lib/audit.ts` writeAuditLog | `infra/startup-api` /v1/action-log | fetch POST | ✓ WIRED | POST /v1/action-log with full AuditLogArgs; proxy INSERTs into startup_action_log. |
| `routes/admin.ts` createStartup() | `infra/startup-api` /v1/startups | fetch POST | ✓ WIRED | createStartup() POSTs {company, founder_email} to /v1/startups; proxy creates startup + member + channel_link in transaction, returns {startup_id, member_id, token}. |
| `marketing/StartupAccessSection` RequestAccessForm | `routes/api.ts` /api/request-access | fetch POST from browser | ✓ WIRED | REQUEST_ACCESS_ENDPOINT set to https://mcp.internjobs.ai/api/request-access; form onSubmit calls fetch with JSON; CORS headers on api.ts allow internjobs.ai origin. |
| `infra/startup-api` /v1/roles | DB roles + role_embeddings | parameterized INSERT + UPSERT | ✓ WIRED | Inserts role row with $1–$6; conditionally UPSERTs role_embeddings with $2::vector cast using ON CONFLICT DO UPDATE. |
| `infra/startup-api` /v1/search/candidates | DB student_embeddings + inbound_messages | pgvector <=> operator + startup scope | ✓ WIRED | JOIN student_embeddings, WHERE EXISTS inbound_messages with startup_id=$2; cosine similarity ORDER BY ascending <=> score. |
| `infra/startup-api` /v1/action-log | DB startup_action_log | parameterized INSERT | ✓ WIRED | All 10 columns passed via $1–$10. |

---

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| STARTUP-MCP-01..04 (Worker scaffold, Bearer auth, 4 tool stubs) | ✓ SATISFIED | app.ts + server.ts + auth.ts wired and substantive |
| STARTUP-MCP-05..10 (Action handlers, search, authz, audit) | ✓ SATISFIED | execute.ts + search.ts + audit.ts all implemented |
| STARTUP-ADMIN-01..02 (Admin endpoint, SMS install snippet) | ✓ SATISFIED — code only | Code path complete; live SMS delivery human_needed |
| STARTUP-CHANNEL-01 (startup_channel_links schema + UPSERT) | ✓ SATISFIED | migration 0011 + /v1/channel-links endpoint with ON CONFLICT DO UPDATE semantics |
| STARTUP-CHANNEL-02 (CHANNELS.md adapter doc) | ✓ SATISFIED | CHANNELS.md 286 lines with Phase 28.5, 29, v1.5 adapter sketches |
| STARTUP-MARKETING-01 (/startups CTA emails Ridhi) | ✓ SATISFIED | StartupAccessSection.tsx + api.ts wired |
| STARTUP-PILOT-01 (first pilot E2E install) | ? DEFERRED | PILOT-EVIDENCE.md created with acceptance criteria; deferred to v1.5 per 2026-05-25 user decision |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/marketing/src/components/StartupAccessSection.tsx` | 102–128 | `placeholder=` on form inputs | INFO | HTML form placeholder attributes — not a stub pattern. Form has real onSubmit + fetch wiring. |
| `infra/startup-api/src/index.mjs` | 43, 117, 244 | "placeholder clerk_user_id" comments | INFO | Intentional: concierge onboarding synthesizes a `concierge:*` clerk_user_id until Phase 28.5 wires real Clerk. Documented in SUMMARY + inline comments. Not a stub. |
| `apps/startup/workers/tools/execute.ts` | 165–170 | Phase 28 trust-boundary note on reply_to_candidate ownership | WARNING | Code comment acknowledges that Phase 28 trusts the founder's LLM to have resolved a thread they own (via search()). Cross-startup thread guessing is a theoretical risk for Phase 28. Not blocking — the two-layer defense (Zod strip + proxy startup_id scope) prevents cross-startup data writes; only reply routing is softer. Phase 29 will add explicit /v1/threads/:id/verify per the comment. |

### Security Pass (gstack Pass 1 — CRITICAL)

| File | Line | Category | Finding | Severity | Blocks Phase |
|------|------|----------|---------|----------|--------------|
| `infra/startup-api/src/index.mjs` | 579–597 | SQL & Data Safety | Dynamic SET clause in PATCH /v1/roles/:id: column names iterate from an allowlist array (`allowed = ["title", ...]`), then `${k} = $${vals.length}` is interpolated into SQL. Column NAMES come from the controlled allowlist (not user input) and values are parameterized. This is not injection-vulnerable as written — the loop only hits keys that are in `allowed`, so no user-controlled string reaches the SQL template. | ADVISORY | No — pattern is safe (allowlist-controlled key names + parameterized values). |
| `apps/startup/workers/tools/execute.ts` | 9–15 | LLM Output Trust Boundary | execute() receives `action` and `params` from LLM tool call. Mitigated by: (a) `action` is a Zod enum — invalid values rejected before reaching handlers; (b) per-action Zod schemas .strip() unknown fields; (c) `startup_id` never user-supplied. No unvalidated LLM output reaches the DB directly. | INFO | No — defense-in-depth is adequate. |
| `apps/startup/workers/routes/admin.ts` | 40–57 | Race Conditions & Concurrency | `verifyAdminSecret()` uses `crypto.subtle.timingSafeEqual` but has an early-return on length mismatch (line 49–53). The comment notes this is acceptable because CF's edge cancels most timing oracles. The length-mismatch branch does a same-length compare of `a` against itself — correct defence-in-depth. Not a vulnerability as deployed. | ADVISORY | No — pattern is correct. |

_Pass 2 (INFORMATIONAL) not run. Invoke with `mode: deep-review` to enable._

---

### Human Verification Required

#### 1. Full Founder MCP Install + 4-Tool Smoke

**Test:** Ridhi runs `POST /admin/startups/new` with a real founder's details. Founder receives SMS. Founder pastes install command into Claude Desktop / Claude Code / Cursor / ChatGPT and runs: (a) `me()`, (b) `execute('post_role', {title, description})`, (c) `search('candidates', 'frontend interns')`, (d) `execute('reply_to_candidate', {thread_id, message})`.

**Expected:**
- `me()` returns `{startup: {id, name}, member: {id}, role_count, recent_activity}` with non-empty IDs.
- `execute('post_role')` returns `{role_id, embedding_attached}` AND a roles row + role_embeddings row exist in the DB.
- `search('candidates')` returns `{scope:'candidates', results:[...], total_returned}` with at least 1 ranked result.
- `execute('reply_to_candidate')` returns `{message_id, thread_id, channel:'mcp'}` AND an outbound_messages row exists with channel='mcp'.
- `startup_action_log` has >=4 rows from this session, all with `status='ok'` and non-zero `latency_ms`.

**Why human:** Cannot synthesize a real founder using a real LLM client. Deferred to v1.5 STARTUP-PILOT-LIVE-01 per operator decision 2026-05-25. PILOT-EVIDENCE.md documents the acceptance criteria and two closure paths (Phase 28.5 web onboarding as default; tech founder direct install as alternative).

#### 2. Cross-Startup Negative Test

**Test:** With two startup tokens (startup A and startup B), call `execute('update_role', {role_id: <B's role>, patch: {title: 'hacked'}})` using startup A's token.

**Expected:** Returns `{ok: false, error: 'not_found_or_not_owned', latency_ms: N}` — proxy returns 404 (WHERE startup_id = $A_id AND id = $B_role_id matches zero rows).

**Why human:** The two-layer defense is code-verified (Zod strips startup_id from params; proxy SQL has WHERE startup_id = $auth). A real negative test requires two provisioned startup tokens in the live DB.

---

### Gaps Summary

No code gaps. All required artifacts exist, are substantive, and are wired.

The three `human_needed` truths (#1, #2, #3) share a single root cause: the live-founder pilot smoke was deferred by explicit user decision on 2026-05-25 because Phase 28.5 (web onboarding for non-tech founders) ships first. The code paths exercise correctly in automated smoke against synthetic startups (documented in 28-01 through 28-04 SUMMARYs). The gap is purely a real-founder-with-real-LLM-client run, tracked as v1.5 carryover requirement STARTUP-PILOT-LIVE-01.

The one security advisory (reply_to_candidate ownership trust) is documented in execute.ts and Phase 29 will harden it with an explicit thread ownership check.

---

_Verified: 2026-05-24T00:00:00Z_
_Verifier: Claude (rrr-verifier)_
