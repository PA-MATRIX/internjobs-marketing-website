# internjobs off Neon — COMPLETE

**Status: ✅ Done 2026-05-21. internjobs has zero Neon dependency.**

## Final state

| Database | Where it lives now |
|---|---|
| Mattermost DB | Self-hosted Fly Postgres — `internjobs-mattermost-db` (`infra/mattermost-db/`) |
| Student app DB | Self-hosted Fly Postgres + pgvector — `internjobs-student-db` (`infra/student-db/`) |
| Parrot DB | Deleted — it was empty/unused (Parrot keeps state in a Durable Object) |

All three Neon projects are deleted: `noisy-rain-23196137`,
`flat-scene-36951468`, `soft-dust-92209989`.

## What was done — Mattermost DB

See `infra/mattermost-db/MIGRATION.md`. Straight infra migration:
Neon → self-hosted Fly Postgres, no code changes.

## What was done — student app DB

This one needed a code change AND an infra migration, because the DB
had two consumers: the student app (`apps/app`, on Fly) and the Parrot
Cloudflare Worker (`apps/parrot`, which read/wrote `safety_events`).
A Cloudflare Worker cannot reach a Fly-internal Postgres.

### 1. Decoupled the Parrot Worker from the DB

- The student app gained an internal, Bearer-authed API (it already
  owns `safety_events` — it writes the SMS-path rows via `store.pool`):
  - `POST /internal/safety-events` — insert a screening event
  - `GET  /internal/safety-events` — paginated flag log (100 / 7 days)
  - `GET  /internal/safety-events/unreviewed-count` — badge count
  - `POST /internal/safety-events/mark-reviewed` — mark reviewed
  Auth: `Authorization: Bearer <INTERNAL_API_SECRET>`.
- The Parrot Worker (`workers/routes/ops-safety.ts`,
  `workers/lib/inbound-email.ts`) now calls that API via
  `STUDENT_API_URL` + `STUDENT_API_SECRET` instead of touching Postgres.
- `NEON_DATABASE_URL` removed from the Worker — code, `types.ts`, the
  `wrangler secret`, and Infisical.

> ⚠️ For the developer: the safety-events path is a SAFETY feature.
> The decouple change is in `apps/app/src/server.mjs` (new `/internal/
> safety-events` block) and `apps/parrot/workers/{routes/ops-safety.ts,
> lib/inbound-email.ts}`. Worth a review pass.

### 2. Migrated the DB

- New Fly app `internjobs-student-db` — Postgres 17 + pgvector
  (`pgvector/pgvector:pg17`), internal-only, 3 GB volume.
- `pg_dump` from Neon → `pg_restore` into Fly. Verified identical:
  60 tables, 108 audit / 2 students / 18 inbound / 16 safety rows,
  both HNSW vector indexes (`student_embeddings`, `role_embeddings`).
- Student app `DATABASE_URL` Fly secret repointed to
  `internjobs-student-db.internal:5432`.
- `pg_session_jwt` (a Neon-proprietary extension) did not carry over —
  it is unused (no RLS policies; auth is Clerk, not Postgres-JWT).

## Operating the student DB

Internal-only — connect through a tunnel:

```bash
flyctl proxy 15432:5432 --app internjobs-student-db
psql "postgres://ijapp:<password>@127.0.0.1:15432/internjobs"
```

Credentials in Infisical `/internjobs-ai`:
- `DATABASE_URL` — full datasource string
- `STUDENT_DB_PASSWORD` — the `ijapp` / `POSTGRES_PASSWORD` value
- `INTERNAL_API_SECRET` — Bearer secret for the `/internal/*` API
  (the Parrot Worker holds the same value as `STUDENT_API_SECRET`)

## Secrets summary

| Secret | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Fly `internjobs-ai-student-app` + Infisical | student app → its Postgres |
| `INTERNAL_API_SECRET` | Fly `internjobs-ai-student-app` + Infisical | auth for `/internal/*` |
| `STUDENT_API_SECRET` | `wrangler secret` on `internjobs-parrot` | Worker → student app (same value as `INTERNAL_API_SECRET`) |
| `POSTGRES_PASSWORD` | Fly `internjobs-student-db` | the DB's own password |

## Gotchas — same as `infra/mattermost-db/`

- `PGDATA` is a subdirectory (ext4 `lost+found`).
- `sslmode=disable` — no TLS on Fly's private network. The student
  app's `pg` pool already keys SSL off the connection string.
- Single Postgres machine, no replica. Fly daily volume snapshots.
- Image MUST be `pgvector/pgvector:pg17` — the schema uses the
  `vector` extension + HNSW indexes.

## Backups

Pre-migration dumps (on the migrating operator's machine, not in repo):
- `~/mattermost-neon-backup-2026-05-21.dump`
- `~/student-neon-backup-2026-05-21.dump`
