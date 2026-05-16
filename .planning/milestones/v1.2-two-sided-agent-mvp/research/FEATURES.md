# Feature Research: InternJobs.ai v1.2 — Two-Sided Agent MVP

**Milestone:** v1.2 — Two-Sided Agent MVP
**Researched:** 2026-05-15
**Inherits from:** `.planning/research/` (project-level research), v1.1 implementation at `apps/app/src/`
**Confidence:** MEDIUM (implementation details HIGH from codebase; Mastra production-readiness LOW — see PITFALLS flag)

---

## Flags for Project-Level Docs

The following items surfaced during decomposition that may warrant updates to PROJECT.md or ROADMAP.md:

- **PROJECT.md Constraints — add**: Telnyx `sms_inbound` webhook signature must be validated (X-Telnyx-Signature header, same pattern as existing Spectrum listener). Not currently called out explicitly.
- **PROJECT.md Out of Scope — clarify**: "Operator dashboard" is a new third identity surface beyond student and startup. Clerk does not model three user types natively. The operator will need to be identified by a separate Clerk organization or by a hardcoded allowlist of `clerk_user_id` values. Document which approach is chosen as a Key Decision.
- **PROJECT.md Key Decisions — add**: Whether draft feedback (rejection reason) is free-text entered by the operator or a structured enum (e.g., `tone`, `wrong_role`, `factually_wrong`). Free-text is faster to ship; structured enum lets the agent learn more precisely. This affects AGENT-01 scope.
- **ROADMAP.md — future milestone candidate**: "Startup SMS channel" (second Telnyx number for startups) is already out-of-scope for v1.2 but should appear as a named v1.3 candidate so it doesn't get lost.
- **ROADMAP.md — future milestone candidate**: "Hard Spectrum sunset" belongs as a named v1.3 gate, not just a note. The cutover condition (≥30 days stable, zero regressions) should be stated there so v1.3 planning is explicit.

---

## Requirement Decomposition by Feature Area

### Feature 1 — Telnyx Student SMS (Parallel, Soft Cutover)

**Context:** Existing Spectrum path handles all current students via shared-number + normalized-phone routing (THREAD-01). v1.2 provisions one Telnyx number for new students only. Spectrum stays live for existing students.

---

**TELNYX-01** — Provision Telnyx SMS number and validate inbound webhook (P0)

Done when: A Telnyx number is provisioned in the Telnyx portal, its inbound SMS webhook endpoint exists on the Fly app (e.g., `POST /webhooks/telnyx`), and the handler validates the `X-Telnyx-Signature-Ed25519` + `X-Telnyx-Signature-Ed25519-Timestamp` headers before processing. A test inbound message from Telnyx reaches the handler and is logged without error.

Neon delta: No schema change. New `provider = 'telnyx'` rows will write into existing `messaging_events` table using the existing `(provider, provider_event_id)` unique constraint.

UX: Operator sees no new screen; this is infrastructure. `/healthz` endpoint gains `telnyxWebhook: true` status key.

Minimum viable: Webhook validates signature, records event, returns 200. No pairing logic yet — just the handler skeleton.

Edge cases v1.2: Invalid signature must return 403, not 500, to avoid Telnyx retries filling the error log. Duplicate delivery (same `event_id`) is already idempotent via `on conflict do nothing` in `writeMessagingEvent`.

Edge cases deferred: Telnyx number porting, Telnyx messaging profile rate limits, carrier registration for A2P 10DLC (US long-code compliance) — all post-v1.2.

---

**TELNYX-02** — Route new student signups to Telnyx pairing (P0)

Done when: A student who signs up after Telnyx goes live lands on a QR/SMS pairing screen that generates a verification code intended for the Telnyx number (e.g., copy reads "Text your code to +1-XXX-XXX-XXXX" where that number is the Telnyx number, not the Spectrum number). Inbound confirmation from Telnyx sets `channel_type = 'sms_telnyx'` (or `'sms'` with `provider = 'telnyx'` in `messaging_events`) on the student record.

Neon delta:
- `students` table: add column `sms_provider text not null default 'spectrum'` — values: `'spectrum'`, `'telnyx'`. Index: `students(sms_provider)`.
- No other schema change; pairing code logic is unchanged.

UX: Pairing screen shows Telnyx number when student is new. Existing Spectrum students (already confirmed) continue to see Spectrum number if they revisit.

Minimum viable: A feature flag in config (env var `TELNYX_ACTIVE=true`) gates whether new signups use Telnyx or Spectrum. When flag is off, behavior is identical to v1.1. When flag is on, pairing screen renders Telnyx number and the `spectrumListener` webhook continues handling Spectrum only.

Edge cases v1.2: Student opens pairing screen before flag is flipped, then texts after flag flips. Handled by: pairing code is provider-agnostic; both webhooks attempt to confirm any active code; whichever fires first wins (idempotent).

Edge cases deferred: Student pairing on Telnyx but later requests Spectrum fallback.

---

**TELNYX-03** — One-time migration SMS for existing Spectrum students (P1)

Done when: Operator triggers (manually, via a script or admin endpoint) a one-time SMS to each Spectrum-confirmed student notifying them their new contact number is the Telnyx number. After migration, `students.sms_provider` is updated to `'telnyx'`. The migration SMS event is logged to `messaging_events` with `event_type = 'migration_notice'`.

Cutover state machine:
```
Spectrum student (sms_provider='spectrum')
  → operator runs migration script
  → outbound Spectrum SMS: "Hi, InternJobs.ai is moving to a new number: +1-XXX. Reply from your phone to confirm."
  → student replies to Telnyx number (or not)
  → on first inbound from student's phone via Telnyx: sms_provider flips to 'telnyx'
  → if student never replies: sms_provider stays 'spectrum'; Spectrum stays live
```

Neon delta: `students.sms_provider` column (added in TELNYX-02). Migration script adds a `migration_sms_sent_at timestamptz` column or uses the `messaging_events` log as the source of truth (prefer the latter to avoid schema churn).

UX: Operator runs a CLI script or hits a protected admin endpoint (`POST /admin/migrate-spectrum-students`). No student-facing UI change.

Migration SMS failure: Log failure to `audit_events` with `event_type = 'migration_sms_failed'`. Do not flip `sms_provider`. Retry is manual.

Edge cases v1.2: Student who ignores migration SMS continues to receive on Spectrum. That is the intended behavior — Spectrum stays live through v1.2. No forced cutover.

Edge cases deferred: Automatic retry cadence, batch throttling for large student cohorts, A2P registration compliance (required before messaging more than ~50 students via Telnyx).

---

### Feature 2 — Startup Auth and Onboarding

**Context:** Students use LinkedIn via Clerk. Startups must not be required to have LinkedIn. Clerk supports multiple sign-in strategies per application; the cleaner v1.2 approach is a separate Clerk application instance for startups, or using Clerk's Organizations to scope startup members, rather than mixing auth strategies in the student app.

Recommendation: Use a **separate Clerk application** for startups (`app_startup_XXX`) served on `startups.app.internjobs.ai` or a `/startups` sub-path of `app.internjobs.ai`. This avoids auth strategy pollution on the student Clerk app and keeps the two identity flows cleanly separated. The cost is managing two Clerk apps; the benefit is zero risk of LinkedIn-only being accidentally enforced on startups. This is a Key Decision that should be logged in PROJECT.md before execution.

---

**STARTUP-01** — Startup Clerk application and email-first sign-in (P0)

Done when: A startup founder can navigate to the startup onboarding URL, sign in with email/password or Google or Microsoft OAuth via Clerk (not LinkedIn), and land on a startup dashboard. Clerk user ID for the startup member is stored in Neon.

Neon delta (migration 0003):
```sql
create table if not exists startups (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text unique,          -- Clerk org if using Orgs; null if standalone
  name text not null,
  website text,
  status text not null default 'onboarding',  -- 'onboarding', 'active', 'paused'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists startup_members (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null references startups(id) on delete cascade,
  clerk_user_id text not null unique,
  role text not null default 'founder',   -- 'founder', 'recruiter'
  email text,
  name text,
  created_at timestamptz not null default now()
);

create index if not exists startup_members_clerk_user_id_idx on startup_members(clerk_user_id);
```

UX: Single screen — "Create your company profile" with fields: Company name, Website URL (optional), Founder name (pre-filled from Clerk), Email (pre-filled). Submit creates `startups` + `startup_members` rows. After submit, redirect to role catalog screen.

Minimum viable: One founder per startup. Multi-member invites deferred to v1.3.

Edge cases v1.2: Duplicate sign-in (founder signs in again) — `on conflict (clerk_user_id) do nothing` on `startup_members`. Founder who signs in but never completes onboarding — `status = 'onboarding'` prevents them from appearing in operator views.

---

**STARTUP-02** — Startup consent capture (P0)

Done when: During onboarding, startup accepts terms of service (messaging students on their behalf, human-approved). Consent is recorded in a `startup_consents` table analogous to the student `consents` table.

Neon delta:
```sql
create table if not exists startup_consents (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null references startups(id) on delete cascade,
  consent_type text not null,   -- 'tos_v1', 'messaging_on_behalf'
  granted boolean not null,
  granted_by_clerk_user_id text not null,
  created_at timestamptz not null default now(),
  unique (startup_id, consent_type)
);
```

UX: Checkbox on onboarding screen: "I agree that InternJobs.ai will draft messages to students on behalf of [Company], which a human operator will review before sending." Cannot submit without checking. Consent type: `messaging_on_behalf`.

Minimum viable: Single checkbox, one consent type. No versioned ToS tracking in v1.2.

Edge cases v1.2: Startup tries to access agent features without consent — blocked at middleware.

---

### Feature 3 — Roles Catalog

**Context:** The agent drafts messages referencing specific internship roles. Without a role record, the agent has no grounding. The roles schema is the minimum "what startup is hiring for" signal the agent needs.

**Agent-minimum fields:** `title`, `description`, `requirements` (free text), `status`, `startup_id`. Everything else (location, comp_range) is nice-to-have for richer drafts but not blocking for the match loop.

---

**ROLE-01** — Roles schema and basic CRUD (P0)

Done when: A startup founder can create, view, edit, and deactivate roles from the startup dashboard. Roles are stored in Neon and are readable by the agent.

Neon delta:
```sql
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null references startups(id) on delete cascade,
  title text not null,
  description text not null default '',
  requirements text not null default '',   -- free-text, agent reads this
  location text,                            -- 'remote', 'onsite', 'hybrid', or city
  comp_range text,                          -- '$X-$Y/hr' or null
  status text not null default 'active',   -- 'active', 'paused', 'filled'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roles_startup_status_idx on roles(startup_id, status);
```

UX screens:
- "Your open roles" list — table showing title, status, created date. "Add role" button.
- "Add / edit role" form — fields: Title (required), Description (required, textarea), Requirements (required, textarea placeholder: "e.g. Python, React, 10hr/week commitment"), Location (optional dropdown), Comp range (optional text). Save button. 
- Deactivate link sets `status = 'paused'` (not delete — agent references preserve referential integrity).

Minimum viable: Title + description + requirements. Location and comp_range are stored if provided but agent drafts fine without them in v1.2.

Edge cases v1.2: Startup deletes a role that already has drafts pending — do not hard-delete; set `status = 'paused'` and warn. Pending drafts referencing a paused role should surface a warning on the approval dashboard.

Edge cases deferred: Multiple roles per startup (fully supported by schema; no UI limit needed). Role versioning (v1.3).

---

### Feature 4 — Cloudflare Email Routing → Worker → Mastra Ingest

**Context:** Startup inbound channel is email. `startups@internjobs.ai` (or a per-startup address like `{startup_slug}@internjobs.ai`) routes via Cloudflare Email Routing to a Cloudflare Worker that validates and forwards the parsed payload to a Mastra ingest endpoint on the Fly app.

---

**EMAIL-01** — Cloudflare Email Routing and Worker skeleton (P0)

Done when: Email sent to `startups@internjobs.ai` (or a catch-all on `@internjobs.ai`) is received by a Cloudflare Worker. The Worker parses sender, subject, and body (text). It POSTs a JSON payload to `https://app.internjobs.ai/webhooks/email-ingest`. The Fly app logs the receipt. No agent processing yet.

Neon delta: None at this step. The ingest endpoint logs to `audit_events` with `event_type = 'startup_email_received'` for observability.

UX: Invisible to startup. Operator can see receipt in audit log.

Minimum viable: Cloudflare Worker with `email` event handler, minimal parsing (from, subject, text body), HMAC-signed POST to Fly app. Fly app validates the HMAC and logs. No startup lookup yet.

Edge cases v1.2: Worker times out (Cloudflare Worker CPU limit is 50ms for free tier, 30s on paid). Body parsing of HTML-only emails (strip tags to get plain text). Attachments — ignore in v1.2.

---

**EMAIL-02** — Startup email → thread linkage (P0)

Done when: The Fly app ingest endpoint receives the Worker payload, looks up the `startup_id` by sender email (matching against `startup_members.email`), and writes a `messaging_events` row with `provider = 'email'`, `direction = 'inbound'`, `event_type = 'startup_reply'`. If no startup is found, logs `'unmatched_startup_email'`.

Neon delta: Add `startup_id uuid references startups(id)` to `messaging_events` (nullable; null for student events). Add index: `messaging_events(startup_id, created_at desc)`.

This is the critical schema linkage: `messaging_events` now carries both `student_id` (existing) and `startup_id` (new), allowing the operator dashboard to query "all events in a conversation" by joining on a conversation/match record.

Edge cases v1.2: Startup replies from a different email address than the one used to sign up — lookup fails, logged as `unmatched_startup_email`. Resolution is manual (operator maps the sender). Automated alias matching deferred to v1.3.

---

### Feature 5 — Mastra Agent Core

**Context:** Mastra is young. Its production-readiness at even modest message volume is unverified as of the research date. The fallback plan (noted in PROJECT.md) is a custom workflow layer on Neon. This must be validated in week 1 of v1.2 execution, not week 2 as PROJECT.md states — the agent core is on the critical path for the integration smoke test. The feasibility check should happen before AGENT-01 is started.

---

**AGENT-01** — Mastra workflow: student-inbound → match → draft (P0)

Done when: When a student inbound SMS arrives (from either Spectrum or Telnyx), the Mastra workflow fires. It reads the student's `student_profile_context`, queries active `roles` for startups in the system, selects the best match (simple heuristic in v1.2: keyword overlap between student interests/requirements and role requirements), and writes a draft agent message (student-side) to the `agent_drafts` table with `status = 'pending_review'`.

Neon delta (migration 0003 or 0004):
```sql
create table if not exists agent_drafts (
  id uuid primary key default gen_random_uuid(),
  -- linkage
  student_id uuid references students(id) on delete set null,
  startup_id uuid references startups(id) on delete set null,
  role_id uuid references roles(id) on delete set null,
  -- which side this draft is addressed to
  draft_target text not null,   -- 'student' | 'startup'
  -- content
  draft_body text not null,
  draft_channel text not null,  -- 'sms' | 'email'
  -- state machine
  status text not null default 'pending_review',
                                -- 'pending_review' | 'approved' | 'rejected' | 'sent'
  -- operator interaction
  reviewed_by_clerk_user_id text,
  reviewed_at timestamptz,
  rejection_reason text,        -- free-text in v1.2
  edited_body text,             -- operator-edited version before send
  -- send tracking
  sent_at timestamptz,
  provider_message_id text,
  -- metadata
  agent_metadata jsonb not null default '{}'::jsonb,  -- match scores, model version, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_drafts_status_created_idx on agent_drafts(status, created_at desc);
create index if not exists agent_drafts_student_idx on agent_drafts(student_id, created_at desc);
create index if not exists agent_drafts_startup_idx on agent_drafts(startup_id, created_at desc);
```

UX: No operator-visible screen at this step specifically — the draft appears in the approval queue (APPROVE-01).

Minimum viable: Match logic in v1.2 is keyword heuristic (not vector similarity). pgvector semantic match is AGENT-03 and is layered on after the basic loop works.

Edge cases v1.2: No roles exist yet — workflow writes no draft, logs `no_roles_to_match` in `audit_events`. Student has no profile context — draft notes this in `agent_metadata.match_quality = 'low'`.

---

**AGENT-02** — Mastra thread memory keyed by student_id and startup_id (P0)

Done when: Mastra maintains persistent thread context so the agent does not draft a duplicate intro if it already sent one this week, and so it can reference prior conversation turns. Thread keys follow the existing convention: `student:{student_id}:sms` and `startup:{startup_id}:email`. Thread records are stored in Mastra's built-in persistence (backed by Neon via Mastra's Postgres adapter).

Neon delta: Mastra's Postgres adapter creates its own tables (typically `mastra_threads`, `mastra_messages`). These are Mastra-owned and should be in a separate Neon schema (e.g., `mastra.threads`) to avoid collision with application tables. Document this schema separation in a migration comment.

UX: Invisible to operator. Observable via `/admin/threads` debug endpoint (if built) or directly via Neon.

Minimum viable: Two thread types: student-side (keyed on student_id) and startup-side (keyed on startup_id). No cross-linking between the two threads in the Mastra layer — cross-linking lives in `agent_drafts` (which has both `student_id` and `startup_id`).

Edge cases v1.2: Mastra thread storage fails — agent draft creation fails, student message is logged but no draft is written. Operator sees the inbound in `messaging_events` but no corresponding draft. Must be observable (alert or log line).

---

**AGENT-03** — pgvector semantic memory (P1)

Done when: A Neon table with `vector(1536)` embedding column is created. When a student's profile context is saved or updated, an embedding is written. When a role is created or updated, an embedding is written. The agent match step in AGENT-01 optionally uses cosine similarity (`<=>` operator) instead of keyword overlap when the `USE_VECTOR_MATCH` env var is set.

Neon delta:
```sql
create extension if not exists vector;

create table if not exists student_embeddings (
  student_id uuid primary key references students(id) on delete cascade,
  embedding vector(1536) not null,
  model text not null default 'text-embedding-3-small',
  updated_at timestamptz not null default now()
);

create table if not exists role_embeddings (
  role_id uuid primary key references roles(id) on delete cascade,
  embedding vector(1536) not null,
  model text not null default 'text-embedding-3-small',
  updated_at timestamptz not null default now()
);

create index if not exists student_embeddings_vec_idx
  on student_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);

create index if not exists role_embeddings_vec_idx
  on role_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 10);
```

Note: IVFFlat requires at least `lists` * 39 rows to be useful. With few initial students and roles the index may not help; acceptable for v1.2 scale.

UX: Invisible. `agent_metadata.match_source` field in `agent_drafts` records whether the match used `'keyword'` or `'vector'`.

Minimum viable: Embeddings computed on profile context save and role save. Query uses AGENT-01's keyword fallback if embedding is missing.

Edge cases deferred: Embedding model version migration, backfill job for existing students.

---

### Feature 6 — Operator Approval Gate UI

**Context:** This is the safety mechanism. The operator (product owner) sees all agent-drafted messages before any send. The dashboard has three jobs: surface drafts, let the operator approve/edit/reject, and send approved messages through the correct channel (SMS for student-side, email for startup-side). No auto-send path exists in v1.2.

The operator identity problem: The operator is a person (you). There is no operator sign-in flow specified yet. The minimal v1.2 approach is: protect the `/admin/*` routes with a middleware that checks `clerk_user_id` against a hardcoded allowlist in env (`OPERATOR_CLERK_USER_IDS=user_xxx,user_yyy`). This avoids building a third auth surface in v1.2.

---

**APPROVE-01** — Draft queue view (P0)

Done when: Navigating to `/admin/drafts` (authenticated as operator via allowlist check) shows a list of all `agent_drafts` where `status = 'pending_review'`, ordered by `created_at desc`. Each row shows: draft target (`student` / `startup`), student name, startup name, role title, draft body preview (first 120 chars), time since creation. Clicking a row opens the draft detail view.

Neon delta: None. Reads from `agent_drafts` joined to `students`, `startups`, `roles`.

UX sketch — Queue view:
```
[Drafts — 4 pending review]                        [Filter: All | Student | Startup]

  Student → Alex Chen        RE: Backend Intern @ Acme      "Hey Alex, we found a ..."   2m ago
  Startup → Acme Inc         RE: Alex Chen match            "Hi Acme, we have a stud..."  2m ago
  Student → Maria Lopez      RE: Design Intern @ Bolt        "Hey Maria, Bolt is hiri..."  8m ago
  Startup → Bolt Corp        RE: Maria Lopez match           "Hi Bolt, we have a mat..."   8m ago
```

Minimum viable: Static server-rendered page (following existing `views.mjs` pattern). No real-time updates in v1.2 — operator refreshes manually.

Edge cases v1.2: Empty queue — show "No drafts pending review." message. More than 100 pending drafts — paginate (limit 50, offset).

---

**APPROVE-02** — Draft detail view with approve / edit / reject (P0)

Done when: Draft detail page at `/admin/drafts/:id` shows the full draft body, the student's profile context summary, the role description, and prior conversation turns from `messaging_events` (student-side) or prior startup emails. Operator can:
- **Approve as-is**: Sets `status = 'approved'`, records `reviewed_by`, `reviewed_at`. Triggers send (APPROVE-03).
- **Edit then approve**: Operator edits `draft_body` in a textarea; on submit sets `edited_body` = operator text, `status = 'approved'`, triggers send with `edited_body`.
- **Reject**: Operator optionally enters a free-text reason, sets `status = 'rejected'`, records reason in `rejection_reason`. No send.

UX sketch — Detail view:
```
[Back to queue]

DRAFT: Student SMS — Alex Chen
Role: Backend Intern @ Acme Corp
Created: 2m ago

--- Context ---
Alex: Python, React. Interested in product-adjacent engineering.
Acme role: "We need a Python intern who can own a small feature."

--- Draft ---
"Hey Alex! We found a startup that might be a great fit — Acme Corp is
looking for a Python intern to own a real feature this summer. Want to
hear more? Reply YES."

[Edit draft] [textarea if editing]

[Approve]   [Reject]
[Rejection reason: _________________________]
```

Neon delta: None for schema. Writes: `agent_drafts.status`, `reviewed_by_clerk_user_id`, `reviewed_at`, `rejection_reason`, `edited_body`.

Two-sided linkage visibility: The detail view shows both the student-side draft AND the related startup-side draft (joined via `student_id + startup_id + role_id` on `agent_drafts`) so the operator sees "this draft is for Alex in response to Acme's role." Both drafts in a pair are linked by their shared (`student_id`, `startup_id`, `role_id`) tuple. No separate `conversation_id` needed in v1.2.

Minimum viable: Server-rendered HTML form (no React). POST action updates draft state. Redirect to queue after action.

---

**APPROVE-03** — Approved draft send (P0)

Done when: When an operator approves a draft, the app sends the message through the correct channel:
- `draft_target = 'student'` and `draft_channel = 'sms'`: Sends via `students.sms_provider` (Spectrum or Telnyx). Uses existing messaging pattern from `messaging.mjs`.
- `draft_target = 'startup'` and `draft_channel = 'email'`: Sends via a transactional email provider (see note below).

After successful send: `agent_drafts.status = 'sent'`, `sent_at = now()`, `provider_message_id` = provider's returned ID. Writes `messaging_events` row with `event_type = 'agent_message_sent'`.

Transactional email for startup-side: PROJECT.md does not specify an outbound email provider. The minimum is a Cloudflare Worker with the `MailChannels` free integration (no API key, works from Workers), or Resend (simple API, generous free tier). Recommend **Resend** — it has a simple REST API, is usable from Node/Fly, and does not require a Cloudflare Worker for outbound. Add to Key Decisions.

Neon delta: None. Writes to existing `agent_drafts` and `messaging_events` tables.

UX: Operator sees "Sent" confirmation on redirect, or "Send failed — try again" if the provider call fails. On failure: `status` stays `'approved'` (not `'sent'`), operator can retry.

Edge cases v1.2: Student-side send fails (Spectrum/Telnyx error) — log failure to `audit_events`, leave `status = 'approved'`, surface error to operator. No automatic retry in v1.2. Startup-side send fails (email bounce) — same pattern.

---

**APPROVE-04** — Rejection feedback log (P1)

Done when: Rejected drafts with a non-null `rejection_reason` are visible on a `/admin/feedback` page, ordered by most recent, showing the rejection reason alongside the original draft body. This log is the v1.2 "training signal" — the agent author reviews it to improve prompts manually.

Neon delta: None. Reads from `agent_drafts where status = 'rejected'`.

UX: Simple table. No agent auto-learning in v1.2 — the loop is: operator rejects → reason logged → human reviews feedback → human updates Mastra workflow prompt. Automated feedback ingestion is v1.3.

Minimum viable: Read-only page. No deletion or editing.

---

### Feature 7 — Two-Sided Integration Smoke Test

**Context:** This is the E2E acceptance criterion for v1.2. Every component must work in sequence. This requirement is not "buildable" — it is a test protocol that validates all prior requirements. It belongs in the requirements document as a test requirement, not as an implementation task.

---

**INTEG-01** — Full two-sided smoke test protocol (P0)

Done when: An operator (developer) can manually execute the following sequence in production without error:

1. New student signs in via LinkedIn → lands on Telnyx pairing screen.
2. Student texts the Telnyx number → `channel_confirmed_at` set on student row.
3. Student sends a follow-up text ("Hey what's next?") → `messaging_events` row with `event_type = 'student_reply'`.
4. Mastra workflow fires → `agent_drafts` row created with `draft_target = 'student'`, `status = 'pending_review'`.
5. Operator navigates to `/admin/drafts` → draft is visible.
6. Operator approves draft → SMS sent to student via Telnyx → `status = 'sent'`.
7. Agent also drafts startup-side message → `agent_drafts` row with `draft_target = 'startup'`.
8. Operator approves startup-side draft → email sent to startup via Resend → `status = 'sent'`.
9. Startup replies to email → `messaging_events` row with `event_type = 'startup_reply'`.
10. Mastra workflow fires → new `agent_drafts` row for student-side response.
11. Operator approves → student SMS sent.

Observable outcome: All 11 steps complete without manual DB intervention. Neon rows exist at each step. No message is sent without operator approval.

Neon delta: None — validation of all prior schema deltas.

UX: No new screen. This is a runbook, not a UI feature.

Minimum viable: Steps 1–6 constitute the one-sided student loop. Steps 7–11 are the full two-sided loop. INTEG-01 is not done until all 11 steps pass.

Edge cases v1.2: The Cloudflare DNS proxy issue on `accounts.internjobs.ai` / `clerk.internjobs.ai` (noted in MILESTONES.md carry-over) blocks step 1. This must be resolved as a pre-flight task before INTEG-01 can run. Flag it as a blocker.

---

## Two-Sided Thread Model (Cross-Cutting)

This section addresses the data model question raised in the research prompt, since it cuts across multiple features above.

A "conversation" in v1.2 is defined by the tuple `(student_id, startup_id, role_id)`. There is no separate `conversations` table in v1.2 — the `agent_drafts` table serves as the conversation record. The operator sees "this is a conversation between Alex and Acme about the Backend Intern role" by joining on that triple.

Student thread: `student_threads` table (existing) with `provider = 'mastra'`, `thread_key = 'student:{student_id}:sms'`. Mastra reads student's inbound SMS history from here.

Startup thread: New row in `student_threads` table (reuse the existing generic thread table) with `provider = 'mastra'`, `thread_key = 'startup:{startup_id}:email'`. The table name `student_threads` is misleading for startup records; rename is deferred to v1.3 or addressed by adding a `thread_type text` discriminator column.

Neon delta (thread type discriminator):
```sql
alter table student_threads add column if not exists thread_type text not null default 'student';
-- 'student' | 'startup'
```

This avoids renaming the table in v1.2 while making queries unambiguous.

---

## Requirement Priority Summary

| ID | Feature Area | Priority | Justification |
|----|-------------|----------|---------------|
| TELNYX-01 | Telnyx webhook | P0 | Blocks all Telnyx routing |
| TELNYX-02 | New student → Telnyx | P0 | Core channel shift |
| TELNYX-03 | Migration SMS | P1 | Existing students; Spectrum stays live |
| STARTUP-01 | Startup auth | P0 | Blocks startup onboarding |
| STARTUP-02 | Startup consent | P0 | Legal gate for messaging |
| ROLE-01 | Roles CRUD | P0 | Agent needs roles to draft against |
| EMAIL-01 | CF Email Worker | P0 | Startup inbound channel |
| EMAIL-02 | Email → thread linkage | P0 | Operator needs to see startup replies |
| AGENT-01 | Match → draft workflow | P0 | Core agent value |
| AGENT-02 | Mastra thread memory | P0 | Agent context; prevents duplicate intros |
| AGENT-03 | pgvector semantic match | P1 | Quality improvement; keyword match sufficient for MVP |
| APPROVE-01 | Draft queue | P0 | Operator safety gate |
| APPROVE-02 | Approve / edit / reject | P0 | Operator safety gate |
| APPROVE-03 | Approved draft send | P0 | Operator safety gate — nothing ships without this |
| APPROVE-04 | Rejection feedback log | P1 | Learning signal; manual in v1.2 |
| INTEG-01 | E2E smoke test | P0 | Acceptance criterion for the milestone |

P0 count: 12 requirements
P1 count: 3 requirements
P2 count: 0 (nothing in this decomposition is deferred-but-defined; deferred items are named in edge cases sections)

---

## Neon Migration Sequence

| Migration | Contents |
|-----------|----------|
| 0003 | `startups`, `startup_members`, `startup_consents`, `roles`, `agent_drafts`; add `startup_id` to `messaging_events`; add `sms_provider` to `students`; add `thread_type` to `student_threads` |
| 0004 | `student_embeddings`, `role_embeddings`, `vector` extension (can follow 0003 once basic loop works; P1) |

---

## Suggested Project Updates

### REQUIREMENTS.md Updates (when created for v1.2)
- TELNYX-01 through TELNYX-03 as specified above
- STARTUP-01 through STARTUP-02 as specified above
- ROLE-01 as specified above
- EMAIL-01 through EMAIL-02 as specified above
- AGENT-01 through AGENT-03 as specified above
- APPROVE-01 through APPROVE-04 as specified above
- INTEG-01 as specified above

### PROJECT.md Updates
- Add Key Decision: Separate Clerk app for startups vs. Clerk Organizations vs. strategy mixing in one app
- Add Key Decision: Outbound transactional email provider for startup-side (recommend Resend)
- Add Key Decision: Operator identity in v1.2 — allowlist of Clerk user IDs in env var (`OPERATOR_CLERK_USER_IDS`)
- Add Key Decision: Draft rejection reason is free-text in v1.2 (not structured enum); revisit in v1.3 if agent prompt tuning is slow
- Clarify Constraints: Telnyx A2P 10DLC registration is required before sending to more than ~50 students in the US; this is a hard compliance gate, not just a nice-to-have
- Add Constraint: Mastra production-readiness must be validated (load test at expected message volume) before AGENT-01 is started; fallback plan is a Neon-native workflow table

### ROADMAP.md Updates
- Add named v1.3 milestone candidate: "Hard Spectrum Sunset" — gate: ≥30 days stable Telnyx, zero student SMS regressions, A2P registration complete
- Add named v1.3 milestone candidate: "Startup SMS Channel" — gate: first 5-10 startups indicate email is insufficient
- Add named v1.3 milestone candidate: "Automated Draft Feedback Loop" — structured rejection reasons feed Mastra prompt tuning automatically
- Note for v1.2 execution: Cloudflare DNS proxy fix (`accounts.internjobs.ai`, `clerk.internjobs.ai`) is a pre-flight blocker; must resolve before INTEG-01 can run
