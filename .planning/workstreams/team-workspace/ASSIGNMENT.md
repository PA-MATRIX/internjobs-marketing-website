# team-workspace Assignment

Milestone: v1.5
GitHub org: PA-MATRIX
GitHub team: @PA-MATRIX/team-workspace
Branch prefix: rrr/v1.5/team-workspace-<phase>
Integration base: integration/v1.5 (cut off main; inherits CH-01 per-phase markers + the integration/** ruleset)
Sprite: rrr-internjobs-marketing-website-v1-5-team-workspace

> **Whole-milestone assignment (2026-06-30):** Nithin owns **all of v1.5** — both the
> Workspace track (W1) and the startup pilot go-live track (S1–S4). team-cms is idle
> this milestone. Coordinator (Raj) reviews + merges PRs and runs the account-gated ops
> steps (see caveat below).

## Scope

Beyond the usual Workspace surfaces, v1.5 extends this workstream to the startup pilot
apps for go-live:

- `apps/parrot/` — Workspace Worker (workspace.internjobs.ai) — **W1**
- `apps/startup/` — Startup MCP Worker (mcp.internjobs.ai) — **S2/S3**
- `apps/startups/` — Startups web app (startups.internjobs.ai) — **S1/S3**
- `apps/app/` — student SMS path (Lakera) — **S4**
- `apps/agentic-inbox/`, `infra/graph-api/`, `infra/mattermost-db/`

## Assigned Phases

Work them in order; each is one PR into `integration/v1.5`.

| Phase | Track | What | Ready-when | Pointer |
|-------|-------|------|-----------|---------|
| **32** | W1 | Workspace **SMS/phone → Parrot** — wire the SMS + phone-call panes as thin entry points into ParrotAgent (Telnyx + Cloudflare Voice). Integrate the real backing service; **do NOT reinvent the UX.** Completes the tripod (Mail→Agent-Inbox phase 30, Chat→Mattermost phase 31 already shipped). | panes route to ParrotAgent live; no redesigned UI | `project-workspace-true-integration` intent; `project-phone-sms-architecture` |
| **33** | S1 | **Startups web app go-live** — execute the 12-step deferred-ops runbook (DNS, Email Routing domain verification, `STARTUPS_CLERK_*` secrets → Infisical, Clerk webhook). | `startups.internjobs.ai` + per-startup agent email live | `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/PHASE-28.5-DEFERRED-OPS.md` |
| **34** | S2 | **Telnyx SMS + Voice AI go-live** — execute the 22-step deferred-ops runbook (Telnyx signup + toll-free number + BRN + API key + Voice AI portal + R2 + KV + cron). | inbound SMS + voice-intake onboarding live | `.planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/PHASE-29-DEFERRED-OPS.md` |
| **35** | S3 | **First live pilot install** — real founder installs MCP (or web-onboards) and completes `me()` + `post_role` + `search` + `reply`; record evidence. Depends on 33/34. | evidence recorded in PILOT-EVIDENCE.md | `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md` |
| **36** | S4 | **Lakera fail-open + tier confirm** — run the deferred fail-open test (if pilot-critical) + confirm tier/quota for pilot volume. | fail-open verified + tier confirmed | `infra/LAKERA-PRICING.md` |

## How to pick up this milestone

```bash
# 0. sync + read your assignment
git checkout main && git pull
cat .planning/workstreams/team-workspace/ASSIGNMENT.md   # this file
cat TEAM-WORKFLOW.md                                     # the gate + submit flow

# 1. start a phase off the integration branch (NOT main)
git fetch origin
git switch -c rrr/v1.5/team-workspace-32 origin/integration/v1.5

# 2. plan + build the phase (your local RRR)
#    /rrr:plan-phase 32  ->  /rrr:execute-phase 32   (or just build it)

# 3. submit — writes the per-phase marker the gate enforces
node scripts/submit-phase.mjs --team team-workspace --phase 32 --ready --tests typecheck,vitest,uat
git add .planning/workstreams/team-workspace/submissions/32.json
git commit -m "submit(32): ready for integration"

# 4. open the PR into integration/v1.5 (coordinator reviews + merges)
gh pr create --base integration/v1.5 --fill

# 5. next phase branches off the UPDATED integration/v1.5, repeat for 33->36
```

When all five phases are merged into `integration/v1.5`, the coordinator promotes
`integration/v1.5 -> main`.

## Operating Rules

- Work on `rrr/v1.5/team-workspace-<phase>` off `integration/v1.5`, never directly on `main`.
- One phase = one per-phase marker `submissions/<phase>.json` (CH-01). The submission gate
  blocks the PR until the marker names your branch + phase and is `ready_for_integration: true`.
- The coordinator merges; the gate ensures unsubmitted work can't be merged.
- **Account-gated ops (S1–S4):** several steps need Raj's accounts (Cloudflare DNS/Email,
  Telnyx signup + number purchase, Clerk secrets, Infisical writes). Do the code/config, and
  hand the credential-gated steps to Raj (or get access first). Never paste secrets into the
  repo or chat — they go to Infisical (`prod` / `/internjobs-ai`).
