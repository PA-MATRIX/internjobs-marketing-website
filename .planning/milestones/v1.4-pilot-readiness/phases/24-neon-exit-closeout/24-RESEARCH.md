---
phase: 24-neon-exit-closeout
type: research
date: 2026-05-25
author: planner
---

# Phase 24 — Neon-Exit Research Notes

## Why this phase exists

The Neon-exit migration (2026-05-21) was un-roadmapped — it shipped outside a
formal phase. It had two parts:

1. **DB migration:** `internjobs-student-db` Fly Postgres replaced the Neon
   `soft-dust-92209989` project. `DATABASE_URL` Fly secret repointed.
2. **Code decoupling:** the Parrot Worker (`internjobs-parrot`) used to write
   `safety_events` directly to the Neon DB via `@neondatabase/serverless`. That
   path broke when the DB moved to Fly-internal (Workers can't reach
   `*.internal:5432`). The fix: a new Bearer-authed internal API in the student
   app (`apps/app/src/server.mjs`) that owns the `safety_events` table; the
   Worker calls it instead of Postgres.

Phase 24 verifies the code path is correct E2E and refreshes docs that still
describe the old topology.

## API contracts (student app internal surface)

All routes are under `https://app.internjobs.ai/internal/safety-events`:

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| POST | `/internal/safety-events` | Bearer `INTERNAL_API_SECRET` | `{ok:true}` 200 / `{error}` 400/500 |
| GET | `/internal/safety-events` | Bearer `INTERNAL_API_SECRET` | `{events:[...], total:N}` 200 |
| GET | `/internal/safety-events/unreviewed-count` | Bearer `INTERNAL_API_SECRET` | `{count:N}` 200 |
| POST | `/internal/safety-events/mark-reviewed` | Bearer `INTERNAL_API_SECRET` | `{ok:true}` 200 |

Auth logic (`apps/app/src/server.mjs:1194`): `Authorization: Bearer <secret>`.
Mismatch → `{error:"unauthorized"}` **401**. No database → 200 with empty body
or `{ok:true, skipped:"no_database"}` (fail-soft). The 401 path does NOT crash
the student app — it returns early before any DB call.

Config: `config.internalApiSecret` loaded from `process.env.INTERNAL_API_SECRET`
in `apps/app/src/config.mjs:50`.

## Write path: Workspace Worker → student app

File: `apps/parrot/workers/lib/inbound-email.ts:252–278`

On a Lakera-blocked inbound email:
1. `screenResult.action !== "passed"` triggers the write block.
2. If `env.STUDENT_API_URL && env.STUDENT_API_SECRET`, a `POST
   /internal/safety-events` is fired via `ctx.waitUntil(fetch(...))`.
3. Payload: `{channel, action, reason, score, sender_last4, preview,
   employee_id}`.
4. Auth header: `Authorization: Bearer ${env.STUDENT_API_SECRET}`.

The Worker env var is `STUDENT_API_SECRET`; the student app env var is
`INTERNAL_API_SECRET`. **Same value, different name on each side.** Both set via
Fly secrets (`flyctl secrets set`) and mirrored in Infisical at
`/internjobs-ai`.

## Read path: Workspace Worker → student app → `/ops/safety` UI

File: `apps/parrot/workers/routes/ops-safety.ts`

- `GET /api/ops/safety` (Parrot) → `callStudentApi("/internal/safety-events")`
- `GET /api/ops/safety/unreviewed-count` → `callStudentApi(".../unreviewed-count")`

`callStudentApi` returns `null` if `STUDENT_API_URL/SECRET` are absent or the
fetch throws — every caller degrades fail-soft (empty `{events:[], total:0}`
rather than 500).

## Fly app names

| App | Fly name | Internal endpoint |
|-----|----------|-------------------|
| Student app | `internjobs-ai-student-app` | `https://app.internjobs.ai` (public) |
| Student DB | `internjobs-student-db` | `internjobs-student-db.internal:5432` |
| Parrot Worker | `internjobs-parrot` (CF Worker) | `https://workspace.internjobs.ai` |

## Secrets topology (post-Neon-exit)

| Secret | Location | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | Fly `internjobs-ai-student-app` + Infisical `/internjobs-ai` | student app → student DB |
| `INTERNAL_API_SECRET` | Fly `internjobs-ai-student-app` + Infisical `/internjobs-ai` | student app auth gate |
| `STUDENT_API_SECRET` | `wrangler secret` on `internjobs-parrot` + Infisical | Worker → student app (same value as `INTERNAL_API_SECRET`) |
| `STUDENT_API_URL` | `wrangler secret` on `internjobs-parrot` | `https://app.internjobs.ai` |
| `POSTGRES_PASSWORD` / `STUDENT_DB_PASSWORD` | Fly `internjobs-student-db` + Infisical | DB auth |

`NEON_DATABASE_URL` has been removed from Parrot code + secrets (per
`infra/NEON-EXIT.md`).

## Stale docs to fix

1. **`.planning/HANDOFF.md` §4 line 106:** `"One Neon database (neondb) for
   everything; safety_events lives there."` — needs replacement with post-exit
   topology description.
2. **ROADMAP.md** already has the historical note (`v1.3 Pilot Hardening`
   collapsed section). NEONEX-DOC-02 is satisfied by updating the v1.4 progress
   table status for Phase 24 from "Not started" to "✓ Shipped" after 24-01
   closes, plus adding a brief note in Phase 24's entry confirming verification
   complete. No new text block needed.
3. **`infisical-project` memory** (`/Users/rajren/.claude/projects/-Users-rajren-internjobs-cms/memory/infisical-project.md`):
   currently only lists generic Clerk/LinkedIn/Neon/Photon secrets. Needs the
   post-Neon-exit secrets added: `DATABASE_URL`, `INTERNAL_API_SECRET`,
   `STUDENT_API_SECRET`, `STUDENT_API_URL`.

## Verification approach

All 4 NEONEX-VER requirements are satisfied by curl probes against live
production endpoints — no new code to write. If any probe fails, 24-01 treats
it as a bug and fixes the root cause (likely a missing Fly/Wrangler secret or
a config issue) before closing.

No TDD needed (no new business logic — pure integration verification).
No discovery needed (all endpoints are already deployed).
