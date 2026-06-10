# Phase 26: Knowledge Graph + GenZ Polish — DRAFT PR

Branch: `rrr/v1.4/team-workspace-26` (per-phase off `main`)
Team: `team-workspace`
Milestone: v1.4 Pilot Readiness

---

## Summary

Phase 26 of v1.4 (Pilot Readiness). Closes the v1.3-backlog Workspace
upgrades: reuse the existing FalkorDB graph for cross-conversation
`:Employee` context in agent extraction (mirrors the student-app
`:Student` pattern), and add GenZ-friendly chat polish (Mattermost GIF
picker + canvas-confetti micro-animations + parrot-mascot loading
state) for the HS/college-intern audience.

**Scope correction surfaced by research:** Most of the KGRAPH track
(getEmployeeContext + recordTodoFact + the kimi-prompt prepend) was
**already shipped in Phase 14 Wave 2**. Phase 26 is mostly a
verification + small-add exercise: add the `:BLOCKED_BY` edge schema +
write the smoke/A-B harnesses + wire GenZ polish that uses
already-installed `canvas-confetti`.

## Plans

| # | Plan | Wave | Autonomous | Requirements | Status |
|---|------|------|------------|--------------|--------|
| 26-01 | KGRAPH verify + `:BLOCKED_BY` add + A/B harness | 1 | yes | KGRAPH-01..05 | Ready to execute |
| 26-02 | Confetti wiring + ParrotMascot stub + Mattermost GIF runbook | 1 | yes (code) + checkpoint (visual) + operator-deferred (GIF install) | GENZ-01..03 | Ready to execute |

All 2 plans Wave 1 — fully parallel (no file overlap: 26-01 touches
`workers/lib/` + `workers/durableObject/` + `scripts/`; 26-02 touches
`app/` + `docs/`).

## Success criteria (from ROADMAP.md)

1. Workspace agent extraction reads `getEmployeeContext` from `:Employee`
   namespace + prepends to kimi extraction prompt
2. Post-extraction fire-and-forget writes new `:Todo` + `:MENTIONS` +
   `:BLOCKED_BY` edges into `:Employee` namespace
3. Cross-namespace isolation verified — `:Employee` queries return zero
   `:Student` nodes and vice versa (smoke test)
4. Qualitative A/B comparison on 10 real extractions shows reduced
   duplicate-todo rate
5. Mattermost GIF/sticker plugin live + first-todo-cleared +
   5-emails-responded confetti animations + parrot-mascot loading
   state replaces generic spinner

## Decision locks (from planner — not up for re-debate at execute time)

- **KGRAPH-01..03 are verify-not-build** — `getEmployeeContext` (graph.ts:737–784, 1500-char cap, `<employee_context>` XML wrap) + `recordTodoFact` (graph.ts:321–472) + the `contextBlock` prepend (ai.ts:250–252, `cf-aig-cache-ttl: 0`) all shipped in Phase 14 Wave 2. Plan runs grep-verify only.
- **`:BLOCKED_BY` source: kimi schema change** — `blocked_by_ids?: string[]` added to `ExtractedTodo`, propagated through `recordTodoFact` via `durableObject/index.ts` call sites.
- **`:BLOCKED_BY` write is NOT gated by `!skipped`** (unlike `:MENTIONS`) — blocker discovery on re-run is meaningful, MERGE is idempotent, retroactive add is safe.
- **5-emails counter: per-session localStorage** (`parrot_emails_responded_count`) — resets on reload, intentional fresh-celebration.
- **first_todo_resolved trigger:** wired inside existing `disappeared.length > 0` block in `dashboard.tsx`.
- **Parrot mascot:** `🦜` emoji + `animate-bounce` in `ParrotMascot.tsx`. Illustrated SVG deferred to v1.5.
- **Mattermost GIF plugin: operator-deferred** — runbook at `apps/parrot/docs/genz-mattermost-gif-runbook.md`. Tenor provider (free, no billing). Pre-flight `mmctl version` check required.

## Dependencies + heads-up

- **Phase 25 code does NOT need to be merged first** — Phase 26's
  code scope (KGRAPH writers + GenZ frontend) is orthogonal to
  Phase 25 (mmctl SSO + admin brand refit + dep cleanup). Per-phase
  branches off `main`; coordinator handles merge order independently.
- **Mattermost GIF plugin install** is operator-deferred (needs
  Mattermost admin + Tenor API key). Can roll into same operator window
  as Phase 23 + 25 deferrals.
- **canvas-confetti is already installed** (`^1.9.4` in
  `apps/parrot/package.json:35`); `confetti.ts` infrastructure
  exists; the `"first_todo_resolved"` event is already in the
  `ConfettiEvent` union. Only `"5_emails_responded"` needs adding
  + the 3 trigger wires.

## Test plan

- [ ] `cd apps/parrot && npx tsc --noEmit` — Workspace Worker + frontend
      typecheck passes
- [ ] 26-01 smoke: `node scripts/26-kgraph-smoke.mjs` — `:Employee`
      label-isolated queries return zero `:Student` nodes (and vice
      versa)
- [ ] 26-01 A/B harness: `node scripts/26-kgraph-ab.mjs` — runs same
      10 extraction inputs through extraction-with-prepend and
      extraction-without-prepend; emits side-by-side diff
- [ ] 26-01 grep verify: `grep "blocked_by_ids" apps/parrot/workers/lib/ai.ts`
      returns matches in `ExtractedTodo` schema; `grep "BLOCKED_BY"
      apps/parrot/workers/lib/graph.ts` returns the MERGE Cypher
- [ ] 26-02 grep verify: `grep "parrot_emails_responded_count"
      apps/parrot/app/components/ComposePane.tsx` returns the counter
      increment; `grep "fireConfetti.*first_todo_resolved"
      apps/parrot/app/routes/dashboard.tsx` returns the trigger;
      `grep "ParrotMascot" apps/parrot/app/routes/dashboard.tsx`
      returns the mount
- [ ] 26-02 visual verify (deferred): Chrome → clear a todo → confetti
      fires; send 5 emails in a session → confetti fires; dashboard
      load → parrot-mascot bounces instead of generic spinner
- [ ] 26-02 GIF plugin (operator-deferred): `mmctl plugin add`
      runbook executed; Tenor API key in plugin config; GIF picker
      reachable from chat composer
- [ ] `rrr-verifier` agent VERIFICATION.md status: `passed` (or
      `human_needed` with explicit Mattermost GIF + visual deferrals)

## RRR workflow

```bash
# 1. Plan-phase already ran (this branch). Plans live in
#    .planning/milestones/v1.4-pilot-readiness/phases/26-knowledge-graph-genz-polish/

# 2. Execute both plans (Wave 1 parallel)
/rrr:execute-phase 26 --team team-workspace

# 3. When complete, submit for coordinator integration review
/rrr:submit-phase 26 --team team-workspace
```

The `--team team-workspace` flag is **required** — without it, RRR
mutates the root `.planning/STATE.md` which is coordinator-owned in
team mode.

## Phase 23 + 25 + ongoing context

Read before executing if you haven't:

- `.planning/STATE.md` — current coordinator state (READ ONLY in team mode)
- `.planning/ROADMAP.md` — Phase 26 entry (line ~159) for full spec
- `.planning/REQUIREMENTS.md` — req IDs KGRAPH-01..05, GENZ-01..03
- `.planning/milestones/v1.4-pilot-readiness/phases/26-knowledge-graph-genz-polish/26-RESEARCH.md`
  — research findings (KGRAPH is mostly already shipped)
- `apps/parrot/workers/lib/graph.ts` — Workspace graph helper (already
  has getEmployeeContext + recordTodoFact from Phase 14)
- `apps/parrot/workers/durableObject/index.ts` — kimi extraction call
  sites (need blockedByIds wiring at ~line 970 + ~line 1163)

## Coordinator (Raj) handles

- Final merge to `main` after `/rrr:submit-phase`
- ROADMAP.md + REQUIREMENTS.md status updates
- Cross-team dependency tracking
- Phase 26 → 27 sequential team-workspace ordering

🤖 Generated with [Claude Code](https://claude.com/claude-code)
