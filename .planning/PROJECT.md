# InternJobs.ai

## What This Is

InternJobs.ai is a messaging-first internship product for students and startups. The public marketing site lives at `internjobs.ai`, while the authenticated app will live at `app.internjobs.ai` for LinkedIn signup, waitlist onboarding, messaging-channel pairing, and the student agent experience.

The product should feel lightweight and natural: students join with LinkedIn, choose the channel they already use, and get useful internship texts without filling out another portal.

## Core Value

InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.

## Requirements

### Validated

- [x] Public marketing site exists and deploys to Cloudflare Pages.
- [x] Production asset guardrails verify marketing CSS/JS before and after deploy.
- [x] Student, startup, privacy, and terms pages are routable on the marketing site.

### Active

- [ ] Separate the repo into independently deployable marketing and app workspaces.
- [ ] Build a LinkedIn-only student waitlist flow in the app.
- [ ] Store waitlist, consent, profile, and messaging state in Neon Postgres.
- [ ] Pair students to a messaging channel using a QR/code flow and Photon/Spectrum webhooks.
- [ ] Keep users in control of outbound messages and profile enrichment.

### Out of Scope

- Automated LinkedIn credential collection or login scraping — use Clerk OAuth, official/user-authorized data, and explicit consent gates.
- Replacing the marketing site with the app — marketing remains a static Cloudflare Pages deployment.
- Building an ATS or recruiter dashboard — the app should stay messaging-first and lightweight.
- Sending important intros or replies without approval — this breaks the product promise and legal posture.

## Context

- Current repo is a Vite React/Tailwind marketing site deployed through Cloudflare Pages.
- The site is moving into a monorepo:
  - `apps/marketing`: public website for `internjobs.ai`.
  - `apps/app`: authenticated app for `app.internjobs.ai`, deployed on Fly.io under `projecta-labs` as `internjobs-ai-student-app`.
  - `packages/shared`: shared contracts and types.
- Existing Clerk account is authenticated as `rraj@growthpods.io`.
- Existing Clerk app found and linked locally: `Internjobs.ai` (`app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`).
- Neon will be the system of record for waitlist students, startups, messaging pairing, consents, profile enrichment, and audit events.
- Photon/Spectrum number, API credentials, webhook contract, and production phone number are still external dependencies.
- `app.internjobs.ai` needs DNS records pointed at the Projecta Labs Fly app before the branded app domain resolves.

## Constraints

- **Hosting**: Marketing deploys to Cloudflare Pages; authenticated app deploys to Fly.io.
- **Identity**: Student signup must be LinkedIn-first through Clerk.
- **Database**: Neon Postgres is the primary application database.
- **Messaging**: Channel pairing depends on Photon/Spectrum number and inbound webhook support.
- **Compliance**: LinkedIn data collection must be user-authorized and avoid credential capture, anti-bot bypass, or scraping private LinkedIn surfaces.
- **UX**: Students should not feel like they are filling out recruiting software.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use one monorepo with `apps/marketing` and `apps/app` | Separate deployments without splitting shared auth, database, and messaging contracts across repos | Pending |
| Deploy public site through Cloudflare Pages | Existing production path already works and has asset guardrails | Good |
| Deploy authenticated app through Fly.io | App needs server-side integrations, webhooks, background work, and future browser/cloud tasks | Pending |
| Use Projecta Labs Fly org for InternJobs app | Growthpods/SIOS org is not for this product | Good |
| Use Clerk LinkedIn OAuth as the first identity step | Keeps signup natural and avoids password/email-first onboarding | Pending |
| Use Neon Postgres as the system of record | Fits server app + durable profile/waitlist/event data | Pending |
| Gate LinkedIn enrichment behind compliance review | Avoids building a fragile or non-compliant scraper into the core product | Pending |

---
*Last updated: 2026-05-09 after monorepo and waitlist planning request*
