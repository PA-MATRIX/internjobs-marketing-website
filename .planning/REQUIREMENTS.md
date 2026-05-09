# Requirements: InternJobs.ai

**Defined:** 2026-05-09
**Core Value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current Milestone:** v1.0

## Validated

### Marketing Foundation

- [x] **MKT-01**: Public student landing page is available at `/`.
- [x] **MKT-02**: Public startup page is available at `/startups`.
- [x] **LEGAL-01**: Privacy page is available at `/privacy`.
- [x] **LEGAL-02**: Terms page is available at `/terms`.
- [x] **DEPLOY-01**: Marketing deployment verifies production CSS and JS assets after deploy.

## v1.0 — Waitlist Identity and Messaging Foundation (Active)

### Repo and Deployment

- [x] **ARCH-01**: Repository is organized into separately deployable `apps/marketing` and `apps/app` workspaces.
- [x] **ARCH-02**: Marketing can still build and deploy to Cloudflare Pages after the workspace split.
- [x] **ARCH-03**: App has a Fly.io-ready service with a health check.
- [x] **ARCH-04**: Shared contracts have a place that both app and marketing can import from.

### Identity and Waitlist

- [ ] **AUTH-01**: Student waitlist signup uses Clerk with LinkedIn as the primary sign-in method.
- [ ] **AUTH-02**: Email/password signup is not presented in the student waitlist flow.
- [ ] **AUTH-03**: After LinkedIn sign-in, the student lands on channel pairing instead of another marketing page.
- [ ] **AUTH-04**: Clerk user ID is stored with the waitlist profile in Neon.

### Neon Data Model

- [ ] **DATA-01**: Neon database has tables for students, waitlist status, channel pairing codes, profile snapshots, consents, and audit events.
- [ ] **DATA-02**: Database migrations can run repeatably in development and production.
- [ ] **DATA-03**: Application secrets are configured through Infisical and synced into Fly.io/local development without committing values.
- [ ] **DATA-04**: Waitlist writes are idempotent for repeated sign-in and repeated webhook events.

### Messaging and Photon/Spectrum

- [ ] **MSG-01**: App generates a unique pairing code for each student waitlist session.
- [ ] **MSG-02**: App displays a QR/code screen for connecting the student messaging channel.
- [ ] **MSG-03**: Photon/Spectrum inbound webhook can confirm the student's phone/channel against the pairing code.
- [ ] **MSG-04**: Student receives a first welcome/waitlist message after channel confirmation.
- [ ] **MSG-05**: Messaging events are stored with delivery state and provider metadata.

### LinkedIn Profile Data

- [ ] **LINK-01**: App stores LinkedIn profile fields available through Clerk/OAuth authorization.
- [ ] **LINK-02**: Student explicitly consents before any profile enrichment beyond OAuth fields.
- [ ] **LINK-03**: Browser-based enrichment is not enabled in production until legal/compliance approval and a safe provider design are documented.
- [ ] **LINK-04**: Students can review and correct the profile summary used for matching.

### Operations and Safety

- [ ] **OPS-01**: App has health checks suitable for Fly.io.
- [ ] **OPS-02**: Webhook endpoints validate provider signatures or shared secrets.
- [ ] **OPS-03**: Sensitive data is not logged.
- [ ] **OPS-04**: User deletion/export paths are planned for privacy compliance before collecting production data.

## Future Milestones

### v1.1 Candidates

- **MATCH-01**: Use student profile data to draft first internship recommendations.
- **AGENT-01**: Let students approve drafts before messages or intros send.
- **START-01**: Build startup access onboarding and startup role intake inside the app.
- **ADMIN-01**: Add a private operator view for waitlist review and webhook support.

## Out of Scope

| Feature | Reason | Revisit? |
|---------|--------|----------|
| LinkedIn credential capture | High legal/security risk and unnecessary for first waitlist version | Never |
| Automated private LinkedIn scraping | Likely violates platform expectations and can break users' trust | Only after legal review and approved API/provider path |
| ATS dashboard | Wrong product feel; founders and students should use messages first | v2 if proven necessary |
| Multi-provider social login | LinkedIn-only keeps the first student waitlist simple | v1.1 |
| Production automated intros | Current milestone is waitlist and pairing, not full matching automation | v1.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 1 | Complete |
| ARCH-02 | Phase 1 | Complete |
| ARCH-03 | Phase 1 | Complete |
| ARCH-04 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| DATA-01 | Phase 3 | Pending |
| DATA-02 | Phase 3 | Pending |
| DATA-03 | Phase 3 | Pending |
| DATA-04 | Phase 3 | Pending |
| MSG-01 | Phase 4 | Pending |
| MSG-02 | Phase 4 | Pending |
| MSG-03 | Phase 4 | Pending |
| MSG-04 | Phase 4 | Pending |
| MSG-05 | Phase 4 | Pending |
| LINK-01 | Phase 5 | Pending |
| LINK-02 | Phase 5 | Pending |
| LINK-03 | Phase 5 | Pending |
| LINK-04 | Phase 5 | Pending |
| OPS-01 | Phase 6 | Pending |
| OPS-02 | Phase 6 | Pending |
| OPS-03 | Phase 6 | Pending |
| OPS-04 | Phase 6 | Pending |

**Coverage (v1.0):**
- Active requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-05-09*
*Last updated: 2026-05-09 after waitlist architecture request*
