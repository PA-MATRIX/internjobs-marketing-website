# Requirements: InternJobs.ai

**Defined:** 2026-05-09
**Core Value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current Milestone:** v1.1

## Validated

### Marketing Foundation

- [x] **MKT-01**: Public student landing page is available at `/`.
- [x] **MKT-02**: Public startup page is available at `/startups`.
- [x] **LEGAL-01**: Privacy page is available at `/privacy`.
- [x] **LEGAL-02**: Terms page is available at `/terms`.
- [x] **DEPLOY-01**: Marketing deployment verifies production CSS and JS assets after deploy.

## v1.0 — Waitlist Identity and Messaging Foundation (Active)

**Implementation note:** The app foundation is implemented and verified. Neon and Photon/Spectrum are configured in Infisical/Fly. Clerk production LinkedIn activation remains the main external identity dependency.

### Repo and Deployment

- [x] **ARCH-01**: Repository is organized into separately deployable `apps/marketing` and `apps/app` workspaces.
- [x] **ARCH-02**: Marketing can still build and deploy to Cloudflare Pages after the workspace split.
- [x] **ARCH-03**: App has a Fly.io-ready service with a health check.
- [x] **ARCH-04**: Shared contracts have a place that both app and marketing can import from.

### Identity and Waitlist

- [ ] **AUTH-01**: Student waitlist signup uses Clerk with LinkedIn as the primary sign-in method. Code is ready; live Clerk provider activation is pending.
- [x] **AUTH-02**: Email/password signup is not presented in the student waitlist flow.
- [x] **AUTH-03**: After LinkedIn sign-in, the student lands on channel pairing instead of another marketing page.
- [x] **AUTH-04**: Clerk user ID is stored with the waitlist profile in Neon.

### Neon Data Model

- [x] **DATA-01**: Neon database has tables for students, waitlist status, channel pairing codes, profile snapshots, consents, and audit events.
- [x] **DATA-02**: Database migrations can run repeatably in development and production.
- [x] **DATA-03**: Application secrets are configured through Infisical and synced into Fly.io/local development without committing values.
- [x] **DATA-04**: Waitlist writes are idempotent for repeated sign-in and repeated webhook events.

### Messaging and Photon/Spectrum

- [x] **MSG-01**: App generates a unique pairing code for each student waitlist session.
- [x] **MSG-02**: App displays a QR/code screen for connecting the student messaging channel.
- [x] **MSG-03**: Photon/Spectrum inbound webhook can confirm the student's phone/channel against the pairing code.
- [x] **MSG-04**: Student receives a first welcome/waitlist message after channel confirmation.
- [x] **MSG-05**: Messaging events are stored with delivery state and provider metadata.

### LinkedIn Profile Data

- [x] **LINK-01**: App stores LinkedIn profile fields available through Clerk/OAuth authorization.
- [x] **LINK-02**: Student explicitly consents before any profile enrichment beyond OAuth fields.
- [x] **LINK-03**: Browser-based enrichment is not enabled in production until legal/compliance approval and a safe provider design are documented.
- [x] **LINK-04**: Students can review and correct the profile summary used for matching.

### Operations and Safety

- [x] **OPS-01**: App has health checks suitable for Fly.io.
- [x] **OPS-02**: Webhook endpoints validate provider signatures or shared secrets.
- [x] **OPS-03**: Sensitive data is not logged.
- [x] **OPS-04**: User deletion/export paths are planned for privacy compliance before collecting production data.

## Future Milestones

### v1.1 Candidates

### v1.1 — Seamless Waitlist and Student Threading

- [x] **WAIT-01**: Authenticated waitlist users land directly on QR/SMS pairing.
- [x] **WAIT-02**: QR opens the exact verification text: `Hey internjobs.ai! My verification code is {CODE}. What's next?`
- [x] **WAIT-03**: Pairing code is short, unique, and suitable for texting.
- [x] **THREAD-01**: Follow-up inbound messages from the same phone number attach to the verified student instead of creating a new pairing attempt.
- [x] **GRAPH-01**: App creates a durable student thread placeholder for Cognee hosted graph integration.
- [x] **ENRICH-01**: App creates a durable Sprite.dev + Bright Data enrichment job placeholder after LinkedIn URL capture.

### v1.2 Candidates

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
| AUTH-01 | Phase 2 | External activation pending |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| DATA-01 | Phase 3 | Complete |
| DATA-02 | Phase 3 | Complete |
| DATA-03 | Phase 3 | Complete |
| DATA-04 | Phase 3 | Complete |
| MSG-01 | Phase 4 | Complete |
| MSG-02 | Phase 4 | Complete |
| MSG-03 | Phase 4 | Complete |
| MSG-04 | Phase 4 | Complete |
| MSG-05 | Phase 4 | Complete |
| LINK-01 | Phase 5 | Complete |
| LINK-02 | Phase 5 | Complete |
| LINK-03 | Phase 5 | Complete |
| LINK-04 | Phase 5 | Complete |
| OPS-01 | Phase 6 | Complete |
| OPS-02 | Phase 6 | Complete |
| OPS-03 | Phase 6 | Complete |
| OPS-04 | Phase 6 | Complete |
| WAIT-01 | Phase 7 | Complete |
| WAIT-02 | Phase 7 | Complete |
| WAIT-03 | Phase 7 | Complete |
| THREAD-01 | Phase 7 | Complete |
| GRAPH-01 | Phase 7 | Complete |
| ENRICH-01 | Phase 7 | Complete |

**Coverage (v1.0):**
- Active requirements: 31 total
- Complete in code/local verification: 30
- External activation pending: 1
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-05-09*
*Last updated: 2026-05-09 after v1.1 seamless waitlist implementation*
