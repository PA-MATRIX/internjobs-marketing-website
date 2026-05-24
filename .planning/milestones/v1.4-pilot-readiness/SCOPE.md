# v1.4 — DRAFT Scope (Pilot Readiness)

**Status:** Draft for review. Promote via `/rrr:new-milestone` after edits.
**Drafted:** 2026-05-24
**Predecessor:** v1.3 Pilot Hardening (3 of 4 phases shipped, Phase 21 skipped, Phase 19 inert)

---

## Driving Question

> "What do we close before opening the door to the first 5–10 pilot startups?"

v1.3 made the system *deployable*. v1.4 makes it *operable* — closes v1.3's dangling work, finishes the un-roadmapped Neon-exit, picks up the v1.3.1 candidates that have been sitting in the backlog, and absorbs the un-roadmapped feature work that's already shipped.

---

## What This Milestone Covers (proposed phase groups)

### Group A — Close v1.3 dangling work

| # | Item | Why | Effort | Source |
|---|---|---|---|---|
| A1 | `closeTodoFact(thread_id, resolution_text)` writer wired into Mastra reply path | Phase 19 cron is shipped but inert — no `:Todo.valid_to` writer in production. Auto-clear is dead code today. | ~50 LOC | `ROADMAP.md` v1.3.1 candidates, `STATE.md` blocker, `CONCERNS.md` line 22 |
| A2 | Phase 20 Lakera verification tests (injection / benign / fail-open) actually run in production | Tests exist (`screen.test.mjs`) but the 3 production-path SAFETY-VERIFY tests per SHIP-READY §1.3 step 10 have never executed | ~1 hr ops | `HANDOFF.md §3.2` |
| A3 | Lakera v2 schema verification (post-Cisco acquisition) | `safety.ts:17` annotated "assumed — verify post-Cisco-acquisition." Could ship and silently fail-open forever. | ~1 hr research + parser tweak | `CONCERNS.md` line 87 |
| A4 | Attachment download endpoint `GET /api/inbox/messages/:id/attachments/:id` | Metadata renders, downloads 404. Lifted from agentic-inbox but route not bound. | ~15 LOC | `HANDOFF.md §3.5`, `CONCERNS.md` STORAGE-02 |
| A5 | Authenticated UAT for chat/email/agent-lift (HANDOFF §3.4) | 14-step plan in `V1_3_1-AGENT-LIFT-REPORT.md` blocked only on a fresh Parrot OTP session | 1 hr | `HANDOFF.md §3.4` |
| A6 | Phase 21 credential rotation — decision: defer further or execute | User skipped at v1.3 ("sole user"). Will need to be honest with ourselves before the first pilot user signs in. | 90 min ops if executed | `SHIP-READY.md §1.4` |

### Group B — Neon-exit closeout (migration ✅ done 2026-05-21)

Per `infra/NEON-EXIT.md`: all 3 Neon projects deleted; `internjobs-mattermost-db` + `internjobs-student-db` live on Fly. Migration itself is done. Remaining cleanup:

| # | Item | Why | Effort |
|---|---|---|---|
| B1 | End-to-end verification of `safety_events` writes through new student-app `/internal/safety-events` API (Parrot Worker → student API → Fly Postgres) | New write path is live but no contract test exists; this is the Neon-exit code-change that needs validation per NEON-EXIT.md ⚠️ note | ~2 hr |
| B2 | Remove orphan `@neondatabase/serverless` dep from `apps/parrot/package.json:22` | Dead dependency; ~5 min cleanup | ~5 min |
| B3 | Update planning docs — `HANDOFF.md §4` still claims "One Neon database"; `infisical-project` memory references stale topology; ROADMAP.md should note Neon-exit completion | Drift between docs and reality | 30 min docs |

### Group C — v1.3 carryovers from `[[parrot-agent-roadmap]]` memory

Originally tagged for v1.3 in the 2026-05-19 verification session but never made it into the v1.3 roadmap. **Verify each is still current before committing.**

| # | Item | Why | Effort |
|---|---|---|---|
| C1 | Mattermost OIDC SSO activation (mmctl one-shot) | OIDC bridge code shipped at `apps/parrot/workers/routes/oidc.ts` but Mattermost isn't pointed at it. Users still sign in to chat separately. | ~30 min ops |
| C2 | Knowledge graph reuse for Parrot agent (FalkorDB same-instance, separate `:Employee` namespace) | Phase 18 unblocks this. Quality plateau in Phase 12 extraction without cross-channel context. | 1–2 days |
| C3 | Admin invite UX gaps — capability toggles editable post-invite, frontend admin page | Backend exists, frontend missing | 1–2 days |
| C4 | GenZ chat polish — Mattermost GIF picker, canvas-confetti micro-animations | "Most employees are HS/college interns, make chat very GenZ" — 2026-05-19 user ask | 1 day |

### Group D — Polish (deferrable, but candidates)

| # | Item | Why | Effort |
|---|---|---|---|
| D1 | DAILY-THEME-01 retry (Campus Aurora theme on Daily.co Prebuilt) | 3 safe paths documented (dashboard, dynamic-import, daily-react hook). Earlier attempt reverted. | 0.5 day |
| D2 | Daily.co vanity domain `meet.internjobs.ai` | Decision deferred from v1.3; revisit only if pilot reveals high external share volume + plan-upgrade economics work | ~$99/mo + 1 line code |
| D3 | Star-toggle API wired in EmailPanel | Visible UI affordance that does nothing | ~10 LOC |
| D4 | Deprecated `formatQuotedDate` cleanup — migrate callers to `packages/shared/src/dates` | 3 files with `@deprecated` re-exports | ~1 hr |

### Group E — Test coverage debt (from CONCERNS.md)

Worth promoting to a real phase given test surface is approximately zero on the highest-traffic code:

| # | Item | Files |
|---|---|---|
| E1 | Parrot Worker route + DO method test coverage (currently 0 `.test.ts` files) | `apps/parrot/workers/**` |
| E2 | agentic-inbox Worker test coverage (currently 0 `.test.ts` files) | `apps/agentic-inbox/workers/**` |
| E3 | INTEG-01 11-step two-sided smoke executed end-to-end in production | `.planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md` §E |

---

## Proposed Phase Breakdown

**Conservative (4 phases, ~5–7 days):**
- **Phase 22 — v1.3 Closeout**: A1, A2, A3, A4, A5, B1, B2
- **Phase 23 — Auth + Workspace Glue**: C1, C3 (Mattermost SSO activation + admin UX)
- **Phase 24 — Agent Quality**: C2 (knowledge graph reuse — biggest win)
- **Phase 25 — Polish + Test Floor**: C4, D1, D3, D4, E1 (worker route smoke tests at minimum)

**Aggressive (split A1+A2 first, faster pilot):**
- **Phase 22 — Pilot-blocking Closeouts (A1+A2+A3+A4+A5)** — 2 days, can ship to a single pilot
- Defer Neon-exit, knowledge graph, GenZ polish to v1.5

**Skip / explicitly defer:**
- A6 (Phase 21 rotation) — defer until first pilot user identifiable (auditable user → real rotation reason)
- D2 (vanity Daily.co domain) — defer until external share volume justifies $99/mo
- E2/E3 (deep test coverage) — defer to v1.5 once feature surface is stable

---

## Open Questions for the User (answer before promoting to milestone)

1. **Pilot timing:** Are we trying to land first 5–10 pilots inside v1.4, or is v1.4 still pre-pilot prep? Answers shape whether A6 (Phase 21) is in or out.
2. **Neon-exit urgency:** Is decommissioning Neon a v1.4 must (cost) or a v1.5 nicety (it works today, just dual-paid)?
3. **GenZ polish scope:** "Mattermost GIF picker + confetti" or "full youth-coded UX pass" (different time budgets)?
4. **Test floor:** Are we willing to require a Worker route smoke test before any PR merges, or stay manual-smoke-only?
5. **Knowledge graph (C2):** Worth a dedicated phase, or fold into "phase 24 = Mattermost SSO + admin UX + knowledge graph"?

---

## What This Milestone DOES NOT Cover

Explicitly out of scope, surface here so we don't get sucked in:

- **Telnyx SMS/Phone activation** (A2P 10DLC takes weeks; gated on regulatory approval). Future phase.
- **Cognee / Sprite.dev / Bright Data deeper activation** beyond what already exists — legal-gated per `SCOPE_CACHE.md`.
- **Mastra workflow rewrites** — Mastra is pre-1.0; pin and watch, don't upgrade.
- **Mac bridge alerting / HA** — single-Mac-mini fragility (`CONCERNS.md` line 137) is acknowledged but accepted for pilot scale.

---

## Promotion Checklist

Before running `/rrr:new-milestone v1.4`:

- [ ] User answers the 5 open questions above
- [ ] Phase grouping confirmed (conservative vs aggressive)
- [ ] Pilot-launch criteria defined (what MUST be true before first user signs in)
- [ ] Update `MEMORY.md` references that contradict reality (Neon-exit, parrot-agent-roadmap memory may need refresh)
- [ ] Delete or rename this draft once formal milestone exists

---

## File References

**Sources for this draft:**
- `.planning/ROADMAP.md` (v1.3.1 candidates section)
- `.planning/HANDOFF.md` (§3.2, §3.3, §3.4, §3.5)
- `.planning/milestones/v1.3-pilot-hardening/SHIP-READY.md`
- `.planning/codebase/CONCERNS.md` (Tech Debt, Known Bugs, Security, Missing Features, Test Coverage Gaps)
- `~/.claude/projects/-Users-rajren-internjobs-cms/memory/project-parrot-agent-roadmap.md`
- `~/.claude/projects/-Users-rajren-internjobs-cms/memory/project-dailyco-vanity-domain.md`
- git log since `3331e73` (SHIP-READY commit) to `5df9222`
