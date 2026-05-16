# Architecture: InternJobs.ai v1.2 Two-Sided Agent MVP

**Baseline:** v1.1 shipped 2026-05-15. Single Express app on Fly.io. One Spectrum SMS number. Student-only Clerk auth via LinkedIn. Neon Postgres with six tables.
**Researched:** 2026-05-15
**Overall confidence:** HIGH for topology and schema; MEDIUM for Mastra internals (young library, auto-created tables not fully documented publicly)

---

## 1. Service Topology

### Recommendation: Mastra runs in-process inside the existing Express app, not as a separate Fly service.

**Rationale:**

Mastra ships a server adapter that registers its middleware on an existing Node.js HTTP server. It does not require a separate process or port. Its workflow engine runs async within the Node.js event loop — workflows are triggered by inbound events and complete asynchronously. The Hono-based standalone `mastra build` output is for teams starting from scratch; the adapter path is the right fit when you already own the HTTP server.

Running Mastra in-process has three concrete advantages for v1.2:

1. **No second Fly machine to operate.** The existing `internjobs-ai-student-app` Fly app already has the database connection, secrets injection via Infisical, and health check infrastructure. Adding a second machine doubles the secret-management surface.
2. **Shared Postgres pool.** Mastra's `PostgresStore` (thread memory) and `PgVector` (semantic memory) can share the same `pg.Pool` instance as `store.mjs`. No second connection string needed.
3. **Webhook fan-out is simpler.** The four inbound channels (Spectrum, Telnyx, Cloudflare Email Worker, startup web) all POST to the same Express app. After normalization, they call into Mastra directly via the imported `mastra` instance. No inter-process HTTP call.

**The one real risk:** Mastra workflow execution must not block the Express request handler. The pattern is: webhook handler validates → writes raw event to `inbound_messages` → calls `mastra.workflows.triggerWorkflow(...)` without awaiting completion → returns HTTP 200 immediately. Workflow runs async in background. This is exactly the pattern Mastra's Express adapter is designed for.

**If Mastra proves unstable** (the PROJECT.md flag is accurate: it is young), the fallback is a thin `workflow-runner.mjs` that reads from `inbound_messages` and `drafts` directly — no rewrite of the HTTP or database layers required.

### Service topology diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cloudflare Edge                                                     │
│  ┌───────────────┐   ┌──────────────────────────────────────────┐  │
│  │  Pages        │   │  Worker: email-ingest                    │  │
│  │  internjobs.ai│   │  validates CF Email Routing HMAC         │  │
│  │  (marketing)  │   │  POSTs to /webhooks/email with secret    │  │
│  └───────────────┘   └─────────────────┬────────────────────────┘  │
└─────────────────────────────────────────┼───────────────────────────┘
                                          │
┌─────────────────────────────────────────┼───────────────────────────┐
│  Fly.io  internjobs-ai-student-app      │                           │
│                                         ▼                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Node.js Express app  (server.mjs)                           │  │
│  │                                                              │  │
│  │  Inbound webhook routes:                                     │  │
│  │    POST /webhooks/spectrum   (existing Photon/Spectrum)      │  │
│  │    POST /webhooks/telnyx     (new, Ed25519 sig verify)       │  │
│  │    POST /webhooks/email      (new, Worker shared secret)     │  │
│  │                                                              │  │
│  │  Student routes: /waitlist /pairing /profile (existing)      │  │
│  │  Startup routes: /startup/* (new)                            │  │
│  │  Operator routes: /ops/* (expanded from /ops/privacy)        │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────────┐ │  │
│  │  │  Mastra in-process (adapter, not standalone server)    │ │  │
│  │  │  - Workflow: student_inbound_workflow                   │ │  │
│  │  │  - Workflow: email_inbound_workflow                     │ │  │
│  │  │  - Thread memory: PostgresStore (mastra_threads,        │ │  │
│  │  │                                  mastra_messages)       │ │  │
│  │  │  - Semantic memory: PgVector (mastra_vectors_*)         │ │  │
│  │  └────────────────────────────────────────────────────────┘ │  │
│  │                                                              │  │
│  │  store.mjs (pg.Pool)  ← shared by Express routes AND Mastra │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Infisical sidecar (secret injection at startup, not runtime)       │
└─────────────────────────────────────────┬───────────────────────────┘
                                          │
          ┌───────────────────────────────┼────────────────────────┐
          ▼                               ▼                        ▼
  ┌──────────────┐             ┌─────────────────────┐   ┌───────────────┐
  │ Neon Postgres│             │ Spectrum (Photon)    │   │ Telnyx        │
  │ - app tables │             │ outbound SMS         │   │ outbound SMS  │
  │ - mastra_*   │             │ existing students     │   │ new students  │
  │ - pgvector   │             └─────────────────────┘   └───────────────┘
  └──────────────┘
```

---

## 2. Inbound Channel Matrix

Four inbound channels must all normalize into a single `inbound_messages` table row before the agent consumes them.

| Channel | Entry Point | Auth/Validation | Normalized Provider Value |
|---------|-------------|-----------------|---------------------------|
| Spectrum SMS | `POST /webhooks/spectrum` (existing `/webhooks/photon`) | `verifyPhotonWebhook` (existing HMAC) | `'spectrum'` |
| Telnyx SMS | `POST /webhooks/telnyx` (new) | Ed25519 sig verify via `telnyx-signature-ed25519` + `telnyx-timestamp` headers | `'telnyx'` |
| CF Email | `POST /webhooks/email` (new) | Shared secret header `x-email-worker-secret` set by CF Worker | `'email'` |
| Startup web | `POST /startup/messages` (new, behind Clerk session) | `requireStartupAuth` middleware | `'web'` |

### Normalization pattern

All four handlers call a single `recordInboundMessage(event)` function in `store.mjs` (extending the existing pattern). The function writes a row to the new `inbound_messages` table and then fires `mastra.workflows.triggerWorkflow('student_inbound_workflow', { messageId })` without awaiting. The HTTP handler returns 200 immediately.

The existing `/webhooks/photon` route stays as-is for Spectrum but should be aliased to `/webhooks/spectrum` with a 301 redirect for clarity. The Photon webhook secret config key keeps working.

**Route rename flag:** The existing route is `/webhooks/photon` (named after the library). Recommend adding `/webhooks/spectrum` as the canonical name and keeping `/webhooks/photon` alive as a redirect during v1.2 to avoid reconfiguring Spectrum webhook URL in Photon dashboard — a low-cost safety measure.

### Cloudflare Email Worker integration

CF Email Routing receives email at `*@internjobs.ai`. The Worker:
1. Verifies DKIM/DMARC via CF Email Routing's built-in validation
2. Parses the `To:` address to identify the conversation ID or startup address
3. Signs the forwarded payload with `x-email-worker-secret` (a random 32-byte secret stored in CF Worker env and in Infisical)
4. POSTs to `https://app.internjobs.ai/webhooks/email` with `Content-Type: application/json`

The Express handler verifies `x-email-worker-secret` before processing.

---

## 3. Outbound Channel Matrix

### Recommendation: All outbound goes through the operator approval gate. No direct agent → provider path in v1.2.

```
Agent workflow produces draft
         │
         ▼
  drafts table  (status='pending')
         │
         ▼
  Operator dashboard polls or is notified
  /ops/drafts  (new route)
         │
    ┌────┴─────┐
    │ Approve  │ Reject
    ▼          ▼
  send()    drafts.status='rejected'
    │        + feedback_log row
    │
  ┌─┴──────────────────────────────┐
  │  Which channel?                │
  │  (read from draft.channel)     │
  │                                │
  │  'sms_telnyx'  → Telnyx REST  │
  │  'sms_spectrum' → Photon SDK  │
  │  'email'       → Resend/SES   │
  └────────────────────────────────┘
```

**Student SMS outbound:** The `students` table gains a `sms_provider` column (`'spectrum'` | `'telnyx'`). New students assigned `'telnyx'`. Existing students remain `'spectrum'` until migration. The outbound send function reads `student.sms_provider` and calls the correct provider. Both provider clients are initialized at startup; neither is hot-swapped.

**Startup email outbound:** Use Resend as the email provider. Rationale: Resend has a simple Node.js SDK, first-class transactional email support, and no complex MX record setup. Cloudflare Email Routing is inbound-only; it cannot send. Recommend provisioning `noreply@internjobs.ai` on Resend with verified domain. Infisical gets `RESEND_API_KEY`.

**Operator dashboard outbound (web):** The operator dashboard is a polling UI at `/ops/drafts`. It is server-rendered HTML (same pattern as existing views) for v1.2, not a SPA. This keeps the deployment surface zero (no new Vite build, no new Cloudflare Pages site). The operator clicks Approve, which POSTs to `/ops/drafts/:id/approve`. The server sends the message and updates `drafts.status='sent'`.

---

## 4. Data Model — Schema Deltas

Migration `0003_v1_2_two_sided_agent.sql`:

```sql
-- Enable pgvector (required for AGENT-03)
create extension if not exists vector;

-- ─── Startup identity ────────────────────────────────────────────────

create table startups (
  id               uuid primary key default gen_random_uuid(),
  clerk_org_id     text unique,           -- Clerk Organization ID (nullable until org model finalized)
  name             text not null,
  domain           text,                  -- email domain for routing
  website          text,
  status           text not null default 'onboarding',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table startup_members (
  id               uuid primary key default gen_random_uuid(),
  startup_id       uuid not null references startups(id) on delete cascade,
  clerk_user_id    text not null unique,  -- same Clerk app, different user type
  role             text not null default 'founder',  -- 'founder' | 'member' | 'operator'
  email            text not null,
  name             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index startup_members_startup_idx on startup_members(startup_id);

-- ─── Roles catalog ───────────────────────────────────────────────────

create table roles (
  id               uuid primary key default gen_random_uuid(),
  startup_id       uuid not null references startups(id) on delete cascade,
  title            text not null,
  description      text not null default '',
  requirements     text not null default '',
  status           text not null default 'draft',  -- 'draft' | 'active' | 'paused' | 'closed'
  location         text,
  comp_range       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index roles_startup_idx on roles(startup_id, status);

-- ─── Inbound message pipeline ─────────────────────────────────────────

create table inbound_messages (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,        -- 'spectrum' | 'telnyx' | 'email' | 'web'
  provider_event_id text,               -- dedupe key (nullable for web-origin messages)
  channel_type     text not null,        -- 'sms' | 'email' | 'web'
  channel_address  text,                 -- phone number (normalized) or email address
  student_id       uuid references students(id) on delete set null,
  startup_id       uuid references startups(id) on delete set null,
  direction        text not null default 'inbound',
  body             text not null default '',
  metadata         jsonb not null default '{}'::jsonb,
  processed_at     timestamptz,          -- null = not yet consumed by agent
  created_at       timestamptz not null default now(),
  unique (provider, provider_event_id) -- partial: only enforced when provider_event_id is not null
);

-- Note: the unique constraint above needs a partial index for nullable provider_event_id
create unique index inbound_messages_provider_event_uidx
  on inbound_messages(provider, provider_event_id)
  where provider_event_id is not null;

create index inbound_messages_unprocessed_idx
  on inbound_messages(created_at)
  where processed_at is null;

-- ─── Conversations (the two-sided link) ──────────────────────────────

create table conversations (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id),
  startup_id       uuid not null references startups(id),
  role_id          uuid references roles(id) on delete set null,
  status           text not null default 'active',   -- 'active' | 'closed' | 'paused'
  student_thread_key text,              -- FK into mastra_threads (by thread_key, not UUID)
  startup_thread_key text,             -- FK into mastra_threads (by thread_key, not UUID)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (student_id, startup_id, role_id)
);

create index conversations_student_idx on conversations(student_id);
create index conversations_startup_idx on conversations(startup_id);

-- ─── Outbound drafts (approval gate) ─────────────────────────────────

create table drafts (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete set null,
  inbound_message_id uuid references inbound_messages(id) on delete set null,
  recipient_type   text not null,       -- 'student' | 'startup'
  channel          text not null,       -- 'sms_telnyx' | 'sms_spectrum' | 'email'
  channel_address  text not null,       -- phone or email to send to
  body             text not null,
  status           text not null default 'pending',  -- 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'
  operator_id      text,                -- clerk_user_id of approving operator
  operator_note    text,
  sent_at          timestamptz,
  provider_message_id text,             -- ID returned by Telnyx/Spectrum/Resend on send
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index drafts_pending_idx on drafts(created_at) where status = 'pending';
create index drafts_conversation_idx on drafts(conversation_id);

-- ─── Draft feedback log (rejected drafts feed agent training) ─────────

create table draft_feedback (
  id               uuid primary key default gen_random_uuid(),
  draft_id         uuid not null references drafts(id) on delete cascade,
  operator_id      text not null,
  feedback_type    text not null,       -- 'rejected' | 'edited'
  original_body    text not null,
  corrected_body   text,               -- populated on 'edited' type
  reason           text,
  created_at       timestamptz not null default now()
);

-- ─── Student SMS provider column ──────────────────────────────────────

alter table students
  add column if not exists sms_provider text not null default 'spectrum';
-- New students get 'telnyx'; existing rows default to 'spectrum'

-- ─── Mastra-managed tables (auto-created by Mastra init()) ────────────
-- Mastra creates these automatically on first run. Document them here
-- for schema visibility; do NOT create them manually.
--
-- mastra_threads (id, resource_id, title, metadata, created_at, updated_at)
-- mastra_messages (id, thread_id, role, content, type, created_at)
-- [vector index table] — name determined by PgVector({ indexName })
--   typically: mastra_vectors_{indexName} with columns
--   (id uuid, vector vector(N), metadata jsonb, created_at timestamptz)
--
-- Thread key convention for this project:
--   resource_id = 'student:{student_id}' or 'startup:{startup_id}'
--   thread_id   = conversation_id from conversations table
--   This means one Mastra thread = one conversation (student+startup pair)
```

---

## 5. Agent State Model

### Two memory tiers

**Tier 1: Thread memory (Mastra `PostgresStore`)**

- Stores every message in the conversation: student SMS, startup email replies, agent drafts.
- Keyed by `resource_id` (the entity) and `thread_id` (the conversation).
- Convention: `resource_id = 'student:{student_uuid}'` for student-perspective threads, `resource_id = 'startup:{startup_uuid}'` for startup-perspective threads.
- A single `conversation` row ties to one Mastra thread: `conversations.student_thread_key = 'student:{student_uuid}:{conversation_uuid}'`.
- Within a turn, Mastra loads the last N messages (configurable `lastN`) as working context.
- Across turns, the full thread history is always queryable from `mastra_messages`.

**Tier 2: Semantic memory (Mastra `PgVector`)**

- Long-term recall: student profile facts, startup preferences, role requirements, past conversation summaries.
- Stored as embeddings in the `mastra_vectors_{indexName}` table.
- The agent queries semantic memory at the START of each turn to retrieve relevant cross-conversation context.
- Index name recommendation: `internjobs_agent` (becomes `mastra_vectors_internjobs_agent`).
- Embedding dimension: 1536 (OpenAI `text-embedding-3-small`) or 768 (open source fallback). Lock this before creating the index — changing dimensions requires dropping and recreating.

### Working memory within a turn

```
Turn lifecycle (triggered by inbound_messages row):

1. Agent workflow starts with { messageId }
2. Load inbound_messages row → identify student_id or startup_id
3. Load conversations row (or create new) → get thread_id
4. Mastra loads last N messages from mastra_messages for this thread_id
5. Semantic recall: PgVector.query(message body) → top-K relevant chunks
6. Compose: [system prompt] + [student profile context] + [semantic recall] + [thread history] + [new message]
7. LLM generates draft response
8. Insert row into drafts (status='pending')
9. Update inbound_messages.processed_at = now()
10. Return (no send — operator must approve)
```

### How the agent knows "this draft is for thread X"

The `drafts` table has `conversation_id` (FK to `conversations`). The `conversations` table has both `student_thread_key` and `startup_thread_key`. The operator dashboard fetches `/ops/drafts` which joins:

```sql
select d.*, c.student_id, c.startup_id, c.role_id,
       s.name as student_name, st.name as startup_name
from drafts d
left join conversations c on d.conversation_id = c.id
left join students s on c.student_id = s.id
left join startups st on c.startup_id = st.id
where d.status = 'pending'
order by d.created_at asc;
```

The operator sees: who the message is to (student or startup), the conversation context, and the draft body.

---

## 6. Multi-Strategy Clerk

### Recommendation: Single Clerk app, two user populations distinguished by public metadata, NOT by URL path.

**What Clerk supports in one app:** A single Clerk application can have multiple authentication strategies enabled simultaneously. You can enable LinkedIn OAuth (for students) AND email/Google/Microsoft (for startups) in the same Clerk dashboard. There is no native Clerk concept of "this strategy is only for users who hit path /startup".

**How to distinguish students vs startups:** Use Clerk `publicMetadata.userType = 'student' | 'startup' | 'operator'`. This is set server-side via the Clerk Backend API after the user completes their first sign-in. The Express middleware reads `auth.publicMetadata.userType` from the Clerk session token claims.

**Practical flow:**
- `/waitlist` sign-in button links to Clerk sign-in with `?redirect_url=/auth/callback`. This renders Clerk's hosted sign-in UI. Students will see LinkedIn as the primary option (configured as the social strategy). Startups will also see it, but the `/startup/join` landing page has its own CTA that links to a Clerk sign-in URL with a `?after_sign_in_url=/startup/onboarding` param. The experience is differentiated by which landing page the user came from, not by restricting Clerk strategies.
- After sign-in, `/auth/callback` checks `publicMetadata.userType`. If unset, it infers: LinkedIn OAuth users → `'student'`; email/Google users → prompt startup onboarding to confirm type.
- Operator users are created manually via the Clerk dashboard or Backend API with `userType = 'operator'`.

**Do NOT create a second Clerk app.** Two Clerk apps means two publishable keys, two secret keys, two middleware configurations, and two separate user databases. The single Clerk app `app_38BrRDRKnvbo7vlE2ZZtMc7hFPC` handles all three user types cleanly.

**Flag — v1.1 carry-over must be resolved:** The Cloudflare DNS proxy state blocks the Clerk hosted sign-in UI for `accounts.internjobs.ai`. This must be resolved before startup auth can work. It is already flagged in PROJECT.md as a v1.2 pre-flight item.

---

## 7. Operator Dashboard

### Recommendation: Server-rendered HTML under `/ops/` in the existing Fly app.

**Why not a separate SPA:**
- A separate Vite/React SPA on Cloudflare Pages needs its own build pipeline, its own Clerk publishable key configuration, and its own API CORS setup. That is scope that v1.2 cannot afford.
- The existing app already has server-rendered HTML views. The operator dashboard is low-traffic (a handful of operators reviewing drafts per day). It does not need reactive UI.
- The `/ops/privacy` route already exists — the `/ops/` prefix is already established.

**Operator routes to add:**
```
GET  /ops/drafts              — List pending drafts with conversation context
GET  /ops/drafts/:id          — Detail view for a single draft
POST /ops/drafts/:id/approve  — Approve and send
POST /ops/drafts/:id/reject   — Reject with reason
POST /ops/drafts/:id/edit     — Edit body and approve in one action
GET  /ops/conversations        — List all conversations with status
GET  /ops/startups             — List startups and their roles
```

**Auth for operators:** `requireAuth` middleware already exists. Add `requireOperatorAuth` that additionally checks `auth.publicMetadata.userType === 'operator'`. Operators sign in through the same Clerk flow; they just have a different `userType` in their metadata.

**Session identity:** Same Clerk session cookie that students use. No separate auth system. Operator routes gate on `userType`, not on a separate session mechanism.

---

## 8. End-to-End Message Round-Trip — Integration Points

**Scenario: Student sends "I'm interested in internships at Seed stage startups" → agent drafts startup email → operator approves → startup replies → agent drafts student SMS → operator approves → student receives SMS.**

```
Student SMS (Telnyx)
       │
       ▼  INTEGRATION POINT 1
POST /webhooks/telnyx
  - Verify Ed25519 signature (telnyx-signature-ed25519 header, public key from Telnyx portal)
  - Parse: from_number, body, event_type='message.received'
  - Normalize phone: normalizeAddress(from_number)
  - Lookup student by normalized channel_address WHERE sms_provider='telnyx'
  - Insert row: inbound_messages (provider='telnyx', student_id=X, body=...)
  - Return HTTP 200 immediately
       │
       ▼  INTEGRATION POINT 2
mastra.workflows.triggerWorkflow('student_inbound_workflow', { messageId })
  (async, does not block HTTP response)
       │
       ▼  INTEGRATION POINT 3
student_inbound_workflow runs:
  - Loads student profile context from student_profile_context
  - Finds or creates conversations row (student_id, startup_id=null for cold-start)
  - Calls Mastra Memory API:
      memory.query({ resourceId: 'student:{id}', threadId: conversation_id })
      → returns last N messages from mastra_messages
  - Calls PgVector.query(body) → semantic recall chunks
  - Composes prompt → calls LLM
  - Inserts draft row (status='pending', channel='email', channel_address=startup_email)
  - Appends student message + agent draft to mastra_messages via Memory API
  - Marks inbound_messages.processed_at = now()
       │
       ▼  INTEGRATION POINT 4
Operator dashboard polls GET /ops/drafts
  - Operator sees draft for startup email
  - Operator clicks Approve
  POST /ops/drafts/:id/approve
       │
       ▼  INTEGRATION POINT 5
Outbound: send email to startup via Resend
  - resend.emails.send({ to: startup_email, from: 'noreply@internjobs.ai', ... })
  - Update drafts: status='sent', sent_at=now(), provider_message_id=resend_id
  - Update inbound_messages: processed_at=now() (if not already set)
       │
       ▼
Startup receives email, replies to it
  (Reply-To header set to a conversation-keyed address: conv_{conversation_id}@internjobs.ai)
       │
       ▼  INTEGRATION POINT 6
Cloudflare Email Routing receives reply at conv_{conversation_id}@internjobs.ai
CF Worker:
  - Parses conversation_id from To: address
  - Verifies sender domain (basic)
  - Signs payload with x-email-worker-secret
  POST /webhooks/email
       │
       ▼  INTEGRATION POINT 7
POST /webhooks/email handler:
  - Verifies x-email-worker-secret
  - Parses body: conversation_id, from_email, body
  - Lookup conversations row by id → get startup_id
  - Insert inbound_messages (provider='email', startup_id=Y, student_id=Z via conversation)
  - Trigger email_inbound_workflow({ messageId })
       │
       ▼
email_inbound_workflow runs (same as step 3, but recipient is student):
  - Loads conversation → student → student's sms_provider
  - Generates draft SMS (channel='sms_telnyx' or 'sms_spectrum')
  - Inserts draft row (status='pending')
       │
       ▼
Operator approves draft
  POST /ops/drafts/:id/approve
       │
       ▼
Outbound: send SMS to student
  - If draft.channel='sms_telnyx': Telnyx REST API
  - If draft.channel='sms_spectrum': Photon/Spectrum SDK
  - Update draft: status='sent'
       │
       ▼
Student receives SMS reply
```

**The 7 integration points as code-level callsites:**

| Point | File | New Code Required |
|-------|------|-------------------|
| 1 | `server.mjs` | `POST /webhooks/telnyx` handler with Ed25519 verify |
| 2 | `server.mjs` | `mastra.workflows.triggerWorkflow(...)` call after inbound write |
| 3 | `workflows/student-inbound.mjs` | New Mastra workflow file |
| 4 | `server.mjs` | `GET /ops/drafts` + detail view |
| 5 | `server.mjs` | `POST /ops/drafts/:id/approve` → `outbound.mjs` send router |
| 6 | CF Worker | New Cloudflare Worker script in `apps/email-worker/` |
| 7 | `server.mjs` | `POST /webhooks/email` handler with secret verify |

---

## Patterns That Do NOT Extend from v1.1

**Flag 1: `messaging_events` is student-centric, not two-sided.**
The existing `messaging_events` table has `student_id` as its only actor reference. In v1.2, messages can come from startups. Rather than alter this table (which risks breaking existing Spectrum/Photon dedup logic), introduce the new `inbound_messages` table for all v1.2 traffic. The existing `messaging_events` table continues to serve as the Spectrum/Photon idempotency log. The two coexist in v1.2; a v1.3 migration can consolidate them.

**Flag 2: `ensureStudentThread` uses `provider='cognee'` hardcoded.**
`student_threads` rows were created with `provider='cognee'` in v1.1. In v1.2, Mastra is the agent, not Cognee. These placeholder rows should be updated: `UPDATE student_threads SET provider='mastra', status='active' WHERE provider='cognee'`. Add this as a data migration step in `0003_v1_2_two_sided_agent.sql`. The `thread_key` format stays the same.

**Flag 3: `confirmPairingCode` hardcodes provider `'photon'`.**
```js
// store.mjs line 310
const duplicate = await this.pool.query(
  "select id from messaging_events where provider = 'photon' and provider_event_id = $1",
  [providerEventId]
);
```
When Telnyx inbound pairing confirmations arrive, they will use provider `'telnyx'`. The dedup check will always pass (no match in `messaging_events` for `'photon'`) but the insert will also use `'photon'` for Telnyx events, corrupting the log. Patch: extract `provider` from the inbound webhook handler and pass it through to `confirmPairingCode` and `recordInboundMessage`.

**Flag 4: `normalizeAddress` lookup in `recordInboundMessage` uses a single table scan.**
The existing query:
```sql
select * from students
where regexp_replace(coalesce(channel_address, ''), '[^0-9+]', '', 'g') = $1
  and channel_confirmed_at is not null
```
This works for one provider because all confirmed students are on Spectrum. In v1.2, a Telnyx inbound must match only Telnyx students (to avoid cross-provider confusion). Add `AND sms_provider = $2` to the WHERE clause. The `students_channel_address_normalized_idx` index should be updated to include `sms_provider`.

**Flag 5: The `/healthz` endpoint needs updating.**
Currently checks `photonNumber` and `photonWebhook`. In v1.2, add: `telnyxNumber`, `telnyxWebhookSecret`, `emailWorkerSecret`, `resendApiKey`. Operational visibility requirement.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Service topology | HIGH | Mastra Express adapter is documented; in-process pattern is confirmed |
| Inbound channel normalization | HIGH | All four channels map cleanly to the same `inbound_messages` insert pattern |
| Outbound routing | HIGH | Telnyx REST + Photon SDK both supported; Resend is straightforward |
| Data model | HIGH | Schema derived directly from v1.1 migrations and v1.2 requirements |
| Clerk multi-strategy | MEDIUM | Confirmed that multiple strategies work in one app; publicMetadata approach is standard; path-based strategy restriction does NOT exist in Clerk (verified) |
| Mastra `mastra_threads` / `mastra_messages` schema | MEDIUM | Table names confirmed (Neon guide); full column schema not publicly documented; rely on Mastra's `init()` auto-creation |
| Mastra workflow async model | MEDIUM | Pattern is correct (fire-and-forget via `triggerWorkflow`); event loop impact needs load testing at message volume |
| Operator dashboard rendering | HIGH | Server-rendered HTML is a direct extension of existing views.mjs pattern |
