---
schema_version: 2
milestone: "v1.0"
phase: 2
phase_name: "Clerk LinkedIn Waitlist Auth"
phase_total: 6
plan: 0
plan_total: 0
status: "ready_to_plan"
progress: 17
last_activity: "2026-05-09"
session_last: "2026-05-09"
resume_file: ""
blockers:
  - "Need LinkedIn OAuth app client ID/secret for Clerk provider configuration."
  - "Need Neon project/token or database connection string."
  - "Need Photon/Spectrum number, API credentials, webhook docs, and webhook secret."
  - "Need Clerk LinkedIn, Neon, and Photon/Spectrum secrets added to Projecta/MATRIX Infisical path /internjobs-ai."
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-09)

**Core value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current focus:** Clerk LinkedIn Waitlist Auth

## Current Position

Milestone: v1.0
Phase: 2 of 6 (Clerk LinkedIn Waitlist Auth)
Plan: 0 of 0 in current phase
Status: Ready to plan
Last activity: 2026-05-09 - Completed monorepo split and verified both marketing and app builds.

Progress: 17%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Total phases completed: 1

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

### Pending Todos

- Confirm external provider credentials for Clerk LinkedIn, Neon, and Photon/Spectrum.
- Plan Phase 2 implementation once Clerk LinkedIn credentials and redirect domains are ready.
- `app.internjobs.ai` DNS points to the Projecta Labs Fly app and returns `/healthz` successfully over HTTPS.
- Use Infisical as the secrets source of truth for Cloudflare DNS/API, Clerk, LinkedIn OAuth, Neon, Photon/Spectrum, and Fly runtime secrets.
- InternJobs.ai production secrets live in Projecta/MATRIX Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`.
- Checked `/Users/rajren/MATRIX/.infisical.json`: it points at Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`.
- Checked `/Users/rajren/MATRIX/.env.local`: Cloudflare variable names exist there, but the local values are empty placeholders.
- Do not use GrowthPods/SIOS/SuperIntelligence Cloudflare secrets for InternJobs.ai; this project should use Projecta Labs / InternJobs.ai credentials only.
- Saved and verified secret name `CLOUDFLARE_API_TOKEN` in Projecta/MATRIX Infisical `prod` path `/internjobs-ai`.

### Blockers/Concerns

- LinkedIn browser automation must not become production scraping without explicit legal/compliance approval.
- App and marketing should deploy separately, but stay in one repo until there is a real team/security reason to split repositories.
- Do not print Infisical secret values into chat, logs, or committed docs.

## Session Continuity

Last session: 2026-05-09
Stopped at: Phase 1 complete; ready to plan Clerk LinkedIn waitlist auth.
Resume file: None
