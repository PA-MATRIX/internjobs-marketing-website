# Phase 1 Summary: Monorepo and Deploy Split

## Completed

- Created monorepo workspaces:
  - `apps/marketing`
  - `apps/app`
  - `packages/shared`
- Preserved Cloudflare Pages marketing build and asset verification.
- Added a Fly.io-ready app shell with `/healthz`.
- Added root scripts for separate marketing and app commands.
- Added RRR project, requirements, roadmap, state, and milestone docs.

## Verification

- `npm run build:marketing`
- `npm run verify:marketing:dist`
- `npm run build:app`
- `npm run verify`
- Playwright screenshots for desktop and mobile routes.

## Follow-Up

- Cloudflare Pages Git build settings should publish `apps/marketing/dist` if using Git-connected deploys.
- Fly app name and domain should be finalized before first production deploy.
