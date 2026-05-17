---
phase: 09-linkedin-qr-onboarding
plan: 01
type: execute
wave: 2
depends_on: ["phase-07b-bluebubbles-native-ux"]
files_modified:
  - apps/app/db/migrations/0007_v1_2_linkedin_profiles.sql       # NEW
  - apps/app/db/migrations/0008_v1_2_pairing_sessions.sql        # NEW
  - apps/app/src/onboarding/linkedin-enrich.mjs                  # NEW
  - apps/app/src/onboarding/pairing.mjs                          # NEW
  - apps/app/src/server.mjs                                       # add /onboard/start + /onboard/qr + /webhooks/mac-bridge pairing-code branch
  - apps/app/src/views.mjs                                        # add renderOnboardingQR + renderOnboardingMobile
  - apps/app/src/workflows/student-inbound.mjs                    # use LinkedIn-enriched profile in system prompt
  - apps/app/package.json                                         # +@photon-ai/uri
  - apps/marketing/                                               # CTA + landing copy changes (TBD)
new_files:
  - apps/app/src/onboarding/proxycurl.mjs                        # enrichment client
autonomous: false
verification:
  surface: backend_and_frontend
  frontend_impact: true
  required_steps:
    - manual_end_to_end_smoke
    - linkedin_oauth_already_configured
    - proxycurl_api_token_provisioned
must_haves:
  truths:
    - "Student lands on internjobs.ai, clicks Get on the Waitlist → LinkedIn OAuth → redirected to /onboard/qr"
    - "Server-side: LinkedIn URL extracted from OIDC claim → Proxycurl enrichment → linkedin_profiles row written"
    - "Pairing code generated (e.g. START-AB12CD) + stored in pairing_sessions with student_id link"
    - "QR code renders an sms:// URI built via @photon-ai/uri encoding (sms:+14063210019&body=START-AB12CD)"
    - "Student scans QR with iPhone camera → iOS prompts to open Messages.app prefilled with our number + code → student taps send"
    - "Mac bridge picks up iMessage with pairing code → /webhooks/mac-bridge recognizes START-{CODE} format → joins phone number to LinkedIn profile via pairing_sessions row → student's first agent message is contextual"
    - "Mobile-signup fallback: phone-only users see an sms:// deep-link button (not QR); same backend path"
    - "Agent's first reply references the LinkedIn profile (school, current role, skills) — visible in conversation"
  artifacts:
    - path: "apps/app/db/migrations/0007_v1_2_linkedin_profiles.sql"
      provides: "linkedin_profiles table — headline, summary, schools, experience, skills (jsonb), enriched_at, enriched_via"
    - path: "apps/app/db/migrations/0008_v1_2_pairing_sessions.sql"
      provides: "pairing_sessions table — code, student_id, expires_at, claimed_at, source (qr|mobile-deeplink|manual)"
    - path: "apps/app/src/onboarding/proxycurl.mjs"
      provides: "Proxycurl REST client (or Apollo as fallback) — takes LinkedIn URL → returns structured profile"
    - path: "apps/app/src/onboarding/pairing.mjs"
      provides: "generatePairingCode, claimPairingCode, validatePairingCode"
    - path: "apps/app/src/views.mjs (additions)"
      provides: "renderOnboardingQR (desktop) + renderOnboardingMobile (sms:// deep-link button)"
  key_links:
    - from: "LinkedIn OAuth callback (Clerk)"
      to: "Proxycurl enrichment → linkedin_profiles row"
      via: "/auth/callback → onboarding/linkedin-enrich.runEnrichment(studentId)"
    - from: "Pairing code in iMessage body"
      to: "Student record"
      via: "/webhooks/mac-bridge → parsePairingCode → store.claimPairingCode → joins student.phone with student.linkedin_profile"
    - from: "First iMessage to agent"
      to: "Contextual agent reply"
      via: "student-inbound.mjs.composePrompt + LinkedIn-enriched profile block"
---

<objective>
Match Standout's onboarding flow: LinkedIn-rich student profile from the first agent message, with a QR-code (desktop) / sms-deeplink (mobile) handoff that ties the LinkedIn identity to the student's phone number for iMessage routing.

End-state: a student lands on internjobs.ai, signs in with LinkedIn, scans a QR, sends one iMessage, and the agent's first reply already knows their school/major/internships/skills. No "what's your background" cold-start.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/milestones/v1.2-two-sided-agent-mvp/phase-04-mastra-agent-core/PLAN.md
@apps/app/src/auth.mjs                                # Clerk OIDC handshake already lives here
@apps/app/src/workflows/student-inbound.mjs           # where we'll inject LinkedIn context into the system prompt
External:
  https://nubela.co/proxycurl/                        # Proxycurl Person Profile API (~$0.04/profile)
  https://docs.apollo.io/reference/people-enrichment  # Apollo as cheaper alternative if we already have credits
  https://github.com/photon-hq/uri                    # @photon-ai/uri for sms:// URI building
  https://qr-code-styling.github.io/qr-code-styling/  # QR generation (lightweight, client-side)
</context>

<plan>

## Decision: enrichment provider

Proxycurl is the de-facto standard for LinkedIn enrichment (~$0.04/profile, generous free tier for prototyping). Apollo is a real alternative we already have an MCP for. **Recommend Proxycurl** for v1 — cheaper per-profile and purpose-built for LinkedIn. Apollo's strength is outbound sales data; we want profile depth.

Decision deferred until execution; check current per-profile pricing at execution time.

## Wave 1 — Schema + enrichment client

### Step 1: Migrations
- `0007_v1_2_linkedin_profiles.sql` — table for enriched profile (1:1 with students)
- `0008_v1_2_pairing_sessions.sql` — short-lived pairing code rows

### Step 2: Proxycurl client + enrichment flow
- `apps/app/src/onboarding/proxycurl.mjs` — REST client with retry/backoff
- New env: `PROXYCURL_API_TOKEN` (Infisical)
- Fail-soft: if enrichment fails, student still proceeds; profile lookup retries on next agent message

### Step 3: LinkedIn URL extraction from OIDC claim
- Clerk's LinkedIn-via-OIDC returns `sub`, `email`, `name`, `picture`. The LinkedIn URL is NOT in standard OIDC claims.
- Approach A: use the `email` + Proxycurl's email→profile API → returns LinkedIn URL + full profile
- Approach B: ask user for LinkedIn URL during onboarding (one extra step)
- Decision: **A first** (no extra UX friction); fall back to B if Proxycurl can't resolve.

## Wave 2 — QR + pairing flow

### Step 4: Pairing code generation
- `START-{6 chars A-Z 0-9}` — base32-ish so it's keyboard-friendly when reading aloud
- 24h expiry
- `apps/app/src/onboarding/pairing.mjs` exports `generatePairingCode(studentId)` + `claimPairingCode(code, phone)`

### Step 5: QR code rendering
- New route `GET /onboard/qr` (operator-gated by post-OAuth session)
- Server-side: build the sms:// URI with `@photon-ai/uri.smsLink({ to, body })` (handles iOS-specific encoding quirks for us)
- Client-side: render the QR via qr-code-styling (lightweight, no server dependency)
- Mobile detection: if iOS/Android user-agent, show the deep-link button + plain-text fallback instead of QR

### Step 6: Pairing-code recognition in /webhooks/mac-bridge
- Extend `MacBridgeSmsProvider.parseInbound` to recognize `START-{XXXXXX}` format
- New `eventType = 'pairing_started'` branch:
  - Validate code (claim if unclaimed, 410 if expired/used)
  - Update students.phone = inbound.channelAddress
  - Update students.pairing_status = 'confirmed'
  - Fire welcome workflow (different prompt — knows it's first contact, references LinkedIn data)

### Step 7: First-contact prompt rewrite
- Extend `apps/app/src/workflows/student-inbound.mjs`:
  - New helper: `composeFirstContactPrompt({ studentId, linkedinProfile })`
  - System prompt: "this is the first message from a new student. you already have their LinkedIn — open with something specific like 'hey raj - saw you went to Columbia and did a Python internship at Acme last summer.'"
  - Few-shot exemplars updated to match (lifted from Standout PDF, adapted)

## Wave 3 — Marketing CTA + landing-page copy

### Step 8: Marketing landing
- Update `apps/marketing/` waitlist landing CTA:
  - Hero: "you'll be the first to know when we go public"
  - LinkedIn-sign-in button (Clerk-hosted)
  - Post-OAuth: "we've already pulled your background — text us to lock in your spot" + QR code

### Step 9: Beyond-LinkedIn capture
- After pairing succeeds, agent asks 2-3 follow-up questions in conversation (not a form):
  - "anything I should know that's not on your LinkedIn? GitHub / personal projects / specific company-types you'd hate?"
  - Replies update student profile via the existing recordTurnFacts → graph memory path (Phase B).

## Out of scope for Phase 09

- Phone-number signup flow (signing up via iMessage cold, no website) — defer
- Email-as-second-channel for students who never iMessage (defer to v1.3)
- Operator UI for inspecting LinkedIn-enriched profiles (just the DB row for v1.2)

## Risks

- **Proxycurl rate limits + cost** at scale (~$0.04 × 300 students = $12 one-time during onboarding; bounded)
- **LinkedIn TOS on enrichment** — Proxycurl operates in a legal gray zone re: LinkedIn scraping. Acceptable for v1.2 launch; revisit if LinkedIn enforces.
- **QR-code mobile UX edge cases** — iOS sometimes opens Camera vs Messages; deep-link button is the fallback.
- **Pairing code collision / abuse** — 6 chars base32 = 1 billion codes, 24h expiry, claim-once. Negligible risk at our scale.

</plan>

<commits>
(none yet — forward-looking plan, execution after Phase 07b lands and Phase 08 Wave 2b is decided)
</commits>
