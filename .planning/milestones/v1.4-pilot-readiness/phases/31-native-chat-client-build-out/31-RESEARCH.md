# Phase 31: Native Chat Client Build-Out - Research

**Researched:** 2026-06-19
**Domain:** Mattermost REST/WebSocket API + Cloudflare Worker proxy patterns
**Confidence:** HIGH (primary decisions grounded in existing code + official docs)

---

## Summary

The existing Parrot Worker (`workers/index.ts`) already has a `/api/chat/*` route group using `MATTERMOST_BOT_TOKEN` (a system-admin-privileged bot) to proxy all chat calls through one identity — the bot. Wave 0's job is to replace that single bot identity with per-employee personal access tokens (PATs), stored Worker-side so the PAT never reaches the browser. The rest of the waves layer chat features on top of that unlocked identity model.

**Critical finding confirmed:** Mattermost personal access tokens are available in Team Edition (free/unlicensed). The feature is governed by `ServiceSettings.EnableUserAccessTokens = true` (a Fly env var), not by a paid license gate. The REST endpoint `POST /api/v4/users/{user_id}/tokens` creates a PAT for any user when called with an admin token that holds `create_user_access_token` + `edit_other_users` permissions. This is the Wave 0 linchpin and it is NOT blocked.

**Primary recommendation:** Store per-user PATs in the `WorkspaceDO` SQLite — add a `mm_access_token` column to the `employees` table. This is the single source of truth for the employee directory already, requires no new infra, has zero cold-start latency (it is read via DO RPC on every proxied call anyway), and is encrypted at rest by Cloudflare's SQLite storage layer. All five open technical decisions resolve cleanly against the existing stack.

---

## Critical: MM Team Edition + Personal Access Token Availability

**Confidence: HIGH** (multiple official sources + confirmed the exact setting)

PATs are a core open-source Mattermost feature, NOT a paid Enterprise feature. Confirmed:

- `ServiceSettings.EnableUserAccessTokens` must be `true` on the server.
- On the Fly MM deployment this becomes: `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` set as a Fly secret.
- The existing Fly env already has `MATTERMOST_ADMIN_TOKEN` (a system-admin PAT for `parrot-admin` user) in Worker secrets. This token is what Wave 0 will use to call `POST /api/v4/users/{user_id}/tokens`.
- The `create_user_access_token` + `edit_other_users` permissions are held by any System Admin account — `parrot-admin` is already a System Admin.
- The "enable personal access tokens for a user" step in the System Console (granting the per-user `allow_access_token_creation` role) is NOT required when an admin creates tokens via the API on behalf of that user. The admin just needs the two permissions above.

**Wave 0 mint recipe:**
```
POST /api/v4/users/{mm_user_id}/tokens
Authorization: Bearer {MATTERMOST_ADMIN_TOKEN}
Content-Type: application/json
{ "description": "parrot-workspace" }

Response: { "id": "...", "token": "<PAT>", "description": "...", "user_id": "..." }
```

**Wave 5 secret hygiene:**
- Set `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` via `flyctl secrets set` on `internjobs-mattermost`.
- Unset any legacy `ENABLEPERSONALACCESSTOKENS` env var if it exists (it was an older env-var name, now superseded by the `ServiceSettings.*` naming).
- Existing `MATTERMOST_ADMIN_TOKEN` in Worker secrets is already the right credential for token minting — no new secrets needed for Wave 0.

---

## Open Technical Decision Resolutions

### Decision 1: Per-user MM token storage

**Recommendation: WorkspaceDO SQLite — add `mm_access_token TEXT` column to `employees` table.**

**Rationale:**

The `WorkspaceDO` is already the singleton source of truth for the employee directory. Every proxied `/api/chat/*` call already calls `getEmployeeByClerkId()` (via `enrichEmployeeFromDirectory` in `app.ts`) as part of auth. Adding `mm_access_token` to the same row means no extra roundtrip — the token is co-located with the data the Worker already reads.

| Option | Cold-start latency | Encryption at rest | New infra | Backfill story |
|--------|-------------------|-------------------|-----------|----------------|
| **WorkspaceDO SQLite (recommended)** | Zero extra — already reading this row | Yes (Cloudflare SQLite) | None | One migration + backfill loop in Wave 0 |
| Workers KV | ~1-5ms extra read | Yes (KV encrypted) | Needs new KV namespace | Same backfill, but scattered across KV |
| Clerk `privateMetadata` | ~50-200ms Clerk API call per request | Yes | None | Clerk API calls, rate-limited |
| Encrypted column (manual) | Zero (same row) | Yes (application-layer) | None | Same as plain column + AES key secret |

The Workers KV option has higher latency and scatters state. Clerk `privateMetadata` adds a 50-200ms Clerk API call on every proxied chat request — unacceptable. Manual encryption is unnecessary: Cloudflare's SQLite-backed DO storage is encrypted at rest by default.

**Migration plan (Wave 0):**
```sql
-- WorkspaceDO migration #2 (add to WORKSPACE_MIGRATIONS array)
ALTER TABLE employees ADD COLUMN mm_access_token TEXT;
ALTER TABLE employees ADD COLUMN mm_user_id TEXT;
```
Add `getEmployeeToken(clerkUserId)` and `setEmployeeToken(clerkUserId, mmUserId, token)` methods to `WorkspaceDO`. The backfill loop in Wave 0's admin route iterates `listEmployees()`, calls MM to mint a token for each, and writes it back.

**Confidence: HIGH**

---

### Decision 2: Hybrid authorship

**Recommendation: YES — keep the `parrot` bot for system/agent messages; humans post under their own PAT.**

**Rationale:**

The existing `createMmParrotPost()` function posts via the bot token and attaches `parrot_author_*` props so the Parrot UI can render the real author name. Wave 0 replaces this for human messages only: when posting, the Worker uses the requesting employee's PAT instead of the bot token, and the post appears in MM as that employee's real MM account. No `parrot_author_*` props needed for human posts — the `user_id` on the post IS the real user.

The bot must stay active for:
- Agent/system-generated messages (the Parrot AI agent posts under the bot identity — this is correct and desired)
- `email-to-chat` cross-pane action (still a bot-mediated system message)
- Initial team/channel membership setup via `ensureMmWorkspaceMembership` (bot needs `edit_other_users` for this)
- Any future webhook/notification post

**Mechanism:**
```typescript
// Wave 0: resolve token, then proxy with it
const employeeRow = await getWorkspaceStub(env).getEmployeeByClerkId(clerkUserId);
const userToken = employeeRow?.mm_access_token;
if (!userToken) { /* fall back to bot proxy or return 503 */ }
// Use userToken instead of botToken for all human-authored REST calls
```

The `loadChatContext()` function in `index.ts` must be refactored: resolve the employee's PAT from WorkspaceDO, and use it for all MM REST calls that represent the employee's own actions. `MATTERMOST_BOT_TOKEN` remains for admin operations.

**Confidence: HIGH**

---

### Decision 3: WebSocket path

**Recommendation: Worker-proxied WebSocket — browser connects to `wss://workspace.internjobs.ai/api/chat/ws`, Worker holds the PAT server-side and proxies to `wss://chat.internjobs.ai/api/v4/websocket`.**

**Rationale:**

The employee's PAT must never reach the browser. If the browser connected directly to MM's WebSocket endpoint, the `authentication_challenge` message would expose the PAT in browser memory / DevTools. The Worker-proxy model preserves the "Mattermost is an internal engine, not a separate app surface" architectural principle established in the `chat-oidc-iframe.md` debug log.

**Cloudflare Worker WebSocket proxying is fully supported (HIGH confidence, official docs confirmed):**
- `fetch()` with `Upgrade: websocket` header upgrades to a client-side WebSocket.
- The Worker uses `new WebSocketPair()` to create the browser-facing server socket.
- Pass `{ allowHalfOpen: true }` to `accept()` to support independent closure on both sides.
- The Worker pipes messages bidirectionally: browser → MM and MM → browser.
- MM WebSocket auth uses `authentication_challenge` action sent immediately after connect — Worker sends this with the PAT before forwarding any data from the browser.

**MM WebSocket connect sequence (Worker-side):**
```
1. Worker opens: new WebSocket("wss://chat.internjobs.ai/api/v4/websocket")
2. Worker sends: {"seq":1,"action":"authentication_challenge","data":{"token":"<PAT>"}}
3. MM responds: {"event":"hello","data":{"server_version":"11.6.2..."},...}
4. Worker begins bidirectional proxy — browser never sees the auth challenge
```

**CORS:** Since the browser talks to `workspace.internjobs.ai` (same origin as all other `/api/*` calls), no CORS configuration is needed. The upgrade request is same-site.

**Worker WebSocket limits:** Cloudflare Workers support WebSocket connections on all plans. The paid tier enables longer-lived connections (no documented cap on simultaneous connections per Worker invocation for proxying). For the pilot scale (single-digit employees), this is non-issue. The DO-hosted WebSocket pattern exists but is over-engineering for this scale — a stateless proxy Worker suffices.

**Confidence: HIGH**

---

### Decision 4: Multipart file upload through the Worker proxy

**Recommendation: Pass the browser's `multipart/form-data` request body as a streaming `ReadableStream` directly to MM's `/api/v4/files` endpoint. Do NOT buffer to memory.**

**Rationale and implementation:**

Cloudflare Workers receive request bodies as `ReadableStream`. For multipart file uploads, the Worker should NOT call `c.req.formData()` (which buffers the entire body in memory). Instead, pipe the stream directly:

```typescript
// Worker route: POST /api/chat/files
// Forward the multipart body directly to MM, injecting the employee PAT
app.post("/api/chat/files", requireEmployeeMailbox, async (c) => {
  const userToken = await resolveEmployeeToken(c);
  if (!userToken) return c.json({ error: "not_provisioned" }, 503);

  const upstreamResp = await fetch(
    `${c.env.MATTERMOST_URL}/api/v4/files?channel_id=${channelId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": c.req.header("content-type") ?? "multipart/form-data",
      },
      body: c.req.raw.body, // stream directly — no buffering
      // @ts-ignore: duplex required for streaming in some runtimes
      duplex: "half",
    }
  );
  const data = await upstreamResp.json();
  return c.json(data, upstreamResp.status as 200);
});
```

**Worker body size limit:** Cloudflare Workers have a 100MB request body limit. MM's default max file size is also configurable but defaults to 50MB. No buffering required — stream pass-through is the correct pattern.

**Resulting `file_ids`:** MM `/api/v4/files` returns `{ file_infos: [{ id: "..." }] }`. The client then includes `file_ids: ["..."]` in the subsequent `POST /api/v4/posts` body.

**Confidence: HIGH** (official CF Workers streaming pattern, confirmed by community)

---

### Decision 5: Fly secret hygiene (Wave 5)

**Recommendation: Set exactly one env var; unset legacy stray if present.**

**Steps:**
```bash
# On internjobs-mattermost Fly app:
flyctl secrets set MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true \
  --app internjobs-mattermost

# Check for and unset stray legacy var (may not exist — check first):
flyctl secrets list --app internjobs-mattermost
# If ENABLEPERSONALACCESSTOKENS exists:
flyctl secrets unset ENABLEPERSONALACCESSTOKENS --app internjobs-mattermost
```

**Note:** `mmctl config set ServiceSettings.EnableUserAccessTokens true` does NOT work on this Fly deployment because config is pinned by `MM_*` env vars that override the DB-stored config. Fly env vars are the only authoritative path. This was confirmed in prior work (`mm-oidc-sso-blocked-by-license.md` — same pattern applies here).

**Confidence: HIGH** (matches the known Fly/MM env-var-pinned config pattern)

---

## Standard Stack

### Core — no new dependencies needed

| Component | What it is | Why standard |
|-----------|-----------|-------------|
| `workers/lib/mattermost.ts` | Existing MM REST helper (mmFetch, createMmUser, etc.) | Already in codebase — extend, don't replace |
| `WorkspaceDO` | Singleton DO with employee directory SQLite | Adding `mm_access_token` + `mm_user_id` columns |
| Hono routes | Worker router already in use | All new `/api/chat/*` routes use Hono |
| React + existing ChatPane | `app/routes/workspace.chat*.tsx` component tree | Extend existing component, not rebuild |

### Supporting — no new npm packages required

- WebSocket proxying: Cloudflare runtime `WebSocket` API (built-in, no package)
- MM WebSocket auth: plain JSON message send (no library)
- File upload: native `fetch()` with stream body (no `form-data` package needed)
- Emoji reactions: MM REST `/api/v4/reactions` POST/DELETE (no library)
- @mention parsing: RegExp `/\B@(\w+)/g` on message text (no library)
- Search: MM REST `POST /api/v4/posts/search` (no library)

### Alternatives explicitly rejected

| Instead of | Rejected option | Why rejected |
|-----------|-----------------|-------------|
| WorkspaceDO SQLite | Workers KV for token storage | Extra latency, scattered state |
| Worker-proxied WS | Browser direct to MM WS | Exposes PAT to browser |
| Stream proxy for files | Buffer in Worker memory | 100MB limit + unnecessary memory use |
| Extend existing ChatPane | New chat component from scratch | 6 waves of brownfield work, not greenfield |

### Installation — no new packages

No new npm dependencies are needed for any Wave 0-5 work. All primitives (fetch, WebSocket, crypto) are Cloudflare runtime built-ins.

---

## Architecture Patterns

### Recommended structure additions

```
workers/
├── lib/
│   ├── mattermost.ts         # EXTEND: add PAT-based helpers, keep bot helpers
│   └── mm-ws-proxy.ts        # NEW Wave 4: WebSocket proxy helper
├── routes/
│   ├── chat-proxy.ts         # NEW Wave 0: replaces inline /api/chat/* in index.ts
│   └── chat-files.ts         # NEW Wave 3: /api/chat/files multipart proxy
app/routes/
└── workspace.chat.tsx        # EXTEND across all waves (single file or split)
workers/durableObject/
└── workspace.ts              # ADD mm_access_token/mm_user_id migration + methods
```

### Pattern 1: Token-carrying proxy helper (Wave 0+)

Extract a `mmFetchAsUser(env, clerkUserId, path, init)` helper that:
1. Resolves employee's PAT from WorkspaceDO (`getEmployeeToken`)
2. Calls `mmFetch` with that token instead of `MATTERMOST_BOT_TOKEN`
3. On 401 response: attempts to re-mint the token (PATs can be revoked by MM admins) and retries once

```typescript
// Proposed signature in workers/lib/mattermost.ts
export async function mmFetchAsUser<T>(
  env: Env,
  clerkUserId: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; data: unknown }>
```

### Pattern 2: WorkspaceDO token methods (Wave 0)

```typescript
// Add to WorkspaceDO class
async getEmployeeToken(clerkUserId: string): Promise<{ mmUserId: string; token: string } | null>
async setEmployeeToken(clerkUserId: string, mmUserId: string, token: string): Promise<void>
async backfillTokens(adminToken: string, mmUrl: string): Promise<{ minted: number; failed: number }>
```

### Pattern 3: WebSocket proxy (Wave 4)

```typescript
// workers/lib/mm-ws-proxy.ts
export async function handleChatWebSocket(
  request: Request,
  env: Env,
  clerkUserId: string,
): Promise<Response> {
  const { 0: client, 1: server } = new WebSocketPair();
  const pat = await getEmployeeToken(env, clerkUserId);
  const upstream = new WebSocket(`${env.MATTERMOST_WS_URL}/api/v4/websocket`);
  // 1. On upstream open: send authentication_challenge with PAT
  // 2. Bidirectional pipe: client.onmessage → upstream.send, upstream.onmessage → client.send
  // 3. allowHalfOpen: true for clean shutdown
  server.accept({ allowHalfOpen: true });
  return new Response(null, { status: 101, webSocket: client });
}
```

`MATTERMOST_WS_URL` = `wss://chat.internjobs.ai` (already in wrangler vars as `MATTERMOST_URL` but with `https://` — derive `wss://` by replacing scheme).

### Pattern 4: Direct/group DM channel creation (Wave 2)

MM DMs are channels of type `D` (direct) or `G` (group). Creation:
- Direct DM: `POST /api/v4/channels/direct` with body `[user_id_1, user_id_2]`
- Group DM: `POST /api/v4/channels/group` with body `[user_id_1, user_id_2, ...]`

Both require the requesting user to be one of the participants. Use the employee's PAT (not the bot) so the resulting DM channel is visible to that user.

### Pattern 5: Thread replies via `root_id` (Wave 1)

A thread reply is a regular post with `root_id` set:
```json
POST /api/v4/posts
{ "channel_id": "...", "message": "...", "root_id": "parent_post_id" }
```
The root post has `reply_count > 0` after replies. Fetch a thread: `GET /api/v4/posts/{post_id}/thread`.

### Anti-patterns to avoid

- **Buffering multipart bodies in the Worker:** calling `c.req.formData()` buffers everything in memory. Use `c.req.raw.body` (the ReadableStream) directly.
- **Exposing PAT to the browser in any form:** not in API responses, not in JS state, not in HTML. The PAT lives only in WorkspaceDO and Worker memory during a request.
- **Creating a new DO class for chat state:** the WorkspaceDO already exists; add columns to the existing `employees` table rather than creating a new DO.
- **Polling as the real-time solution for Wave 4:** the existing 5-second `setInterval` polling pattern in ChatPane must be replaced by WebSocket in Wave 4, not improved.
- **Trying to re-use OIDC token flow for PATs:** the OIDC bridge (oidc.ts) is for the old SSO path (now blocked by license). Don't touch it for Phase 31.
- **Using `mmctl --local` for token minting in the Worker:** `mmctl --local` runs on the Fly host; the Worker is a Cloudflare process that cannot shell out. Token minting must use the MM REST API (`POST /api/v4/users/{user_id}/tokens`) via HTTP from the Worker, using `MATTERMOST_ADMIN_TOKEN`.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|------------|-------------|-----|
| Per-user token storage | Custom encryption + KV | WorkspaceDO SQLite column | Already encrypted at rest; zero extra infra |
| WebSocket auth handshake | Custom protocol | MM's `authentication_challenge` action | Official MM WS auth, documented |
| Multipart streaming | Custom FormData parser | Pass `request.body` stream | Native fetch streaming is correct pattern |
| @mention parsing | NLP library | `/\B@(\w+)/g` RegExp + user lookup | MM usernames are simple identifiers |
| Presence/status | Custom presence system | `GET /api/v4/users/status/ids` + WS `status_change` event | MM owns presence state |
| Thread rendering | Custom thread model | MM's `root_id` field + `/api/v4/posts/{id}/thread` | MM's data model is the source of truth |
| Unread counts | Custom read-tracking | MM's `/api/v4/channels/members/me/view` + WS `channel_viewed` | MM tracks unread natively |

---

## MM REST Endpoints by Wave

### Wave 0 — Token provisioning

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/v4/users/{user_id}/tokens` | Admin PAT | Mint employee PAT |
| `GET /api/v4/users/email/{email}` | Bot | Resolve MM user_id by email (already in codebase) |

### Wave 1 — Channels + threads

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/v4/teams/{team_id}/channels` | User PAT | Browse public channels |
| `POST /api/v4/channels` | User PAT | Create public channel |
| `POST /api/v4/channels/{channel_id}/members` | User PAT | Join channel |
| `GET /api/v4/channels/{channel_id}/posts` | User PAT | Load messages |
| `POST /api/v4/posts` | User PAT | Send message (+ thread reply via `root_id`) |
| `PUT /api/v4/posts/{post_id}` | User PAT | Edit message |
| `DELETE /api/v4/posts/{post_id}` | User PAT | Delete message |
| `POST /api/v4/channels/{channel_id}/posts/pin` | User PAT | Pin post |
| `GET /api/v4/posts/{post_id}/thread` | User PAT | Load thread |

### Wave 2 — DMs + group DMs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/v4/channels/direct` | User PAT | Create/open DM |
| `POST /api/v4/channels/group` | User PAT | Create/open group DM |
| `GET /api/v4/users/me/channels` | User PAT | List DM channels |
| `POST /api/v4/users/ids` | Bot | Batch-resolve user display info (already in codebase as `getMmUsersByIds`) |

### Wave 3 — Files, search, reactions, @mentions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/v4/files?channel_id={id}` | User PAT | Upload file, returns `file_ids` |
| `GET /api/v4/files/{file_id}` | User PAT | Download/preview file |
| `POST /api/v4/posts/search` | User PAT | Global search (`{ "terms": "...", "is_or_search": false }`) |
| `POST /api/v4/reactions` | User PAT | Add reaction (`{ user_id, post_id, emoji_name }`) |
| `DELETE /api/v4/users/{user_id}/posts/{post_id}/reactions/{emoji_name}` | User PAT | Remove reaction |
| `GET /api/v4/posts/{post_id}/reactions` | User PAT | List reactions |

### Wave 4 — WebSocket

| WS Event | Direction | Purpose |
|----------|-----------|---------|
| `authentication_challenge` (action) | Client → Server | Auth with PAT immediately after connect |
| `hello` | Server → Client | Confirms auth success, contains server version |
| `posted` | Server → Client | New post in a channel the user is member of |
| `post_edited` | Server → Client | Post was edited |
| `post_deleted` | Server → Client | Post was deleted |
| `typing` | Server → Client | Another user is typing in a channel |
| `status_change` | Server → Client | User presence status changed |
| `direct_added` | Server → Client | User added to a DM |
| `channel_viewed` | Server → Client | Channel marked as read |
| `user_updated` | Server → Client | User profile changed |

**Typing action (Client → Server):**
```json
{ "seq": 2, "action": "user_typing", "data": { "channel_id": "...", "parent_id": "" } }
```

---

## Common Pitfalls

### Pitfall 1: PAT minting without server setting enabled

**What goes wrong:** `POST /api/v4/users/{user_id}/tokens` returns 501 or 403 with "User access tokens are disabled."
**Root cause:** `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS` not set on the Fly app (defaults to `false`).
**How to avoid:** Wave 5 must set this before Wave 0 code runs in production. In development/staging, set it on the local MM instance.
**Warning sign:** Response body contains `id: "api.user.create_user_access_token.disabled.app_error"`.

### Pitfall 2: Using bot token where user PAT is required

**What goes wrong:** Messages posted under the bot token show as the "parrot" bot in MM, not the employee. DMs created with bot token may not be visible to the employee.
**Root cause:** Many existing `/api/chat/*` routes use `chat.botToken` from `loadChatContext()`. After Wave 0, human-action routes must use the employee's PAT.
**How to avoid:** `loadChatContext()` must be replaced or extended in Wave 0 to return the user PAT. Keep bot token only for admin operations.

### Pitfall 3: Fly env var config cannot be changed via mmctl

**What goes wrong:** `mmctl config set ServiceSettings.EnableUserAccessTokens true` appears to succeed but the server ignores it.
**Root cause:** When `MM_*` env vars are set on the Fly app, they override the database-stored config. `mmctl` writes to the DB, but the env var wins at startup.
**How to avoid:** ALWAYS use `flyctl secrets set MM_SERVICESETTINGS_*` for config on this deployment. Confirmed in `mm-oidc-sso-blocked-by-license.md` memory note.

### Pitfall 4: WebSocket connection dropped when Worker instance terminates

**What goes wrong:** The proxied WebSocket silently closes when the Cloudflare Worker isolate is recycled.
**Root cause:** Cloudflare Workers have an isolate lifetime. A Worker handling a WebSocket upgrade stays alive as long as the connection is open, but has a 6-minute CPU wall-clock limit on Workers Free, and longer on Paid. For active chat sessions this is fine.
**How to avoid:** The browser-side WebSocket client must implement reconnect-with-backoff. On reconnect, the Worker re-authenticates with MM using the same PAT. Session state (active channel) is in the browser; no server-side session to restore.
**Warning sign:** Browser WS `onclose` fires without explicit close from either side.

### Pitfall 5: `loadChatContext()` called on every request (N+1 DO reads)

**What goes wrong:** The current `loadChatContext()` calls `ensureMmWorkspaceMembership()` (which does multiple MM REST calls) on EVERY `/api/chat/*` request.
**Root cause:** `index.ts` calls `loadChatContext()` inside each route handler. In Wave 0 this becomes even more expensive because it now also resolves the PAT from the DO.
**How to avoid:** Split `loadChatContext()` into a lightweight token-resolution path (DO read only) for data-path requests, and keep the full membership-ensure path only for bootstrap/first-time flows.

### Pitfall 6: `parrot_author_*` props on human posts

**What goes wrong:** After Wave 0, the Parrot client still reads `parrot_author_*` props from posts made by the bot — these props are now absent from human posts (because they're posted under the real user's PAT).
**Root cause:** The current `ChatPane` uses `props.parrot_author_name` as the display name for all posts. After Wave 0, human posts have no `props.parrot_author_*`; the `user_id` on the post IS the display key.
**How to avoid:** Wave 0 must update the client-side post renderer to: (1) if `props.parrot_author_user_id` exists, use the parrot props (bot/agent messages); (2) otherwise resolve the `user_id` against the `users` map from `/api/chat/users`.

### Pitfall 7: MM WebSocket CORS on non-proxied path

**What goes wrong:** If a browser WebSocket connects directly to `wss://chat.internjobs.ai/api/v4/websocket`, MM may reject it with a CORS error or the PAT would be visible in the browser.
**Root cause:** MM's CORS configuration allows same-origin only; cross-origin WS from `workspace.internjobs.ai` to `chat.internjobs.ai` may be blocked.
**How to avoid:** Always proxy through `wss://workspace.internjobs.ai/api/chat/ws` — the Worker-side proxy handles CORS by construction (the browser sees only the workspace domain).

---

## Code Examples

### WorkspaceDO migration + methods (Wave 0)

```typescript
// workers/durableObject/workspace.ts — add to WORKSPACE_MIGRATIONS
{
  name: "3_mm_tokens",
  sql: `
    ALTER TABLE employees ADD COLUMN mm_user_id TEXT;
    ALTER TABLE employees ADD COLUMN mm_access_token TEXT;
  `,
},

// New methods on WorkspaceDO class:
async getEmployeeToken(clerkUserId: string): Promise<{ mmUserId: string; token: string } | null> {
  const row = [...this.ctx.storage.sql.exec(
    `SELECT mm_user_id, mm_access_token FROM employees WHERE clerk_user_id = ? AND mm_access_token IS NOT NULL`,
    clerkUserId,
  )][0] as { mm_user_id: string; mm_access_token: string } | undefined;
  if (!row) return null;
  return { mmUserId: row.mm_user_id, token: row.mm_access_token };
}

async setEmployeeToken(clerkUserId: string, mmUserId: string, token: string): Promise<void> {
  this.ctx.storage.sql.exec(
    `UPDATE employees SET mm_user_id = ?, mm_access_token = ? WHERE clerk_user_id = ?`,
    mmUserId, token, clerkUserId,
  );
}
```

### Minting a PAT for a user (Wave 0, in admin-employees.ts or new chat-provisioning route)

```typescript
// workers/lib/mattermost.ts — new helper
export async function mintMmUserToken(
  mattermostUrl: string,
  adminToken: string,
  mmUserId: string,
): Promise<string | null> {
  const resp = await mmFetch<{ token: string }>(
    mattermostUrl,
    adminToken,
    `/api/v4/users/${mmUserId}/tokens`,
    { method: "POST", body: JSON.stringify({ description: "parrot-workspace" }) },
  );
  return resp.ok ? resp.data.token : null;
}
```

### Worker WebSocket proxy (Wave 4 skeleton)

```typescript
// workers/routes/chat-proxy.ts
app.get("/api/chat/ws", requireEmployeeMailbox, async (c) => {
  const upgradeHeader = c.req.header("upgrade");
  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }
  const employee = c.var.employee;
  const tokenRow = await getWorkspaceStub(c.env).getEmployeeToken(employee.employeeId);
  if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);

  const { 0: client, 1: server } = new WebSocketPair();

  // Connect to MM WebSocket upstream
  const mmWsUrl = c.env.MATTERMOST_URL.replace(/^https/, "wss") + "/api/v4/websocket";
  const upstream = new WebSocket(mmWsUrl);

  upstream.addEventListener("open", () => {
    // Send auth challenge BEFORE forwarding browser data
    upstream.send(JSON.stringify({
      seq: 1,
      action: "authentication_challenge",
      data: { token: tokenRow.token },
    }));
  });

  // Bidirectional proxy
  upstream.addEventListener("message", (evt) => { server.send(evt.data); });
  server.addEventListener("message", (evt) => { upstream.send(evt.data); });
  upstream.addEventListener("close", () => { server.close(); });
  server.addEventListener("close", () => { upstream.close(); });

  server.accept({ allowHalfOpen: true });
  return new Response(null, { status: 101, webSocket: client });
});
```

---

## State of the Art

| Old approach | Current approach | Changed | Impact |
|-------------|-----------------|---------|--------|
| Bot-proxied posts (`parrot_author_*` props) | Human posts under user PAT | Wave 0 | Authorship is real; no prop-based display hacks |
| 5s polling in ChatPane | MM WebSocket | Wave 4 | Instant delivery, typing, presence |
| iFrame + OIDC SSO | Native Parrot chat UI | Already shipped | Session boundary owned by Parrot |

**Deprecated/outdated in this codebase after Phase 31:**
- `parrot_author_*` post props: only used for bot/agent messages after Wave 0
- `loadChatContext()` bot-centric flow: replaced by PAT-centric flow
- `/api/chat/config` stub route (currently returns `not_implemented_wave_2`): will be replaced or removed

---

## Open Questions

1. **Token revocation / rotation**
   - What we know: MM PATs can be revoked by an admin. The Worker has no mechanism to detect a revoked token until it gets a 401 from MM.
   - What's unclear: should there be a periodic re-mint (e.g., 90-day rotation) or only on-demand re-mint on 401?
   - Recommendation: implement 401-triggered re-mint in Wave 0 (call `mintMmUserToken` again and update WorkspaceDO). Periodic rotation can be a Wave 5 hardening item.

2. **Backfill for employees provisioned before Wave 0**
   - What we know: there are existing employees in WorkspaceDO who have MM accounts (created by `ensureMmWorkspaceMembership`) but no PAT in the `mm_access_token` column.
   - What's unclear: exact count (runtime data, not code).
   - Recommendation: Wave 0 must include a backfill admin endpoint (`POST /api/admin/chat/backfill-tokens`) that iterates `listEmployees()`, resolves each employee's MM user_id, mints a PAT, and stores it. This must run before Wave 0 is considered complete.

3. **MATTERMOST_WS_URL env var**
   - What we know: `MATTERMOST_URL` in wrangler.jsonc is `https://chat.internjobs.ai`. The WebSocket proxy needs `wss://chat.internjobs.ai`.
   - What's unclear: whether `chat.internjobs.ai` (the CSP-rewriting proxy) supports WebSocket upgrade pass-through.
   - Recommendation: derive `wss://` from `MATTERMOST_URL` by replacing scheme (`https://` → `wss://`). If `chat.internjobs.ai` is an nginx proxy, confirm it passes `Upgrade: websocket` through to the Fly MM backend. If not, add a separate `MATTERMOST_WS_URL` var pointing at `wss://internjobs-mattermost.fly.dev` directly (the PAT is not exposed in the URL — only in the WS frame). This should be checked in Wave 4 prep.

---

## Sources

### Primary (HIGH confidence)
- MM official docs: `ServiceSettings.EnableUserAccessTokens` — available in Team Edition, enabled via env var on Fly. [Personal access tokens reference](https://developers.mattermost.com/integrate/reference/personal-access-token/)
- MM official docs: `POST /api/v4/users/{user_id}/tokens` requires `create_user_access_token` + `edit_other_users` — admin can mint for any user. [Postman API reference](https://www.postman.com/api-evangelist/mattermost/request/x60tv5q/create-a-user-access-token)
- Cloudflare official docs: WebSocket proxying with `allowHalfOpen: true`. [WebSockets · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- MM WebSocket auth: `authentication_challenge` action with token. [mattermost-api-reference introduction.yaml](https://github.com/mattermost/mattermost-api-reference/blob/master/v4/source/introduction.yaml)
- Existing codebase: `workers/lib/mattermost.ts`, `workers/index.ts` `/api/chat/*` routes, `workers/durableObject/workspace.ts`, `workers/types.ts`, `wrangler.jsonc`
- Debug log: `.planning/debug/chat-oidc-iframe.md` — session boundary architecture decisions

### Secondary (MEDIUM confidence)
- WebSearch + mmctl documentation: `mmctl config set ServiceSettings.EnableUserAccessTokens true` confirmed available for Team Edition. [Stackhero docs](https://www.stackhero.io/en-US/services/Mattermost/documentations/Getting-started)
- Cloudflare community: streaming multipart body proxy pattern. [CF Community thread](https://community.cloudflare.com/t/how-do-i-stream-a-file-upload-from-a-client-to-an-external-server-with-cloudflare-workers/497382)

---

## Metadata

**Confidence breakdown:**
- Wave 0 PAT linchpin (MM Team Edition support): HIGH — confirmed PATs are a free feature; admin API endpoint documented
- Token storage (WorkspaceDO SQLite): HIGH — matches existing architecture patterns in codebase
- Hybrid authorship: HIGH — directly follows existing `parrot_author_*` prop pattern
- WebSocket proxy: HIGH — CF Workers WS proxying is officially documented
- File upload streaming: HIGH — native CF Workers streaming pattern
- Fly secret hygiene: HIGH — consistent with confirmed Fly env-var-override behavior for MM config
- MM REST endpoint catalog: HIGH — Mattermost REST API is well-documented and stable since v4
- WS event list: MEDIUM — events verified via official API reference PR + forum posts, not tested live on 11.6.2

**Research date:** 2026-06-19
**Valid until:** 2026-09-19 (MM REST API is stable; Cloudflare WS API stable)
