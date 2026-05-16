# Phase 04: Mastra Agent Core

**Milestone:** v1.2 Two-Sided Agent MVP  
**Depends on:** Phase 03 (startups, roles, conversations, inbound_messages tables must exist from 0003_*)  
**Requirements:** AGENT-01, AGENT-02, AGENT-03

---

## Success Criteria

1. Student inbound SMS (via Phase 01 SmsProvider) triggers a Mastra workflow that reads student profile context, matches active roles, and writes a `drafts` row with `status='pending'`. No outbound sent.
2. Mastra thread memory persists in a dedicated `mastra` Postgres schema (`schemaName: 'mastra'`, never `public`). Queryable by `student_id` and `startup_id` keys.
3. `vector` extension + HNSW index exist on Neon, created IN migration `0004_v1_2_mastra_agent_core.sql`, not deferred. Embeddings written for student profiles and roles on save/update.
4. Toggling `USE_VECTOR_MATCH=true` flips match step to cosine similarity. Missing-embedding fallback to keyword works without error.

---

## Step 1 — Preflight: Mastra Version Pin + OpenAI Key

### 1.1 Pin Mastra version

PITFALLS #2 + #3 require pinning before any code is written.

1. Check `https://mastra.ai/changelog` — find the version where the Tiktoken-per-instance OOM fix shipped (Feb 2026 cycle). This is the minimum.
2. `npm info @mastra/core versions --json | tail -20` to see available versions.
3. Install with exact pin: `npm install --save-exact @mastra/core@<VERSION> --workspace=apps/app`.
4. Confirm the chosen version does NOT require the v0-to-v1 storage migration (PITFALLS #3). If it does, follow `mastra.ai/guides/migrations/upgrade-to-v1/storage` first.
5. Record pinned version + rationale in a comment at the top of `apps/app/src/mastra.mjs`.

**[USER ACTION]** Review the version recommendation from step 5 and confirm the pin. If the version shows an active regression in the Mastra issue tracker, pause and flag.

### 1.2 Add OPENAI_API_KEY

**[USER ACTION]**
1. Obtain `OPENAI_API_KEY` from OpenAI Platform → API keys.
2. Add to Infisical: project `26995afd`, env `prod`, path `/internjobs-ai`, key `OPENAI_API_KEY`.
3. Re-import: `flyctl secrets import --app internjobs-ai-student-app`.
4. Confirm `/config/status` still returns `{"missing":[]}`.

### 1.3 Load-test disposition

Validate no OOM at 20 concurrent inbound messages as a post-merge canary in Phase 06, not a Phase 04 blocker. Fallback if OOM occurs: thin `workflow-runner.mjs` reading from `inbound_messages` directly — no HTTP or DB layer changes needed.

---

## Step 2 — Migration: `0004_v1_2_mastra_agent_core.sql`

File: `apps/app/migrations/0004_v1_2_mastra_agent_core.sql`

All statements use `if not exists` / `if exists` guards. Runs after `0003_*`.

**2.1 Mastra schema (PITFALLS #1 — mandatory)**  
`CREATE SCHEMA IF NOT EXISTS mastra;` — comment it as Mastra-owned, auto-populated by `init()`. Do NOT manually create `mastra.*` tables.

**2.2 `inbound_messages`** (ARCHITECTURE.md Section 2 — coexists with `messaging_events`, Flag 1)  
Columns: `id uuid pk`, `provider text`, `provider_event_id text`, `channel_type text`, `channel_address text`, `student_id uuid → students`, `startup_id uuid → startups`, `direction text default 'inbound'`, `body text`, `metadata jsonb`, `processed_at timestamptz`, `created_at timestamptz`.  
Indexes: partial unique on `(provider, provider_event_id) where provider_event_id is not null`; partial on `(created_at) where processed_at is null`.

**2.3 `conversations`** (ARCHITECTURE.md Section 4 — two-sided link; Phase 05 reads this)  
Columns: `id uuid pk`, `student_id uuid not null → students`, `startup_id uuid not null → startups`, `role_id uuid → roles`, `status text default 'active'`, `student_thread_key text`, `startup_thread_key text`, `created_at`, `updated_at`.  
Unique: `(student_id, startup_id, role_id)`. Indexes on `student_id`, `startup_id`.

**2.4 `drafts`** (ARCHITECTURE.md Section 4 — approval gate contract; Phase 05 reads `status='pending'` rows)  
Columns: `id uuid pk`, `conversation_id uuid → conversations`, `inbound_message_id uuid → inbound_messages`, `recipient_type text`, `channel text`, `channel_address text`, `body text`, `status text default 'pending'`, `operator_id text`, `operator_note text`, `sent_at timestamptz`, `provider_message_id text`, `created_at`, `updated_at`.  
Indexes: partial on `(created_at) where status = 'pending'`; on `conversation_id`.

**2.5 pgvector + HNSW (PITFALLS #10, #18)**  
Embedding model locked to `text-embedding-3-small`, dimension `1536` — do not change without a full re-migration.

```sql
create extension if not exists vector;

create table if not exists student_embeddings (
  student_id uuid primary key references students(id) on delete cascade,
  embedding  vector(1536) not null,
  model      text not null default 'text-embedding-3-small',
  updated_at timestamptz not null default now()
);

create table if not exists role_embeddings (
  role_id    uuid primary key references roles(id) on delete cascade,
  embedding  vector(1536) not null,
  model      text not null default 'text-embedding-3-small',
  updated_at timestamptz not null default now()
);

-- HNSW not IVFFlat (PITFALLS #10). CONCURRENTLY so table stays unlocked.
create index concurrently if not exists student_embeddings_hnsw_idx
  on student_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index concurrently if not exists role_embeddings_hnsw_idx
  on role_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
```

**2.6 Flag 2 data fix** (ARCHITECTURE.md "Patterns That Do NOT Extend from v1.1")  
`UPDATE student_threads SET provider='mastra', status='active', updated_at=now() WHERE provider='cognee';`  
After: `SELECT count(*) FROM student_threads WHERE provider='cognee';` must return 0.

**2.7 Migration verification**

```bash
node apps/app/migrations/run.mjs
psql "$DATABASE_URL" -c "\dn" | grep mastra                         # schema exists
psql "$DATABASE_URL" -c "\dt" | grep -E "inbound_messages|conversations|drafts|student_embeddings|role_embeddings"
psql "$DATABASE_URL" -c "\di" | grep hnsw                           # both HNSW indexes
psql "$DATABASE_URL" -c "select extname from pg_extension where extname='vector';"
psql "$DATABASE_URL" -c "select count(*) from student_threads where provider='cognee';" # 0
```

---

## Step 3 — Mastra In-Process Setup

Create `apps/app/src/mastra.mjs`.

```js
// Pin comment: @mastra/core@<VERSION> — do NOT bump without reading
// mastra.ai/guides/migrations/upgrade-to-v1/storage (PITFALLS #3)
// schemaName: 'mastra' is MANDATORY — never 'public' (PITFALLS #1)

import { Mastra } from '@mastra/core';
import { PostgresStore } from '@mastra/core/storage/postgres';
import { PgVector } from '@mastra/core/vector/pg';
import { studentInboundWorkflow } from './workflows/student-inbound.mjs';

let _mastra = null;
export function initMastra() {
  if (_mastra) return _mastra;
  const connectionString = process.env.DATABASE_URL;
  _mastra = new Mastra({
    storage: new PostgresStore({ connectionString, schemaName: 'mastra' }),
    vectors: { internjobs_agent: new PgVector({ connectionString, schemaName: 'mastra', indexName: 'internjobs_agent' }) },
    workflows: { student_inbound_workflow: studentInboundWorkflow },
    // savePerStep: false prevents message duplication (PITFALLS #2)
  });
  return _mastra;
}
export function getMastra() {
  if (!_mastra) throw new Error('Mastra not initialized');
  return _mastra;
}
```

In `server.mjs`: call `initMastra()` after `createStore(config)`, before routes.

Verify locally: app starts, `mastra.*` tables auto-created by Mastra `init()`, no `public.mastra_*` tables.

---

## Step 4 — `student_inbound_workflow`

Create `apps/app/src/workflows/student-inbound.mjs`.

Turn lifecycle per ARCHITECTURE.md Section 5:

1. Load `inbound_messages` row by `messageId`.
2. Identify `student_id`.
3. Load student profile context from `student_profile_context` via `store.mjs`.
4. Find or create `conversations` row `(student_id, startup_id, role_id)`.
5. **Match step** (see below).
6. Load last 20 Mastra thread messages for this conversation (`lastMessages: 20` — PITFALLS #19).
7. Compose prompt: system + student profile + thread history + matched role summary + new message body.
8. Call LLM (`gpt-4o-mini`; configurable via `AGENT_MODEL` env var).
9. Insert `drafts` row: `status='pending'`, `recipient_type='student'`, `channel='sms'`, `channel_address=student.channel_address`.
10. Mark `inbound_messages.processed_at = now()`.
11. Append student message + draft to Mastra thread via memory API.

**Match step logic:**
- `USE_VECTOR_MATCH=false` (default): keyword heuristic — tokenize student interests/notes, score by overlap with role `title + description + requirements`, pick top-scoring active role across all startups.
- `USE_VECTOR_MATCH=true`: cosine similarity via `PgVector.query()` against `role_embeddings`. If student has no embedding row, fall back to keyword silently (no crash). Record `match_source` in `audit_events`.
- No active roles: write `audit_events` row `event_type='no_roles_to_match'`, exit without creating a draft.

Verify: manually insert a test `inbound_messages` row in Neon dev branch, trigger workflow, confirm `drafts` row with `status='pending'` appears.

---

## Step 5 — Wire `triggerWorkflow` into Spectrum Handler

### 5.1 Add `writeInboundMessage` to `store.mjs` `PostgresStore`

New method alongside existing `recordInboundMessage` (keep for backward compat):

```js
async writeInboundMessage({ provider, providerEventId, channelType, channelAddress, studentId, body, metadata }) {
  const r = await this.pool.query(
    `insert into inbound_messages (provider, provider_event_id, channel_type, channel_address, student_id, body, metadata)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
    [provider, providerEventId, channelType, channelAddress, studentId, body, metadata ?? {}],
  );
  return r.rows[0]?.id ?? null;
}
```

### 5.2 Spectrum handler in `server.mjs`

After `recordInboundMessage` returns `eventType='student_reply'`:

```js
const messageId = await store.writeInboundMessage({ provider: 'spectrum', providerEventId, channelType, channelAddress, studentId: result.student.id, body: text, metadata: {} });
if (messageId) getMastra().workflows.triggerWorkflow('student_inbound_workflow', { messageId }); // fire-and-forget, never awaited
res.status(200).json({ ok: true }); // returns before workflow completes
```

### 5.3 Flag 3 fix — parameterize `provider` in `confirmPairingCode`

`store.mjs` line 310 hardcodes `provider = 'photon'` in the dedup SELECT and INSERT. Change the method signature to accept `provider = 'spectrum'` and substitute it in both places. Pass `provider: 'spectrum'` from the Spectrum handler.

Verify: send a real or simulated Spectrum SMS. Confirm: HTTP 200 within 200ms, `inbound_messages` row created, `drafts` row appears within ~5s, `messaging_events` dedup row still created.

---

## Step 6 — Embedding Hooks

Create `apps/app/src/embeddings.mjs` with:
- `openaiEmbed(text)` — calls `openai.embeddings.create({ model: 'text-embedding-3-small', input: text.slice(0, 8000) })`, returns `float[]`.
- `writeStudentEmbedding(pool, studentId, text)` — upserts into `student_embeddings`.
- `writeRoleEmbedding(pool, roleId, text)` — upserts into `role_embeddings`.

In `PostgresStore.saveProfileContext` (`store.mjs`): after the upsert, fire `writeStudentEmbedding(this.pool, studentId, flattenedContextText).catch(logErr)` — do not await inline.

In the role create/update route handler (Phase 02 routes in `server.mjs`): after successful upsert, fire `writeRoleEmbedding(store.pool, role.id, ...)`.catch(logErr)`.

Verify: save a profile context, query `select student_id, model from student_embeddings limit 1;` — expect one row. Create a role, query `role_embeddings` similarly.

---

## Step 7 — USE_VECTOR_MATCH Toggle

The match step in `student-inbound.mjs` reads `process.env.USE_VECTOR_MATCH === 'true'`. If true and student embedding is present, use vector path. If true but embedding missing, fall back to keyword (no crash). If false, always keyword.

Add to `apps/app/.env.example`:
```
USE_VECTOR_MATCH=false   # set 'true' to enable pgvector cosine matching (needs OPENAI_API_KEY)
```

Set on Fly: `flyctl secrets set USE_VECTOR_MATCH=false --app internjobs-ai-student-app`

Verify three scenarios: flag off → keyword; flag on + no embedding → keyword fallback, no crash; flag on + embedding present → vector path, `match_source` recorded.

---

## Step 8 — /healthz Updates (Flag 5)

Add three keys to the `/healthz` response in `server.mjs`:

```js
mastraReady:     (() => { try { getMastra(); return true; } catch { return false; } })(),
pgvectorReady:   await pool.query("select extname from pg_extension where extname='vector'").then(r => r.rows.length > 0).catch(() => false),
openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
```

After deploy: `curl https://app.internjobs.ai/healthz | jq` must show all five original keys plus `mastraReady: true`, `pgvectorReady: true`, `openaiKeyPresent: true`.

---

## Verification Against Success Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Student inbound → workflow → `drafts` row `status='pending'`. No outbound sent. | Send real SMS to Spectrum number. Query: `select status from drafts order by created_at desc limit 1;` = `pending`. Confirm no `messaging_events` row with `direction='outbound'` was added by the workflow. |
| 2 | Mastra memory in `mastra` schema, queryable by student/startup key. | `\dt mastra.*` shows Mastra tables. `select resource_id from mastra.threads limit 5;` shows `student:<uuid>` entries. `\dt public.*` shows no `public.mastra_*` tables. |
| 3 | `vector` ext + HNSW in migration. Embeddings on save. | `select extname from pg_extension where extname='vector';` returns 1 row. `\di` shows both `*_hnsw_idx`. After profile save, `select count(*) from student_embeddings;` increments. |
| 4 | Toggle works; missing-embedding falls back without error. | Three-scenario test from Step 7. No uncaught promise rejections in Fly logs. |

---

## Files Created / Modified

| File | Action |
|------|--------|
| `apps/app/migrations/0004_v1_2_mastra_agent_core.sql` | Create |
| `apps/app/src/mastra.mjs` | Create |
| `apps/app/src/embeddings.mjs` | Create |
| `apps/app/src/workflows/student-inbound.mjs` | Create |
| `apps/app/src/store.mjs` | Modify — add `writeInboundMessage`; patch `confirmPairingCode` Flag 3 |
| `apps/app/src/server.mjs` | Modify — wire `initMastra`, trigger workflow in Spectrum handler, update `/healthz` |
| `apps/app/.env.example` | Modify — add `USE_VECTOR_MATCH`, `OPENAI_API_KEY` |
| `apps/app/package.json` | Modify — add `@mastra/core` (exact pin), `openai` |

---

## Hard Constraints

- `schemaName: 'mastra'` in both `PostgresStore` and `PgVector`. If any table lands in `public`, stop and fix.
- `triggerWorkflow` is NEVER awaited in a request handler. HTTP 200 returns before workflow completes.
- The workflow writes to `drafts` only. Zero calls to any SMS/email send API. Phase 05 owns outbound.
- `@mastra/core` version is locked. No bumps mid-phase without reading the Mastra migration guide.
- HNSW only, not IVFFlat. `vector(1536)` only, not any other dimension.
- `messaging_events` table is untouched. `inbound_messages` coexists as the v1.2 pipeline table.
