# v1.0 Waitlist Identity and Messaging Foundation

## Goal

Create the real app foundation behind the public InternJobs.ai waitlist.

Students should be able to click Join Early Access, sign in with LinkedIn, connect a messaging channel through a QR/code flow, receive the first waitlist text, and have their profile and consent state stored in Neon.

## Product Shape

- Public marketing remains at `internjobs.ai` on Cloudflare Pages.
- Authenticated app runs at `app.internjobs.ai` on Fly.io.
- Clerk owns identity, starting with LinkedIn.
- Neon owns durable app data.
- Photon/Spectrum owns messaging transport and number/webhook integration.

## Key Guardrails

- LinkedIn signup and profile collection must be user-authorized.
- Important outbound messages must require user approval.
- Webhooks must be idempotent and authenticated.
- Sensitive profile/message data must not be logged.
- Browser-based LinkedIn enrichment is a design/review item, not default production behavior.

## External Inputs Needed

- Clerk LinkedIn provider credentials and production domain settings.
- Neon project, database URL, and role strategy.
- Photon/Spectrum phone number, inbound webhook shape, outbound send API, and auth method.
- Final decision on whether `app.internjobs.ai` DNS points directly to Fly.io or through Cloudflare proxy.
