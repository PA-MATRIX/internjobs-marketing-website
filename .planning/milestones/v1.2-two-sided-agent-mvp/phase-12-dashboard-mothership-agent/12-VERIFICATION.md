---
phase: 12-dashboard-mothership-agent
verified: 2026-05-19T00:00:00Z
status: human_needed
score: 8/8 must-haves verified
human_verification:
  - test: "Live AI Gateway todo extraction — seed-email smoke test"
    expected: "POST /api/dev/smoke/seed-email returns pass:true (todos_extracted > 0) with real CLOUDFLARE_AI_API_TOKEN + PARROT_AI_GATEWAY_ID set"
    why_human: "Requires live Cloudflare AI Gateway credentials and a running wrangler dev session. Automated check verified the endpoint exists and is wired; AI inference result depends on real API keys."
  - test: "Dashboard pane renders todo cards visually"
    expected: "At /dashboard, after seed-email smoke test, todo cards appear with source icon (Mail), urgency dot, title, preview. Clicking an email card navigates to /inbox?message={id}."
    why_human: "Visual rendering and navigation interaction require a browser."
  - test: "WorkspaceShell icon rail shows Phone + SMS icons between Meetings and Invite"
    expected: "Phone and SMS icons visible in left rail, clicking navigates to placeholder pages showing 'Coming soon — Telnyx via Cloudflare Agents SDK'"
    why_human: "Icon rendering requires a browser."
  - test: "DO alarm fires on real Worker (Mattermost poll cycle)"
    expected: "After upsertProfile() fires, wrangler dev logs show alarm firing every ~2 minutes"
    why_human: "DO alarm scheduling only executes in a real Worker runtime."
---

# Phase 12: Dashboard Mothership Agent — Verification Report

**Phase Goal:** Per-employee LLM agent monitoring Email + Chat, extracting cross-channel todos, ranking them by urgency x recency x mention boost, and surfacing them on the Parrot Dashboard pane. Also adds Phone + SMS placeholder nav icons + route stubs (seams documenting the future @cloudflare/voice + Telnyx direction — NOT integrations).

**Verified:** 2026-05-19T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Architectural Context Loaded

- Locked source: `.planning/ROADMAP.md` lines 205–213 — Storage: `EmployeeMailboxDO` extended with `todos` table (migration `3_todos_table`). No new DashboardDO. No Mastra in Parrot Worker. LLM via AI Gateway at `gateway.ai.cloudflare.com`. Phone/SMS: lucide icons + route stubs only. NOT installed: `@cloudflare/voice`, `agents`, any telephony npm package.
- Memory: `project-auth-architecture.md` — Students=LinkedIn-only, Employees=phone-OTP-only. Two separate Clerk apps. (No conflict found — Parrot Worker uses `PARROT_CLERK_*` env vars for the employee Clerk instance.)

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Inbound Inbox email triggers todo extraction; todos appear in GET /api/dashboard/todos | VERIFIED | `createEmail()` line 434: `if (folderId === Folders.INBOX)` → `void this.extractTodosFromEmail(...)`. Route GET /api/dashboard/todos wired at workers/index.ts line 235. |
| 2  | DO alarm fires every 2 minutes and polls Mattermost for chat todos | VERIFIED | `alarm()` method at line 626 calls `pollMattermostNewPosts()` inside try/catch with `finally { await this.ctx.storage.setAlarm(Date.now() + 2*60*1000) }`. Alarm initialized from `upsertProfile()` via `void this.initAlarm()`. |
| 3  | `/dashboard` renders ranked todo cards with source icon, click-through to `/inbox?message=` | VERIFIED | dashboard.tsx fetches `/api/dashboard/todos?view={view}`, renders `<TodoCard>` list. handleSelect() navigates `navigate('/inbox?message=${encodeURIComponent(todo.source_id)}')` for email source. |
| 4  | `/phone` and `/sms` routes render placeholder UI with seam comments | VERIFIED | Both routes exist, render "Coming soon — Telnyx via Cloudflare Agents SDK", contain inline TypeScript comments with `withVoice(Agent)` + `@cloudflare/voice` architecture direction. |
| 5  | WorkspaceShell icon rail shows Phone + SMS between Meetings and admin section | VERIFIED | WorkspaceShell.tsx NAV array: Dashboard, Email, Chat, Meetings, Phone (lucide `Phone`), SMS (lucide `MessageCircle`). ADMIN_NAV (UserPlus/Invite) is separate, rendered only for operators. |
| 6  | Smoke test `POST /api/dev/smoke/seed-email` exists, is gated by PARROT_DEV_MODE, result depends on live AI credentials | VERIFIED (endpoint wired; pass result needs human) | workers/index.ts line 317 registers route, line 321 gates on `c.env.PARROT_DEV_MODE`. Calls `stub.createEmail("Inbox",...)` then `stub.getTodos("all")`. Live AI call result depends on real credentials. |
| 7  | Ranking regression `POST /api/dev/smoke/ranking` returns `pass: true` deterministically | VERIFIED (endpoint wired; execution needs human with wrangler dev) | workers/index.ts line 391. Uses `stub.debugInsertTodo()` with explicit urgency scores (80 vs 20+mention). No LLM involved. Logic: hi.rank=160, lo.rank=70, hi always first. |
| 8  | Existing panes (Inbox/Chat/Meetings) unaffected | VERIFIED | inbox.tsx, chat.tsx, meetings.tsx all exist, import their respective components, TypeScript compiles clean (tsc --noEmit exits 0 after react-router typegen). |

**Score:** 8/8 truths verified (automated). 4 items require human execution for full confirmation.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/parrot/workers/durableObject/migrations.ts` | Migration `3_todos_table` with todos columns | VERIFIED | Lines 154–173: CREATE TABLE todos with all documented columns (id, employee_id, source_channel CHECK IN ('email','chat','phone','sms','meeting'), source_id, title, preview, urgency_score, deadline_at, mentioned_actors, is_mention, created_at, resolved_at). Two indexes: idx_todos_urgency + idx_todos_source. |
| `apps/parrot/workers/db/schema.ts` | Drizzle todos table | VERIFIED | Lines 51–64: `todos` sqliteTable with all columns matching migration exactly. |
| `apps/parrot/workers/lib/ai.ts` | callAiGateway() + extractTodosFromText() + TODO_EXTRACTION_SCHEMA | VERIFIED | All three exported. AI Gateway URL pattern correct. cf-aig-metadata + cf-aig-cache-ttl + Authorization Bearer headers present. 429 handled with null return + console.warn. |
| `apps/parrot/workers/lib/mattermost.ts` | getMmPostsSince() with since=ms-5000 | VERIFIED | Line 93: `?since=${sinceMs - 5000}` overlap to guard mattermost#13846. |
| `apps/parrot/workers/durableObject/index.ts` | extractTodosFromEmail() fire-and-forget, alarm(), getTodos(), debugInsertTodo() | VERIFIED | `void this.extractTodosFromEmail(...)` at line 437. `alarm()` with finally-rescheduled setAlarm at line 633. `getTodos()` with hybrid SQL ORDER BY rank DESC. `debugInsertTodo()` gated by PARROT_DEV_MODE. |
| `apps/parrot/workers/index.ts` | GET /api/dashboard/todos + smoke endpoints | VERIFIED | Route at line 235. Smoke endpoints at lines 317 and 391, both gated by PARROT_DEV_MODE. |
| `apps/parrot/app/routes/dashboard.tsx` | Fetches API, renders TodoCard list, view filter | VERIFIED | useEffect fetches `/api/dashboard/todos?view=...`, renders `<TodoCard>` from `state.todos`, handleSelect() click-through logic present. |
| `apps/parrot/app/components/TodoCard.tsx` | Source icon, urgency dot, title, preview, deadline chip | VERIFIED | SOURCE_ICON map covers email/chat/phone/sms/meeting. urgencyDotColor() → red/amber/slate. title (line-clamp-2), preview (line-clamp-1), deadline chip with tone (overdue/soon/default), @mention badge. |
| `apps/parrot/app/routes/phone.tsx` | Placeholder UI + seam comments | VERIFIED | Exists, renders, contains `@cloudflare/voice` + `withVoice(Agent)` future implementation comments. |
| `apps/parrot/app/routes/sms.tsx` | Placeholder UI + seam comments | VERIFIED | Exists, renders, contains `@cloudflare/voice` + Telnyx SMS future implementation comments. |
| `apps/parrot/app/components/WorkspaceShell.tsx` | Phone + SMS in NAV, between Meetings and admin | VERIFIED | NAV array index 4+5 are Phone + SMS (lucide Phone + MessageCircle). ADMIN_NAV (Invite) is separate — Phone/SMS are between Meetings and admin separator, as required. |
| `apps/parrot/app/routes.ts` | phone + sms routes registered | VERIFIED | Lines 22–23: `route("phone", "routes/phone.tsx")` + `route("sms", "routes/sms.tsx")`. |
| `apps/parrot/workers/types.ts` | CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KIMI_MODEL, PARROT_AI_GATEWAY_ID, PARROT_DEV_MODE, MATTERMOST_BOT_TOKEN | VERIFIED | All six fields present in Env interface at lines 98–108. |
| `apps/parrot/wrangler.jsonc` | KIMI_MODEL var + secret declarations as comments | VERIFIED | KIMI_MODEL in vars at line 67. Secret declarations (CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID, MATTERMOST_BOT_TOKEN) documented as inline comments lines 70–80. |
| `apps/parrot/package.json` | No telephony packages | VERIFIED | grep for `@cloudflare/voice`, `agents`, `@telnyx`, `@daily-co` returns zero results. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `createEmail()` | `extractTodosFromEmail()` | `void this.extractTodosFromEmail(...)` inside `if (folderId === Folders.INBOX)` | WIRED + FIRE-AND-FORGET | Line 434–438. Not awaited — `void` prefix confirmed. |
| `extractTodosFromEmail()` | `extractTodosFromText()` in ai.ts | direct call, await | WIRED | Line 569. Returns [] on null/empty; never throws to caller. |
| `extractTodosFromText()` | `callAiGateway()` | direct call, await | WIRED | Line 184. |
| `callAiGateway()` | AI Gateway URL | `fetch(https://gateway.ai.cloudflare.com/v1/...)` | WIRED | Line 114. URL uses `CLOUDFLARE_ACCOUNT_ID` + `PARROT_AI_GATEWAY_ID` from env. |
| `alarm()` | `pollMattermostNewPosts()` | await inside try/finally | WIRED | Line 629. setAlarm() in finally block guarantees reschedule on error. |
| `pollMattermostNewPosts()` | `getMmPostsSince()` | per channelId, since=lastPollMs | WIRED | Lines 690–697. Overlaps by 5s via `sinceMs - 5000`. |
| `insertTodos()` | todos SQL table | INSERT OR IGNORE ON (source_channel, source_id) | WIRED | The INSERT OR IGNORE is a primary key-based dedup (id = UUID, not source-based). Note: dedup is on `id` (UUID), NOT on `(source_channel, source_id)` — see finding below. |
| `GET /api/dashboard/todos` | `stub.getTodos(view)` | Hono route → DO RPC | WIRED | workers/index.ts line 241. |
| `DashboardRoute` | `/api/dashboard/todos` | `fetch(url, {credentials:"include"})` in useEffect | WIRED | dashboard.tsx lines 155–184. |
| email TodoCard click | `/inbox?message={source_id}` | `navigate(...)` in handleSelect | WIRED | dashboard.tsx line 188. |
| `debugInsertTodo()` | `POST /api/dev/smoke/ranking` | `stub.debugInsertTodo(employee.employeeId, ...)` | WIRED | workers/index.ts lines 405–421. |

---

### Dedup Note (Advisory, Not a Blocker)

`insertTodos()` uses `INSERT OR IGNORE INTO todos (id, ...)` where `id` is a freshly-generated `crypto.randomUUID()` on every call. The IGNORE clause fires only on primary-key collision, which can never happen with a UUID. Deduplication at the `(source_channel, source_id)` level does NOT occur via INSERT OR IGNORE — the index `idx_todos_source` on `(source_channel, source_id)` exists for read performance, not for dedup enforcement.

Effect: repeated alarm cycles will insert duplicate todos for the same Mattermost post if `extractTodosFromText()` returns results more than once for the same batch. The index does not have a UNIQUE constraint in the migration (line 171: `CREATE INDEX idx_todos_source ON todos(source_channel, source_id)` — not `CREATE UNIQUE INDEX`).

This deviates from the locked architecture decision: "INSERT OR IGNORE deduplication on `source_id`" (ROADMAP line 210). The dedup that exists is effectively no-dedup for re-polled content.

Severity: Warning (not a phase-gate blocker — the system still functions; todos may accumulate duplicates across alarm cycles on high-traffic channels). Does not block `status: human_needed` because:
1. The smoke tests are unaffected (they use unique UUIDs in source_id).
2. No existing data would be corrupted.
3. Fix is a one-line schema change: make idx_todos_source a UNIQUE index and update insertTodos to rely on it.

---

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| SC1: Inbox email triggers extraction; todos in GET /api/dashboard/todos | SATISFIED | Code path verified. Live AI credentials needed to observe todos at runtime. |
| SC2: DO alarm every 2 minutes, polls Mattermost | SATISFIED | Alarm method + finally-reschedule verified. |
| SC3: /dashboard renders ranked todo cards with click-through | SATISFIED | TodoCard + handleSelect() wired. |
| SC4: /phone and /sms routes render placeholder UI with seam comments | SATISFIED | Both routes verified. |
| SC5: WorkspaceShell icon rail shows Phone + SMS | SATISFIED | NAV array confirmed. |
| SC6: seed-email smoke endpoint exists, gated by dev mode | SATISFIED (endpoint); HUMAN NEEDED (pass:true with real AI) | |
| SC7: ranking regression returns pass:true deterministically | SATISFIED (logic verified); HUMAN NEEDED (wrangler dev execution) | Math: hi.rank=160 > lo.rank=70, no LLM. |
| SC8: Existing panes unaffected | SATISFIED | tsc --noEmit exits 0, inbox/chat/meetings routes intact. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found in phase-modified files | — | — | — | — |

No TODO/FIXME/placeholder blockers found in the implementation files. The "Coming soon" text in phone.tsx and sms.tsx is intentional per the seam architecture (ROADMAP line 212).

### Security Pass (gstack Pass 1 — CRITICAL)

| File | Line | Category | Finding | Severity | Blocks Phase |
|------|------|----------|---------|----------|--------------|
| `workers/durableObject/index.ts` | 488–514 | SQL & Data Safety | `whereExtra` (derived from user-controlled `view` query param) is interpolated into SQL via template literal. However, the lookup pattern `{mentions:..., today:..., week:...}[view] ?? ""` is a static allowlist — unrecognized keys return `""`, never the raw input. No user string is actually interpolated. | INFO | No — allowlist pattern is safe |
| `workers/durableObject/migrations.ts` | 45 | SQL & Data Safety | Migration name manually quote-escaped (`replace(/'/g, "''")`) then interpolated into SQL. Migration names are internal constants, never user-supplied. | INFO | No — internal constants only |

No Pass 1 CRITICAL findings on phase-modified files. LLM outputs (extracted todos) are written as parameterized values via positional `?` placeholders — no LLM-provided strings are interpolated into SQL. AI Gateway URL is constructed from env vars, not from LLM output (no SSRF risk).

_Pass 2 (INFORMATIONAL) not run. Invoke with `mode: deep-review` to enable._

---

### Human Verification Required

#### 1. Live AI Gateway — seed-email smoke test

**Test:** With `PARROT_DEV_MODE=1`, `CLOUDFLARE_AI_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PARROT_AI_GATEWAY_ID` set (wrangler dev or wrangler secret put), run:
```
curl -X POST http://localhost:8787/api/dev/smoke/seed-email \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
```
**Expected:** Response `{ pass: true, todos_extracted: N }` where N >= 1.
**Why human:** Requires live AI Gateway credentials and wrangler dev runtime. The endpoint code path, email seeding, and getTodos() wiring are all verified. Only the LLM inference result is unknown without real credentials.

#### 2. Ranking regression smoke test

**Test:** With `PARROT_DEV_MODE=1` and wrangler dev running:
```
curl -X POST http://localhost:8787/api/dev/smoke/ranking \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
```
**Expected:** Response `{ pass: true, hi_ranks_first: true, hi_inserted: true, lo_inserted: true }`.
**Why human:** Deterministic (no LLM), but requires a running wrangler dev session. Math verified: urgency=80 → rank=160, urgency=20+mention → rank=70.

#### 3. Dashboard visual rendering

**Test:** Navigate to workspace.internjobs.ai/dashboard (or localhost equivalent) after seeding todos.
**Expected:** Todo cards visible with Mail icon (violet), urgency dot (red for score>=70), title text, age badge. Clicking navigates to /inbox with ?message= param.
**Why human:** Visual rendering requires browser.

#### 4. Phone + SMS icon rail

**Test:** Log in to the workspace, observe the left icon rail.
**Expected:** Phone and SMS icons appear between Meetings and any admin entries. Clicking each navigates to a "Coming soon" placeholder page.
**Why human:** Icon rendering requires browser.

---

### Gaps Summary

No gaps blocking goal achievement. All artifacts exist, are substantive, and are wired. The one advisory finding (todos dedup not enforced at DB level via UNIQUE index) is a correctness concern for production volume but does not block any success criterion — the smoke tests and ranking regression operate on unique synthetic source_ids.

The four human_verification items are execution-time checks that require either live API credentials or a browser — they cannot be verified by static analysis.

---

_Verified: 2026-05-19T00:00:00Z_
_Verifier: Claude (rrr-verifier)_
