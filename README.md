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

The repo should stay together until there is a concrete reason to split it, such as separate teams, separate access controls, or conflicting release schedules.
