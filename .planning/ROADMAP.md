# Roadmap: InternJobs.ai

## Overview

The next milestone turns the marketing site into a real two-surface product: `internjobs.ai` stays a fast public site on Cloudflare Pages, while `app.internjobs.ai` becomes the Fly.io app for LinkedIn signup, Neon-backed waitlist data, Photon/Spectrum channel pairing, and controlled profile enrichment.

## Milestones

- 🚧 **v1.0 Waitlist Identity and Messaging Foundation** - Phases 1-6
- 📋 **v1.1 Student Agent MVP** - recommendations, drafts, approvals, and first matching loops
- 📋 **v1.2 Startup Access MVP** - startup onboarding, role intake, and founder messaging channels

## Phases

- [x] **Phase 1: Monorepo and Deploy Split** - Separate marketing and app workspaces without breaking Cloudflare production deploys.
- [ ] **Phase 2: Clerk LinkedIn Waitlist Auth** - Add LinkedIn-first student signup and post-signup routing into the app.
- [ ] **Phase 3: Neon Data Foundation** - Create database, migrations, profile/waitlist schema, and secret management.
- [ ] **Phase 4: Photon/Spectrum Channel Pairing** - Add QR/code pairing, inbound webhook handling, and first waitlist text.
- [ ] **Phase 5: LinkedIn Profile Ingestion** - Store authorized LinkedIn data and design safe enrichment gates.
- [ ] **Phase 6: Launch Guardrails and Ops** - Add checks, webhook security, observability, privacy controls, and deploy docs.

## Phase Details

### Phase 1: Monorepo and Deploy Split

**Goal**: Marketing and app have independent folders, scripts, and deployment paths.
**Depends on**: Nothing.
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria**:
1. Developer can run marketing build from the repo root.
2. Developer can run app health check from the repo root.
3. Cloudflare Pages deploy command still verifies marketing assets.
4. Fly app folder contains a deployable service shell.
**Plans**: 2 plans

Plans:
- [x] 01-01: Move current site into `apps/marketing` and preserve Cloudflare Pages scripts.
- [x] 01-02: Add `apps/app` Fly.io shell and shared package location.

### Phase 2: Clerk LinkedIn Waitlist Auth

**Goal**: Students join the waitlist through LinkedIn and land in the app onboarding flow.
**Depends on**: Phase 1.
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria**:
1. Student clicking Join Early Access is routed to `app.internjobs.ai`.
2. App presents LinkedIn-first Clerk authentication.
3. Successful sign-in creates or updates a waitlist profile.
4. Student lands on the QR/channel pairing step after authentication.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Configure Clerk app/provider, domains, redirects, and environment variables.
- [ ] 02-02: Add Clerk middleware/session handling to the Fly app.
- [ ] 02-03: Build student waitlist entry and post-auth onboarding screen.

### Phase 3: Neon Data Foundation

**Goal**: Neon stores all waitlist identity, consent, profile, messaging, and event data.
**Depends on**: Phase 2.
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria**:
1. Neon project and database are created for InternJobs.ai.
2. Migrations create the first production schema.
3. App can write and read waitlist records through environment-managed credentials.
4. Repeated sign-ins or webhook retries do not duplicate core student records.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Create Neon project, database, roles, and local/prod connection strategy.
- [ ] 03-02: Add migrations for students, waitlist state, channel pairing, consents, profile snapshots, and audit events.
- [ ] 03-03: Add repository/data-access layer and idempotent upsert behavior.

### Phase 4: Photon/Spectrum Channel Pairing

**Goal**: Students connect their preferred messaging channel through a QR/code flow and receive the first welcome text.
**Depends on**: Phase 3.
**Requirements**: MSG-01, MSG-02, MSG-03, MSG-04, MSG-05
**Success Criteria**:
1. App creates a unique pairing code for each waitlist session.
2. QR screen explains how to send the code to the InternJobs.ai number.
3. Photon/Spectrum inbound webhook validates and links the channel.
4. Welcome/waitlist message is sent and logged.
5. Duplicate inbound events are handled safely.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Confirm Photon/Spectrum number, webhook contract, authentication, and local tunnel strategy.
- [ ] 04-02: Build QR/code screen and pairing-code lifecycle.
- [ ] 04-03: Build inbound webhook, channel confirmation, and welcome-message sender.

### Phase 5: LinkedIn Profile Ingestion

**Goal**: Build a compliant profile pipeline that starts with OAuth-authorized data and keeps enrichment under user control.
**Depends on**: Phase 3.
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04
**Success Criteria**:
1. LinkedIn profile fields available through Clerk/OAuth are stored in Neon.
2. Student sees what profile data InternJobs.ai knows.
3. Student can add or correct projects, interests, and profile context.
4. Browser-based enrichment remains disabled until a documented approved approach exists.
**Plans**: 3 plans

Plans:
- [ ] 05-01: Map Clerk/LinkedIn fields into profile snapshot storage.
- [ ] 05-02: Build profile review and correction UI.
- [ ] 05-03: Write browser-enrichment design doc with explicit compliance gates before implementation.

### Phase 6: Launch Guardrails and Ops

**Goal**: The app can safely collect real waitlist data in production.
**Depends on**: Phases 2-5.
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04
**Success Criteria**:
1. Fly.io health checks and deploy docs are in place.
2. Webhooks validate signatures or shared secrets.
3. Logs avoid sensitive student/profile/message data.
4. Privacy/delete/export paths are documented before production data collection.
**Plans**: 2 plans

Plans:
- [ ] 06-01: Add deployment docs, health checks, secret checklist, and smoke tests.
- [ ] 06-02: Add webhook security, log hygiene, and privacy operations checklist.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Monorepo and Deploy Split | v1.0 | 2/2 | Complete | 2026-05-09 |
| 2. Clerk LinkedIn Waitlist Auth | v1.0 | 0/3 | Not started | - |
| 3. Neon Data Foundation | v1.0 | 0/3 | Not started | - |
| 4. Photon/Spectrum Channel Pairing | v1.0 | 0/3 | Not started | - |
| 5. LinkedIn Profile Ingestion | v1.0 | 0/3 | Not started | - |
| 6. Launch Guardrails and Ops | v1.0 | 0/2 | Not started | - |
