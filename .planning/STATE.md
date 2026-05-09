---
schema_version: 2
milestone: "v1.0"
phase: 2
phase_name: "Clerk LinkedIn Waitlist Auth"
phase_total: 6
plan: 0
plan_total: 0
status: "implementation_complete_external_activation_pending"
progress: 81
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
**Current focus:** External provider activation for Clerk LinkedIn, Neon, and Photon/Spectrum

## Current Position

Milestone: v1.0
Phase: v1.0 implementation sweep complete; external activation pending
Plan: 0 of 0 in current phase
Status: Implementation complete with provider activation blockers
Last activity: 2026-05-09 - Built waitlist app foundation, added migrations, QR/channel pairing, webhook handling, profile context, launch guardrails, and browser verification artifacts.

Progress: 81%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Total phases completed: 3

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

### Pending Todos

- Confirm external provider credentials for Clerk LinkedIn, Neon, and Photon/Spectrum.
- Configure Clerk LinkedIn provider and production redirect/JWKS URLs.
- Create Neon project, set `DATABASE_URL`, and run `npm --workspace @internjobs/app run migrate`.
- Buy/configure Photon/Spectrum number, outbound API token, and inbound webhook secret.
- Sync Clerk, Neon, and Photon/Spectrum secrets from Projecta/MATRIX Infisical path `/internjobs-ai` into Fly.
- Deploy the app after secrets are synced, then run production smoke checks.
- `app.internjobs.ai` DNS points to the Projecta Labs Fly app and returns `/healthz` successfully over HTTPS.
- Use Infisical as the secrets source of truth for Cloudflare DNS/API, Clerk, LinkedIn OAuth, Neon, Photon/Spectrum, and Fly runtime secrets.
- InternJobs.ai production secrets live in Projecta/MATRIX Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`.
- Checked `/Users/rajren/MATRIX/.infisical.json`: it points at Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`.
- Checked `/Users/rajren/MATRIX/.env.local`: Cloudflare variable names exist there, but the local values are empty placeholders.
- Do not use GrowthPods/SIOS/SuperIntelligence Cloudflare secrets for InternJobs.ai; this project should use Projecta Labs / InternJobs.ai credentials only.
- Saved and verified secret name `CLOUDFLARE_API_TOKEN` in Projecta/MATRIX Infisical `prod` path `/internjobs-ai`.
- Implemented app routes: `/waitlist`, `/onboarding`, `/pairing`, `/profile`, `/webhooks/photon`, `/healthz`, `/config/status`, and `/ops/privacy`.
- Added Neon-ready migration `apps/app/db/migrations/0001_waitlist_foundation.sql`.
- Added Photon/Spectrum contract doc, LinkedIn enrichment gate doc, privacy operations doc, and Fly deployment doc.
- Added marketing asset verification plus hero phone animation guardrail.
- Captured browser proof in `.planning/artifacts/browser-v1.0/`.

### Blockers/Concerns

- LinkedIn browser automation must not become production scraping without explicit legal/compliance approval.
- App and marketing should deploy separately, but stay in one repo until there is a real team/security reason to split repositories.
- Do not print Infisical secret values into chat, logs, or committed docs.
- Production waitlist data collection should remain gated until Clerk/Neon/Photon secrets are present and verified.

## Session Continuity

Last session: 2026-05-09
Stopped at: Phase 1 complete; ready to plan Clerk LinkedIn waitlist auth.
Resume file: None
