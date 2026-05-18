# parrot-mattermost

Self-hosted [Mattermost Team Edition](https://mattermost.com/) for the
Parrot internal workspace (`v1.2` Phase 10 Wave 2). Deployed standalone
on Fly — **this is not a workspace npm package**, just a Dockerfile +
`fly.toml` we manage via `flyctl`.

## What this is

- **Fly app:** `internjobs-mattermost` (org `internjobs-sios-org`,
  region `ord`)
- **Public URL:** `https://internjobs-mattermost.fly.dev` (custom
  domain `mattermost.internjobs.ai` is optional — see Wave 3 / future
  work)
- **Image:** `mattermost/mattermost-team-edition:11.6.2`
- **DB:** Neon Postgres (project `noisy-rain-23196137`, branch `main`,
  database `neondb`). Connection string is a Fly secret, never a Fly
  env var.
- **Persistent storage:** 1GB Fly volume `mattermost_data` mounted at
  `/mattermost/data` (file uploads + plugin storage). The DB does NOT
  live here.

## Where config + secrets live

| Setting | Location |
|---|---|
| App definition (size, region, healthcheck) | `fly.toml` in this dir |
| Image tag | `Dockerfile` in this dir |
| Mattermost config (env vars `MM_*`) | Fly secrets — set via `flyctl secrets set` |
| Neon DB URL | Fly secret `MM_SQLSETTINGS_DATASOURCE` (also mirrored to Infisical at `/internjobs-ai/parrot-mattermost/*`) |
| Google OAuth client ID/secret | Fly secrets `MM_GOOGLESETTINGS_ID` + `MM_GOOGLESETTINGS_SECRET` — **TBD, user must create the OAuth client first; see below** |

## Deploy from scratch

From this directory (`apps/parrot-mattermost/`):

```bash
# 1. Create the Fly app (no deploy yet — we set secrets first).
flyctl launch --no-deploy --name internjobs-mattermost \
  --org internjobs-sios-org --region ord --copy-config

# 2. Create the persistent volume for /mattermost/data.
flyctl volumes create mattermost_data --region ord --size 1 \
  --app internjobs-mattermost

# 3. Set Mattermost runtime secrets. The Neon DB URL is read from
#    /tmp/mattermost-dburl-for-agent.txt (provisioned out-of-band).
#    IMPORTANT: Mattermost's Postgres driver uses extended-query
#    prepared statements that PgBouncer (Neon's pooler) cannot persist
#    across transactions, so we must use the DIRECT endpoint — drop
#    "-pooler" from the hostname before passing it as the secret.
DBURL_DIRECT=$(sed 's|-pooler||' /tmp/mattermost-dburl-for-agent.txt)
flyctl secrets set --app internjobs-mattermost \
  MM_SQLSETTINGS_DRIVERNAME=postgres \
  MM_SQLSETTINGS_DATASOURCE="$DBURL_DIRECT" \
  MM_SERVICESETTINGS_SITEURL=https://internjobs-mattermost.fly.dev \
  MM_SERVICESETTINGS_LISTENADDRESS=:8065 \
  MM_TEAMSETTINGS_SITENAME='InternJobs Workspace' \
  MM_TEAMSETTINGS_ENABLEUSERCREATION=true \
  MM_TEAMSETTINGS_RESTRICTCREATIONTODOMAINS=internjobs.ai \
  MM_EMAILSETTINGS_REQUIREEMAILVERIFICATION=false \
  MM_GITLABSETTINGS_ENABLE=false \
  MM_GOOGLESETTINGS_ENABLE=true \
  MM_GOOGLESETTINGS_AUTHENDPOINT=https://accounts.google.com/o/oauth2/v2/auth \
  MM_GOOGLESETTINGS_TOKENENDPOINT=https://oauth2.googleapis.com/token \
  MM_GOOGLESETTINGS_USERAPIENDPOINT='https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses,photos' \
  MM_FILESETTINGS_DIRECTORY=/mattermost/data/ \
  MM_FILESETTINGS_MAXFILESIZE=104857600 \
  MM_PASSWORDSETTINGS_MINIMUMLENGTH=10 \
  MM_RATELIMITSETTINGS_ENABLE=true \
  MM_PLUGINSETTINGS_ENABLE=true \
  MM_PLUGINSETTINGS_ENABLEUPLOADS=true

# 4. Deploy.
flyctl deploy --app internjobs-mattermost

# 5. Smoke test.
curl https://internjobs-mattermost.fly.dev/api/v4/system/ping
# Expect: {"status":"OK","ActiveSearchBackend":"..."}
```

## User actions still required after deploy

1. **Create a Google OAuth client** at
   <https://console.cloud.google.com> → APIs & Services → Credentials.
   Add these redirect URIs:
   - `https://internjobs-mattermost.fly.dev/signup/google/complete`
   - `https://internjobs-mattermost.fly.dev/login/google/complete`
   - (If/when `mattermost.internjobs.ai` is wired up, add the same two
     paths under that hostname too.)
2. **Set the OAuth secrets on the Fly app** once the client exists:

   ```bash
   flyctl secrets set --app internjobs-mattermost \
     MM_GOOGLESETTINGS_ID='<client id>' \
     MM_GOOGLESETTINGS_SECRET='<client secret>'
   ```

   Until these are set, the Google sign-in button on Mattermost will
   error out. **Do not commit these values.** Store them in Infisical
   at `/internjobs-ai/parrot-mattermost/google-oauth-*`.
3. **First admin user.** Mattermost auto-promotes the first registered
   account to System Admin. Sign in via Google with your
   `@internjobs.ai` account first to claim it.
4. **(Optional) Custom domain `mattermost.internjobs.ai`.** Add a
   Cloudflare CNAME → `internjobs-mattermost.fly.dev`, then
   `flyctl certs add mattermost.internjobs.ai`, then re-set
   `MM_SERVICESETTINGS_SITEURL` to the custom URL and update the OAuth
   redirect URIs to match.

## Scope notes

- **Out of scope here (Wave 3):** Daily.co plugin install, header-based
  SSO bridge between Parrot's Clerk session and Mattermost, custom
  themes, mobile push notifications.
- The `MM_PLUGINSETTINGS_ENABLEUPLOADS=true` setting is intentional —
  it lets Wave 3 upload the Daily.co plugin from the Mattermost System
  Console without redeploying the image.

## Gotchas

- **Neon pooler vs direct endpoint.** The pooled connection string
  (hostname contains `-pooler`) runs PgBouncer in transaction mode,
  which doesn't persist Postgres prepared statements across
  transactions. Mattermost's `lib/pq` driver uses extended-query
  prepared statements heavily — boot fails with errors like
  `pq: unnamed prepared statement does not exist`. Always set
  `MM_SQLSETTINGS_DATASOURCE` to the direct endpoint (no `-pooler`).
- **First boot is slow.** Mattermost runs ~50 schema migrations on a
  blank Neon DB and pre-warms its plugin sandbox; expect ~2 minutes
  before `/api/v4/system/ping` returns OK on a cold start. The Fly
  healthcheck has a 30s grace period — the machine may flap once
  during the first boot, which is fine.

## Why these choices

- **Team Edition, not Enterprise:** MIT-licensed, free, supports
  everything we need for ~60 internal users. OIDC SSO is paywalled,
  which is why Wave 2 uses Mattermost's own Google OAuth flow and
  Wave 3 will layer a header-based SSO bridge for the in-Parrot
  experience.
- **Neon over a local Postgres image:** durable, snapshotted, and
  already part of the InternJobs stack. Saves us managing a second
  Fly Postgres app.
- **1GB volume:** generous headroom for chat attachments — bump with
  `flyctl volumes extend` if it fills.
