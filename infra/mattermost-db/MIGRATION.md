# Mattermost DB migration — Neon → self-hosted Fly Postgres

**Date:** 2026-05-21
**Status:** Complete and verified live.

## TL;DR

Mattermost's database moved off Neon onto a self-hosted Postgres app on
Fly. The Neon project is deleted. Only the Mattermost DB changed —
no application code, no other database.

## Why

Mattermost holds persistent DB connections and runs background jobs
continuously, so its Neon compute never scaled to zero — it billed a
full 1 CU 24/7 (~68 CPU-hours in 3 days, ~$100+/mo). An always-on app
is the worst-case workload for Neon's per-compute-hour pricing.

A flat-rate, self-hosted `shared-cpu-1x` Postgres on Fly, co-located
with the Mattermost app, costs ~$6/mo. (D1 was considered and rejected:
Mattermost only supports PostgreSQL — it cannot run on SQLite/D1.)

## What changed

| Before | After |
|---|---|
| Neon project `noisy-rain-23196137` (deleted) | Fly app `internjobs-mattermost-db` (`infra/mattermost-db/`) |
| Pooled Neon endpoint, `sslmode=require` | `internjobs-mattermost-db.internal:5432`, `sslmode=disable` |
| Postgres 17 (Neon) | Postgres 17 (official `postgres:17` image) |

Two Fly apps — **do not confuse them:**
- `internjobs-mattermost` — the Mattermost server
- `internjobs-mattermost-db` — its Postgres database (new)

`internjobs-mattermost-db` is **internal-only**: no public IP, no HTTP
service. Reachable only inside `internjobs-sios-org` over the Fly 6PN
private network.

## How it was done

1. Provisioned `internjobs-mattermost-db` (Postgres 17, 3 GB volume, `ord`).
2. Stopped Mattermost, `pg_dump` from Neon (custom format).
3. `pg_restore` into the Fly Postgres via `flyctl proxy`.
4. Repointed the `MM_SQLSETTINGS_DATASOURCE` Fly secret on
   `internjobs-mattermost`, restarted it.
5. Verified: identical row counts (87 tables, 5 users, 11 posts, etc.),
   ping `OK`, no DB errors.
6. Deleted the Neon project.

Total downtime: ~3 minutes.

## Operating the DB

It's internal-only, so connect through a tunnel:

```bash
flyctl proxy 15432:5432 --app internjobs-mattermost-db
psql "postgres://mmuser:<password>@127.0.0.1:15432/mattermost"
```

Credentials live in Infisical at `/internjobs-ai/mattermost`:
- `MATTERMOST_DATABASE_URL` — full datasource string
- `MATTERMOST_DB_PASSWORD` — the `mmuser` / `POSTGRES_PASSWORD` value

The Mattermost app reads its own `MM_SQLSETTINGS_DATASOURCE` Fly secret
(set on `internjobs-mattermost`), which points at
`internjobs-mattermost-db.internal:5432`.

## Gotchas — read before touching `infra/mattermost-db/`

- **`PGDATA` is a subdirectory** (`/var/lib/postgresql/data/pgdata`), not
  the volume root. The ext4 volume root has a `lost+found` dir that
  `initdb` refuses to initialize into. Do not "simplify" this.
- **`sslmode=disable` is intentional** — there is no TLS on Fly's
  private network. Connections never leave the 6PN network.
- **Single machine, no replica.** Fine for the pilot. Fly takes daily
  volume snapshots (5-day retention). Add a standby if HA is needed.
- **First Mattermost boot is slow** (~2 min) — plugin sandbox warmup.
  The 30s healthcheck grace period may flap once; that's expected.

## Backup / rollback

A pre-migration dump exists at `~/mattermost-neon-backup-2026-05-21.dump`
on the migrating operator's machine (not in the repo — it contains
data). The Neon project is deleted, so rollback means restoring that
dump into a fresh Postgres.

## Related files

- `infra/mattermost-db/Dockerfile` — the Postgres image
- `infra/mattermost-db/fly.toml` — the Fly app definition
- `apps/parrot-mattermost/` — the Mattermost server (README updated)
