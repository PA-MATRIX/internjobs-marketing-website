# team-cms Assignment

Milestone: v1.4
GitHub org: PA-MATRIX
GitHub team: @PA-MATRIX/team-cms
Branch: rrr/v1.4/team-cms
Draft PR: (created during dispatch)
Sprite: rrr-internjobs-marketing-website-v1-4-team-cms

## Scope

Owns all external/customer-facing surfaces (despite the team name — "cms" is
shorthand, not literal-only):

- `apps/marketing/` — Marketing CMS, public site at `internjobs.ai`
- `apps/app/` — Student app, students-facing at `app.internjobs.ai`
- `apps/startup/` — Startup MCP server at `mcp.internjobs.ai` (shipped Phase 28)
- `apps/startups/` — Startups web app at `startups.internjobs.ai` (Phase 28.5 will create)
- `apps/mac-bridge/` — iMessage bridge for the Student app SMS/iMessage path
- `infra/startup-api/` — Fly REST proxy for the startup MCP path (shipped Phase 28)
- `infra/student-db/` — Student app's self-hosted Fly Postgres

## Assigned Phases

- **22** — Lakera Verification + Marketing Brand Refresh *(✓ shipped 2026-05-24)*
- **24** — Neon-Exit Closeout
- **28** — Startup MCP Server + Channel-Adapter Core *(✓ shipped 2026-05-25)*
- **28.5** — Startups Web App + Clerk #3 + Per-Startup Agent Email *(next)*
- **29** — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding

## Operating Rules

- Work on the assigned branch/PR, not directly on `main`.
- Use RRR commands with `--team` so root `.planning/STATE.md` is not mutated.
- Submit with `$rrr-submit-phase <phase> --team team-cms` when ready.
- GitHub reviews, required checks, and CODEOWNERS decide merge authority.
