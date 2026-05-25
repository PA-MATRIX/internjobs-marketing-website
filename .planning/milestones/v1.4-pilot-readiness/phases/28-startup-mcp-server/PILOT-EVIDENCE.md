# PILOT-EVIDENCE.md — DEFERRED to v1.5

**Status:** deferred
**Reason:** Phase 28.5 (web onboarding at `startups.internjobs.ai`) is the path for the first non-tech pilot. The MCP-only install path will be exercised when a tech founder is identified.
**User decision:** 2026-05-25 — ship Phase 28 auto tasks (marketing CTA + channels grid + CHANNELS.md adapter doc), defer the live pilot install evidence until a real founder is lined up. Phase 28.5 ships next because most non-tech founders won't install MCP cold.

## Why this is `deferred` and not `failed`

All of Phase 28's MCP infrastructure is live and end-to-end smoke-verified:

| Component | Status | Evidence |
|---|---|---|
| Fly proxy (`internjobs-startup-api.fly.dev`) | LIVE | 28-01 SUMMARY |
| MCP Worker (`mcp.internjobs.ai`) | LIVE | 28-02 SUMMARY (Version `07f2d90b...`) |
| 4-tool surface (me, discover_actions, search, execute) | LIVE | 28-03 SUMMARY (20/20 smoke PASS) |
| Admin endpoint (`POST /admin/startups/new`) | LIVE | 28-04 SUMMARY (Version `6edfe500...`) |
| Marketing CTA (`POST /api/request-access`) | LIVE | 28-05 Task 1 (Version `8add12e0...`) |
| `/startups` form + channels grid | LIVE | 28-05 Task 2 |
| `CHANNELS.md` adapter doc | LIVE | 28-05 Task 1 |

What's missing is a **real founder** exercising the full path via a real LLM client (Claude Desktop / Claude Code / Cursor / ChatGPT). The 28-04 SUMMARY already documents a throwaway-startup smoke that proved:
- token round-trips `/v1/startups/token` → SHA-256 hash → startup context
- `tools/list` returns exactly 4 tools
- `tools/call me()` returns the correct startup context

But that smoke was synthetic (test-startup + curl). The original Plan 28-05 checkpoint asks for **a real founder** running the 4 canonical tool calls AND the audit log capturing the row writes.

## Acceptance criteria (to close STARTUP-PILOT-LIVE-01 in v1.5)

A real founder (or Raj as the surrogate) using a real client must succeed at:

1. **me()** returns `{startup, member, role_count, recent_activity}` with non-empty `startup.id`, non-empty `member.id`, and a sane `startup_name`.
2. **execute('post_role', {title, description, requirements?, location?, ...})** returns `{ok: true, data: {role_id}}` AND a row exists in the `roles` table with that id AND a row exists in `role_embeddings` with a 768-dim vector (Workers AI embedding succeeded).
3. **search('candidates', "frontend interns")** returns at least 1 ranked candidate via pgvector cosine similarity (`student_embeddings` join). Result envelope shape: `{scope: 'candidates', query, results: [...], total_returned, next_cursor}`.
4. **execute('reply_to_candidate', {thread_id, message})** returns `{ok: true}` AND an `outbound_messages` row exists with `channel='mcp'` and `student_id` matching the thread's student.
5. **`startup_action_log`** contains ≥ 4 rows from the above calls — at minimum `me`, `post_role`, `search:candidates`, `reply_to_candidate` — all with `status='ok'` and non-zero `latency_ms`.

## Recommended path to close

Two paths exist; pick whichever surfaces a real founder first:

### Path A — Phase 28.5 web onboarding (default)

1. Phase 28.5 ships (web onboarding at `startups.internjobs.ai` + per-startup agent email + Clerk #3).
2. First non-tech founder signs up via the web app and reads the install card with MCP snippets.
3. Even if the founder doesn't install MCP themselves, **Raj installs it as them** with the issued token (same token issued by Phase 28.5's extended `/admin/startups/new`) and runs the 4 calls from his own Claude Desktop / Cursor / ChatGPT.
4. Update this doc with the evidence; flip status to `verified`; close `STARTUP-PILOT-LIVE-01`.

### Path B — Tech founder direct install

1. A tech founder (someone already running Claude Code / Cursor / ChatGPT in their workflow) is identified.
2. Ridhi runs the existing 28-04 admin endpoint to issue them a token + install snippet.
3. Founder installs MCP themselves, runs the 4 calls, screenshots the LLM session.
4. Update this doc; close.

## Backlog tracking

- v1.5 carryover requirement: **STARTUP-PILOT-LIVE-01** — added to `.planning/ROADMAP.md` v1.5 Candidates → Carryovers section by Plan 28-05.

## Notes

- The MCP server itself is production-ready. Phase 28 is technically complete (all four prior plans shipped + Plan 28-05 auto tasks shipped). The pilot-evidence requirement is the one item we can't synthesize — it needs a real founder.
- If a sandboxed self-pilot is acceptable (Raj acting as both Ridhi AND the founder via his own Claude Desktop), this could be closed today. The user's 2026-05-25 decision was to wait for a real founder rather than dogfood-close.
- Throwaway smoke-test runs by Ridhi against synthetic startups are documented in 28-01/28-02/28-03/28-04 SUMMARYs and demonstrate every tool works against the live deploy. The gap is purely "real founder + real client + screenshots."

---

*Phase: 28-startup-mcp-server*
*Plan: 28-05*
*Created: 2026-05-25*
*Status: deferred*
