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

## Secrets

Infisical is the source of truth for secrets. Do not save provider tokens in `.env` files or repo docs.

This repo must be linked to the InternJobs.ai Infisical project before provider automation can read secrets:

- Run `infisical init` for the Projecta Labs InternJobs.ai project, or pass `--projectId` explicitly in automation.
- Use the confirmed environment/path for Cloudflare, Clerk, LinkedIn, Neon, Photon/Spectrum, and Fly secrets.
- Never print secret values into terminal output, chat, planning docs, or commits.

Expected Infisical-managed secrets include:

- Cloudflare API token with DNS edit access for `internjobs.ai`
- Clerk publishable and secret keys
- LinkedIn OAuth client ID and client secret
- Neon database URLs and role credentials
- Photon/Spectrum API token, webhook secret, and phone number
- Fly.io deploy/runtime secrets

Current Fly app:

- App: `internjobs-ai-student-app`
- Org: `projecta-labs`
- Temporary URL: `https://internjobs-ai-student-app.fly.dev`
- Custom domain: `https://app.internjobs.ai`

Custom domain DNS:

- `A app.internjobs.ai -> 66.241.125.177`
- `AAAA app.internjobs.ai -> 2a09:8280:1::113:206e:0`
- `CNAME _acme-challenge.app.internjobs.ai -> app.internjobs.ai.932q002.flydns.net`
- `TXT _fly-ownership.app.internjobs.ai -> app-932q002`

Fly certificate status: issued and active.

The repo should stay together until there is a concrete reason to split it, such as separate teams, separate access controls, or conflicting release schedules.
