---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "in-progress"
last_activity: "2026-05-27"
---

# team-workspace Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode.

## Assignment

GitHub team: @PA-MATRIX/team-workspace
Branch: rrr/v1.4/team-workspace
Sprite: rrr-internjobs-marketing-website-v1-4-team-workspace
Phases: 26-knowledge-graph-genz-polish

## Current Position

Status: Planning complete — ready for execution
Current phase: 26-knowledge-graph-genz-polish
Current plan: —
Blockers: None

## Phase 26 Plan Map

| Plan | Track | Autonomous | Wave | Status |
|------|-------|-----------|------|--------|
| 26-01 | KGRAPH (verify + :BLOCKED_BY) | true | 1 | Not started |
| 26-02 | GENZ polish (confetti + mascot + GIF runbook) | true (code); operator-deferred (GIF install) | 1 | Not started |

Wave 1: 26-01 and 26-02 are parallel — no file overlap.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".

### Phase 26 key decisions locked

- KGRAPH-01..03 are verify-not-build (code shipped Phase 14 Wave 2).
- :BLOCKED_BY edge: kimi schema change (blocked_by_ids field added to ExtractedTodo).
- 5-emails confetti counter: localStorage per-session (key: parrot_emails_responded_count).
- first_todo_resolved trigger: inside existing polling diff disappeared.length > 0 block.
- Parrot mascot: emoji stub (🦜 + CSS bounce) in ParrotMascot.tsx. v1.5 candidate for illustrated SVG.
- Mattermost GIF plugin (GENZ-01): operator-deferred. Runbook at apps/parrot/docs/genz-mattermost-gif-runbook.md.
- Tenor API key: operator provisions via Google Cloud Console (free tier).
