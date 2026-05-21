# Getting internjobs off Neon

Goal: zero Neon dependency. This doc tracks what's done and hands off
the one remaining piece.

## Status — 2026-05-21

| Database | State |
|---|---|
| Mattermost DB | ✅ Migrated to self-hosted Fly Postgres (`internjobs-mattermost-db`). Neon project `noisy-rain-23196137` deleted. See `infra/mattermost-db/MIGRATION.md`. |
| Parrot DB (`flat-scene-36951468`) | ✅ Deleted. It was empty (0 tables) and unused — Parrot keeps its state in a Cloudflare Durable Object, not Postgres. Dead `PARROT_*` secrets removed from Infisical. |
| **Student app DB** | ⏳ **Still on Neon. This is the remaining work — see below.** |

## Remaining task: migrate the student app DB off Neon

The live production database for `apps/app`:
- ~12 MB, 60 tables, `pgvector` + `pgcrypto` extensions, HNSW vector indexes
- Connection: Infisical `/internjobs-ai` → `NEON_DATABASE_URL`
  (this is also the student app's `DATABASE_URL` Fly secret)

### ⚠️ Read this before planning — the constraint

This DB has **two** consumers, not one:

1. `apps/app` — the student app, runs on **Fly**. A self-hosted Fly
   Postgres is trivially reachable from it (same 6PN private network).
2. `apps/parrot` — the Parrot **Cloudflare Worker**. It uses
   `NEON_DATABASE_URL` via the `@neondatabase/serverless` HTTP driver
   to read/write the `safety_events` table
   (`workers/lib/inbound-email.ts`, `workers/routes/ops-safety.ts`).

A self-hosted Fly Postgres is **internal-only** (`*.internal`, 6PN).
**A Cloudflare Worker cannot reach `*.internal`.** Neon works for the
Worker today only because Neon exposes a public HTTPS endpoint.

So this is NOT a copy-paste of the Mattermost migration — you must
also solve Worker → DB access.

### Recommended approach: decouple the Worker first

The Parrot Worker shouldn't write to the student DB directly anyway —
that's a small architectural smell. Fix it, then the DB has a single
consumer and migrates cleanly:

1. Add an authenticated endpoint on `apps/app` (e.g.
   `POST /internal/safety-events`) that performs the `safety_events`
   insert/query currently done inside the Worker.
2. Change `apps/parrot` (`workers/lib/inbound-email.ts`,
   `workers/routes/ops-safety.ts`) to call that endpoint instead of
   `neon(env.NEON_DATABASE_URL)`.
3. Remove `NEON_DATABASE_URL` from the Parrot Worker — the `wrangler`
   secret and the `Env` field in `workers/types.ts`.
4. The DB now has one consumer (the Fly student app). Migrate it.

Alternative (more infra, less clean): give the Fly Postgres a public
IP + TLS and have the Worker connect over TCP (`cloudflare:sockets` +
`postgres.js`) or Cloudflare Hyperdrive.

### The DB migration itself

Same playbook as `infra/mattermost-db/MIGRATION.md`, with ONE
difference — the image must ship `pgvector`:

- Use **`pgvector/pgvector:pg17`** as the base image, not `postgres:17`.
  The dump contains `CREATE EXTENSION vector` and HNSW index
  definitions; the restore target must have the `vector` extension
  available or the restore fails.

Steps:
1. New Fly app `internjobs-student-db` in `infra/student-db/`
   (`pgvector/pgvector:pg17`, volume, internal-only, `ord`).
2. Stop `internjobs-ai-student-app`, `pg_dump` from Neon,
   `pg_restore` into the Fly Postgres via `flyctl proxy`.
3. Repoint the student app's `DATABASE_URL` Fly secret to
   `internjobs-student-db.internal:5432`, restart.
4. Verify: `/healthz` shows `mastraReady` true, row counts match,
   `\di` shows the HNSW indexes. Then delete the Neon project.

### Watch out for

- It's the **live product** — schedule a real downtime window.
- `apps/app/db/migrations/` — do NOT re-run migrations; the dump
  already carries the full schema.
- Keep the pre-migration dump as a backup before deleting Neon.

## After this

Once the student DB is on Fly, internjobs has **zero Neon
dependency**. Update this file's status table when done.
