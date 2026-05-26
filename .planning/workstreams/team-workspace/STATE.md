---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "in-progress"
last_activity: "2026-05-27 — Plans 26-01 and 26-02 both code-complete; visual verify + Mattermost install operator-deferred"
last_plan_closed: "26-02"
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

Status: Plans 26-01 AND 26-02 both code-complete — Phase 26 closeout pending operator window
Current phase: 26-knowledge-graph-genz-polish
Current plan: 26-02 closed (code-complete / browser-verify-deferred)
Blockers: None
Last commits (26-01): 41d8412 (Task 1 :BLOCKED_BY schema — see Deviations note in 26-02 SUMMARY for restore history; functionally identical to the originally-planned 6d44eb0), 6e4f9a9 (Task 2 smoke + A/B scripts), 7d2ac00 (closeout)
Last commits (26-02): 7500952 (Task 1 confetti + dashboard wire), 0216d3d (Task 2 ComposePane + mascot + runbook)

## Phase 26 Plan Map

| Plan | Track | Autonomous | Wave | Status |
|------|-------|-----------|------|--------|
| 26-01 | KGRAPH (verify + :BLOCKED_BY) | true | 1 | **Complete (2026-05-27)** — KGRAPH-01..03 grep-verified live; :BLOCKED_BY edge shipped in `recordTodoFact`; KGRAPH-04/05 smoke + A/B scripts ready for operator |
| 26-02 | GENZ polish (confetti + mascot + GIF runbook) | true (code); operator-deferred (GIF install) | 1 | **Closed (2026-05-27)** — code-complete / browser-verify-deferred. GENZ-02 + GENZ-03 wired (tsc 0 errors). GENZ-01 runbook shipped; install pending operator. |

Wave 1: 26-01 and 26-02 ran parallel on one branch — no file overlap (26-01 = `apps/parrot/workers/*` + `scripts/`; 26-02 = `apps/parrot/app/*` + `apps/parrot/docs/`).

## Open Items — Operator Handoff (Phase 26)

| Item | Plan | Owner | Where | Blocker |
|------|------|-------|-------|---------|
| Browser visual verify (mascot render + confetti console-clean) | 26-02 (Task 3) | Operator | Dev/pilot Worker | Executor has no deployed Worker access |
| Mattermost GIF plugin install (GENZ-01) | 26-02 | Operator | chat.internjobs.ai via `mmctl` | `mmctl` auth + Tenor API key out-of-environment |
| KGRAPH-04 smoke run + KGRAPH-05 A/B harness | 26-01 | Operator | Production data | Per 26-01 closeout — scripts ready, operator window required |

Both 26-02 items are fully documented:
- Visual verify steps in `26-02-SUMMARY.md` ("Operator Handoff" section).
- Mattermost install runbook at `apps/parrot/docs/genz-mattermost-gif-runbook.md`.

## Decisions (cumulative)

- :BLOCKED_BY edge source = kimi schema field (`ExtractedTodo.blocked_by_ids`), not regex heuristic. Pattern mirrors `mentioned_actors`.
- :BLOCKED_BY MERGE is NOT gated by `!skipped` (unlike :MENTIONS) — retroactive blocker discovery on re-run is meaningful + idempotent.
- :Blocker nodes are stub nodes keyed by description text only (no canonicalization yet; v1.5 candidate for embedding-similarity dedupe).

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".

### Phase 26 key decisions locked

- KGRAPH-01..03 are verify-not-build (code shipped Phase 14 Wave 2).
- :BLOCKED_BY edge: kimi schema change (blocked_by_ids field added to ExtractedTodo).
- 5-emails confetti counter: localStorage per-session (key: parrot_emails_responded_count). [Shipped 26-02 in 0216d3d]
- first_todo_resolved trigger: inside existing polling diff disappeared.length > 0 block. [Shipped 26-02 in 7500952]
- Parrot mascot: emoji stub (🦜 + CSS bounce) in ParrotMascot.tsx. v1.5 candidate for illustrated SVG at apps/parrot/public/mascot-parrot.svg. [Shipped 26-02 in 0216d3d]
- Mattermost GIF plugin (GENZ-01): operator-deferred. Runbook at apps/parrot/docs/genz-mattermost-gif-runbook.md. [Runbook shipped 26-02; install pending operator]
- Tenor API key: operator provisions via Google Cloud Console (free tier). GIPHY rejected — paid tier required for new keys.
