# InternJobs.ai App

This app is the authenticated product surface for `app.internjobs.ai`.

It is intentionally separate from the marketing site:

- `apps/marketing` deploys to Cloudflare Pages for `internjobs.ai`.
- `apps/app` deploys to Fly.io for LinkedIn signup, waitlist onboarding, channel pairing, and the future student agent experience.

The current server is a small Fly-ready shell with `/healthz`. The next milestone will add Clerk, Neon, Photon/Spectrum webhooks, and the waitlist flows.

## Fly.io

- App: `internjobs-ai-student-app`
- Org: `projecta-labs`
- Temporary URL: `https://internjobs-ai-student-app.fly.dev`

`app.internjobs.ai` has a Fly certificate request. DNS still needs:

- `A app.internjobs.ai -> 66.241.125.177`
- `AAAA app.internjobs.ai -> 2a09:8280:1::113:206e:0`

Alternative CNAME setup:

- `CNAME app.internjobs.ai -> 932q002.internjobs-ai-student-app.fly.dev`
