# InternJobs.ai

This repo is a monorepo with separate deploy targets.

## Apps

- `apps/marketing`: public marketing site for `internjobs.ai`, deployed to Cloudflare Pages.
- `apps/app`: authenticated product app for `app.internjobs.ai`, deployed to Fly.io.
- `packages/shared`: shared contracts and types for both apps.

## Common Commands

```sh
npm run dev:marketing
npm run build:marketing
npm run verify:marketing:dist
npm run deploy:pages

npm run dev:app
npm run build:app
```

## Deployment Shape

Cloudflare Pages should build the marketing app and publish `apps/marketing/dist`.

Fly.io should deploy from `apps/app` using `apps/app/fly.toml`.

Current Fly app:

- App: `internjobs-ai-student-app`
- Org: `projecta-labs`
- Temporary URL: `https://internjobs-ai-student-app.fly.dev`

Custom domain DNS needed for `app.internjobs.ai`:

- `A app.internjobs.ai -> 66.241.125.177`
- `AAAA app.internjobs.ai -> 2a09:8280:1::113:206e:0`

Alternative CNAME setup:

- `CNAME app.internjobs.ai -> 932q002.internjobs-ai-student-app.fly.dev`

The repo should stay together until there is a concrete reason to split it, such as separate teams, separate access controls, or conflicting release schedules.
