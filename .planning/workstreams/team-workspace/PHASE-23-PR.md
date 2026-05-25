# Phase 23: Workspace Pilot Closeouts — DRAFT PR template

Paste this as the PR body when opening the draft PR for the team-workspace
v1.4 branch. Title suggestion below; body follows.

---

## PR title

```
feat(v1.4-phase-23): Workspace pilot closeouts — closeTodoFact + Lakera email + attachments + agent UAT
```

(Keep ≤70 chars — GitHub clips longer titles in the PR list.)

---

## Open the draft PR

```bash
# From repo root, after your first commit on the branch
git push -u origin rrr/v1.4/team-workspace

gh pr create \
  --base main \
  --draft \
  --title "feat(v1.4-phase-23): Workspace pilot closeouts — closeTodoFact + Lakera email + attachments + agent UAT" \
  --body-file .planning/workstreams/team-workspace/PHASE-23-PR.md
```

(The body the command sends is THIS FILE — fine to leave the “DRAFT PR template” header in the rendered PR; reviewers know to skim past it.)

---

## Summary

Phase 23 of v1.4 (Pilot Readiness). Closes the v1.3-shipped-but-incomplete
Workspace items so Workspace is functionally pilot-ready. Owns the
employee-facing surface — code paths use `apps/parrot/` but in narrative we
say **Workspace** (the `parrot` directory name predates a now-deleted Neon
project of the same name).

**Goal:** Workspace is functionally pilot-ready end-to-end:
agent reply triggers todo auto-clear, employee email path is Lakera-screened
the same way the student SMS path is, attachments download, agent-lift UI
features work in a live authenticated UAT.

This phase was blocked on Phase 22 (Lakera v2 schema verification +
`screen.mjs` / `safety.ts` parser fix). **Phase 22 shipped 2026-05-24**
(see `.planning/milestones/v1.4-pilot-readiness/phases/22-lakera-verification/22-VERIFICATION.md`),
so Phase 23 is unblocked.

## Plans

| # | Plan | Requirements | What it ships |
|---|---|---|---|
| 23-01 | `closeTodoFact` Cypher helper + reply-path integration + structured logging | CLOSETODO-01..04 | Wires up the `:Todo.valid_to` writer in FalkorDB so the v1.3 Phase 19 auto-clear cron (currently inert) can actually close todos. Without this, every "resolution acknowledgement" reply we send leaves the linked SQLite todo open. |
| 23-02 | Workspace email injection test (Lakera v2 on employee email path) | SAFETY-VERIFY-LIVE-04 | Verifies the Lakera v2 parser landed in 22-01 also blocks injection attempts on the Workspace email path, not just the student SMS path. Should mirror 22-02's 3–5 live test cases but emit `safety_events` rows with `channel='email'`. |
| 23-03 | Attachment download route + auth + EmailPanel wire-up | ATTACH-DOWN-01..03 | Adds the auth-gated attachment download endpoint to the Workspace Worker; wires the existing `EmailPanel` attachment chips to hit it. Today clicking an attachment 404s in both Chrome and Safari. |
| 23-04 | 14-step authenticated UAT for agent-lift features | AGENT-UAT-01..03 | End-to-end UAT covering `AgentPanel` (summarize / draft / translate quick actions) and `MCPPanel` (11 workspace MCP tools — note: these are the **internal** Workspace MCP tools, NOT the 4-tool startup-MCP shipped in Phase 28). |

Plan files live in
`.planning/milestones/v1.4-pilot-readiness/phases/23-workspace-pilot-closeouts/`
once `/rrr:plan-phase 23 --team team-workspace` runs.

## Success criteria (from ROADMAP.md)

1. Agent reply containing resolution-acknowledgement phrase writes
   `:Todo.valid_to` in FalkorDB; next auto-clear tick closes the linked
   SQLite todo within 30s; todo appears in Resolved view.
2. Injection email from a non-`startup_members` sender is silently
   hard-blocked; `safety_events` row written with no auto-reply.
3. Clicking an attachment in Workspace inbox downloads the file in
   Chrome + Safari (no 404).
4. `AgentPanel` quick actions (summarize, draft, translate) return live
   LLM results in production within 10s.
5. `MCPPanel` lists all 11 internal Workspace MCP tools and tool calls
   return non-error responses.

## Dependencies + heads-up

- **Phase 22 must be on `main` before merging this** — `screen.mjs` /
  `safety.ts` parser changes from 22-01 are the foundation for 23-02.
  ✓ Already on `main` as of 2026-05-24.
- **Phase 19's todo auto-clear cron is inert today** — it ships and runs
  but does nothing because the writer (`closeTodoFact`) was never
  implemented. 23-01 fixes that. The moment 23-01 merges, the cron
  starts closing real todos within 30s of an acknowledgement reply.
- **FalkorDB writes go through the Fly `graph-api` proxy** (v1.3 Phase 18),
  not from the Worker directly. Pattern lives at
  `infra/graph-api/src/index.mjs` — add a new POST endpoint that wraps the
  `closeTodoFact` Cypher and call it from the Workspace Worker reply path
  via `STARTUP_API_SECRET`-style Bearer auth. Don't add a new Postgres
  driver to the Worker.
- **MCPPanel ≠ Phase 28 startup-MCP.** The 11 tools listed by
  `MCPPanel` are the *internal* Workspace MCP server (employee-facing,
  e.g., `summarize_thread`, `draft_reply`, `translate`, etc.). The 4-tool
  Stainless-style MCP server I shipped in Phase 28 lives at
  `mcp.internjobs.ai` and is *startup-facing*. Two separate servers, two
  separate purposes — don't conflate them in test design.
- **Naming reminder:** code says `parrot`, narrative says `Workspace`.
  See `.claude/projects/memory/project-app-naming.md`.

## Lakera test inputs (for 23-02)

22-02 ran 9 hard-block test cases live in production against the student
SMS path. Reuse 3–5 of them for the employee email path. Expected output:
`safety_events` rows with `action='blocked'`, `channel='email'`, and
`source_id` set to the inbound email's message-id. The `screen.mjs`
binary-flag parser from 22-01 should hit identically for the email path
— if it doesn't, that's a bug in the helper wiring, not the parser
itself.

## Test plan

- [ ] `cd apps/parrot && npm test` — Vitest smoke tests pass on
      Workspace Worker
- [ ] `cd apps/agentic-inbox && npm test` — Inbox tests pass
- [ ] 23-01: send a test reply with phrase "got it, will do" → check
      FalkorDB for `:Todo.valid_to` set within 5s; wait for next cron
      tick (≤30s); verify SQLite todo flipped to `resolved_at IS NOT NULL`
- [ ] 23-02: send 3 injection-attempt emails to a Workspace-monitored
      inbox; expect `safety_events` rows with `action='blocked'`,
      `channel='email'`; expect zero auto-reply drafts in `drafts` table
- [ ] 23-02: send 1 benign email; expect zero `safety_events` rows;
      expect normal draft in `drafts` table
- [ ] 23-03: in Workspace inbox UI, click attachment chip in Chrome →
      file downloads with correct filename and MIME; repeat in Safari
- [ ] 23-04: open `/agent-uat` (or wherever the UAT harness lives) and
      walk all 14 steps; capture pass/fail per step in
      23-04-SUMMARY.md
- [ ] `node ~/.claude/rrr/lib/inline-status.js` shows 4/4 plans complete
- [ ] `rrr-verifier` agent VERIFICATION.md status: `passed` (or
      `human_needed` with explicit deferral, not `gaps_found`)

## RRR workflow

```bash
# 1. (Optional) Adaptive Q&A before planning
/rrr:discuss-phase 23 --team team-workspace

# 2. Generate the 4 plan files
/rrr:plan-phase 23 --team team-workspace

# 3. Execute all 4 plans
/rrr:execute-phase 23 --team team-workspace

# 4. When complete, submit for coordinator integration review
/rrr:submit-phase 23 --team team-workspace
```

The `--team team-workspace` flag is **required** — without it, RRR
mutates the root `.planning/STATE.md` which is coordinator-owned in
team mode. With it, RRR writes to
`.planning/workstreams/team-workspace/STATE.md` and your work doesn't
collide with team-cms's work on `main`.

## Phase 22 + 28 + ongoing context

Read before starting if you haven't:

- `.planning/STATE.md` — current coordinator state
- `.planning/ROADMAP.md` — Phase 23 entry (line ~75) for full spec
- `.planning/REQUIREMENTS.md` — req IDs CLOSETODO-01..04,
  SAFETY-VERIFY-LIVE-04, ATTACH-DOWN-01..03, AGENT-UAT-01..03
- `.planning/milestones/v1.4-pilot-readiness/phases/22-lakera-verification/22-01-SUMMARY.md`
  — the Lakera v2 binary-flag parser pattern you'll mirror for the email path
- `apps/parrot/workers/lib/safety.ts` — Workspace-side Lakera helpers
  already exist from Phase 20; just need the email-path wire-up + test

Phase 28 (startup MCP) shipped in parallel on `main` 2026-05-25 — it
doesn't touch Workspace. The only thing to be aware of: the migrations
0011 + 0012 added `startup_channel_links`, `startup_action_log`,
`outbound_messages`, and `inbound_messages.startup_mark` to the
student-app DB. Workspace doesn't use those, but they're on `main` if
your tests query DB schema.

## Coordinator (Raj) handles

- Final merge to `main` after `/rrr:submit-phase`
- ROADMAP.md + REQUIREMENTS.md status updates
- Cross-team dependency tracking
- Phase 22 → 23 verification handoff

🤖 Generated with [Claude Code](https://claude.com/claude-code)
