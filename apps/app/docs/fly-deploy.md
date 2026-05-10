# Fly Deployment

App:

```text
internjobs-ai-student-app
```

Organization:

```text
internjobs-sios-org
```

Domain:

```text
https://app.internjobs.ai
```

## Required Runtime Secrets

Secrets live in the Projecta/MATRIX Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`.

- `APP_URL=https://app.internjobs.ai`
- `APP_SESSION_SECRET`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_SIGN_IN_URL`
- `CLERK_JWKS_URL`
- `DATABASE_URL`
- `PHOTON_FROM_NUMBER`
- `PHOTON_WEBHOOK_SECRET`
- `PHOTON_PROJECT_ID`
- `PHOTON_API_BASE_URL`
- `PHOTON_API_TOKEN`
- `SPECTRUM_PROJECT_ID`
- `SPECTRUM_API_TOKEN`
- `SPECTRUM_FROM_NUMBER`
- `PROJECT_ID`
- `PROJECT_SECRET`
- `ENABLE_SPECTRUM_LISTENER=true` when using the Spectrum SDK listener for live in-channel replies.

`apps/app/fly.toml` keeps `min_machines_running = 1` because the Spectrum listener needs one running process to receive incoming messages.

Provider handoff records are stored in Postgres until provider credentials are available:

- `student_threads` uses provider `cognee` for hosted graph/thread memory.
- `profile_enrichment_jobs` uses provider `sprite_brightdata` for later LinkedIn enrichment.

## Deploy

```bash
fly deploy --app internjobs-ai-student-app
```

## Migrate

Run after `DATABASE_URL` is configured:

```bash
npm --workspace @internjobs/app run migrate
```

## Smoke Checks

```bash
npm run verify
curl -sS https://app.internjobs.ai/healthz
fly certs check app.internjobs.ai --app internjobs-ai-student-app
```

## Rollback

```bash
fly releases -a internjobs-ai-student-app
fly deploy --app internjobs-ai-student-app --image <previous-image>
```
