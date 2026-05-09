# InternJobs.ai App

This app is the authenticated product surface for `app.internjobs.ai`.

It is intentionally separate from the marketing site:

- `apps/marketing` deploys to Cloudflare Pages for `internjobs.ai`.
- `apps/app` deploys to Fly.io for LinkedIn signup, waitlist onboarding, channel pairing, and the future student agent experience.

The current server is a small Fly-ready shell with `/healthz`. The next milestone will add Clerk, Neon, Photon/Spectrum webhooks, and the waitlist flows.

## Secrets

Use Infisical for all app secrets. Required app secrets will include Clerk, LinkedIn OAuth, Neon, Photon/Spectrum, Cloudflare DNS, and Fly runtime values.

Production InternJobs.ai secrets live in Projecta/MATRIX Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`. Do not print secret values while syncing them into Fly.io or provider APIs.

## Fly.io

- App: `internjobs-ai-student-app`
- Org: `projecta-labs`
- Temporary URL: `https://internjobs-ai-student-app.fly.dev`
- Custom domain: `https://app.internjobs.ai`

`app.internjobs.ai` DNS is configured through Cloudflare:

- `A app.internjobs.ai -> 66.241.125.177`
- `AAAA app.internjobs.ai -> 2a09:8280:1::113:206e:0`
- `CNAME _acme-challenge.app.internjobs.ai -> app.internjobs.ai.932q002.flydns.net`
- `TXT _fly-ownership.app.internjobs.ai -> app-932q002`

Fly certificate status: issued and active.
