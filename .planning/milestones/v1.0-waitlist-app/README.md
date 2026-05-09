# v1.0 Waitlist Identity and Messaging Foundation

## Goal

Create the real app foundation behind the public InternJobs.ai waitlist.

Students should be able to click Join Early Access, sign in with LinkedIn, connect a messaging channel through a QR/code flow, receive the first waitlist text, and have their profile and consent state stored in Neon.

## Product Shape

- Public marketing remains at `internjobs.ai` on Cloudflare Pages.
- Authenticated app runs at `app.internjobs.ai` on Fly.io under `projecta-labs` as `internjobs-ai-student-app`.
- Clerk owns identity, starting with LinkedIn.
- Neon owns durable app data.
- Photon/Spectrum owns messaging transport and number/webhook integration.
- Infisical owns secrets for Cloudflare DNS/API, Clerk, LinkedIn OAuth, Neon, Photon/Spectrum, and Fly runtime configuration.

## Key Guardrails

- LinkedIn signup and profile collection must be user-authorized.
- Important outbound messages must require user approval.
- Webhooks must be idempotent and authenticated.
- Sensitive profile/message data must not be logged.
- Browser-based LinkedIn enrichment is a design/review item, not default production behavior.
- Secret values must stay in Infisical and should not be printed into chat, logs, or docs.

## External Inputs Needed

- Clerk LinkedIn provider credentials and production domain settings.
- Neon project, database URL, and role strategy.
- Photon/Spectrum phone number, inbound webhook shape, outbound send API, and auth method.
- Correct Infisical account/org selection for the Projecta Labs / MATRIX project before saving InternJobs.ai secrets.

## Current Fly DNS Records

Fly certificate for `app.internjobs.ai` is issued and active.

- `A app.internjobs.ai -> 66.241.125.177`
- `AAAA app.internjobs.ai -> 2a09:8280:1::113:206e:0`
- `CNAME _acme-challenge.app.internjobs.ai -> app.internjobs.ai.932q002.flydns.net`
- `TXT _fly-ownership.app.internjobs.ai -> app-932q002`
