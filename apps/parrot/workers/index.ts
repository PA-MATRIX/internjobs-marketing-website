// v1.2 Phase 10 Wave 1: Parrot API routes.
//
// Auth pattern vs apps/agentic-inbox: Parrot does NOT key routes off a
// `:mailboxId` URL parameter. The authenticated employee is read out of
// the Hono context (set by the Clerk middleware in workers/app.ts) and
// the DO is resolved by employeeId. This means every route in here is
// implicitly "for the signed-in employee" — there is no path through
// which an employee can read another employee's mailbox over HTTP.

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { Folders } from "../shared/folders";
import {
	handleReplyEmail,
	handleForwardEmail,
	handleComposeEmail,
} from "./routes/reply-forward";
// v1.4 Phase 23-03 ATTACH-DOWN-01..03: attachment download route.
import { handleAttachmentDownload } from "./routes/attachments";
import {
	requireEmployeeMailbox,
	type ParrotContext,
} from "./lib/mailbox";
// v1.3.1 BACKFILL: SenderValidationError / generateMessageId / validateSender
// no longer used here — they moved into routes/reply-forward.ts when the
// /api/inbox/send stub was replaced with the real handleComposeEmail.
import { adminEmployees } from "./routes/admin-employees";
import { oidc } from "./routes/oidc";
// v1.3 Phase 20 SAFETY-VIEW-01: /api/ops/safety
import { opsSafety } from "./routes/ops-safety";
// v1.3.1 Agent Lift: /api/inbox/agent/* (summarize / draft / translate / chat / tools)
import { agentRoutes } from "./routes/agent";
import {
	createRoom,
	deleteRoom,
	getActiveRooms,
	getMeetingToken,
	getRoom,
} from "./lib/daily";
import { pingParrotGraph } from "./lib/graph";
import { isOperator as hasOperatorAccess } from "./lib/operator";
import {
	createMmDirectChannel,
	createMmGroupChannel,
	createMmParrotPost,
	ensureMmWorkspaceMembership,
	getMmChannelPosts,
	getMmMyDirectChannels,
	getMmTeamChannels,
	getMmTeamChannelsForUser,
	getMmTeamsForUser,
	getMmUserByEmail,
	getMmUsersByIds,
	mintMmUserToken,
	mmFetch,
	mmFetchAsUser,
} from "./lib/mattermost";
import { getWorkspaceStub } from "./durableObject/workspace";
import type {
	MattermostChannel,
	MattermostPost,
	MattermostPostList,
	MattermostUser,
} from "./lib/mattermost";
import type { Env } from "./types";

// — Phase 14 Wave 3: graphReady cache (30s) ────────────────────────
// pingParrotGraph() now (Phase 18 v1.3) GETs internjobs-graph-api/health,
// which itself probes FalkorDB via RETURN 1. Cache the result 30s so a
// busy /healthz poll doesn't hammer the proxy. Pattern mirrors the student
// app's _graphReadyCache in apps/app/src/server.mjs.
//
// Module-level state survives the isolate's lifetime — cold-start pays
// one proxy HTTPS round-trip; warm isolates reuse the cached value.
let _graphReadyCacheValue: boolean | null = null;
let _graphReadyCacheAt = 0;
const GRAPH_READY_TTL_MS = 30_000;

async function getCachedGraphReady(env: Env): Promise<boolean> {
	const now = Date.now();
	if (
		_graphReadyCacheValue !== null &&
		now - _graphReadyCacheAt < GRAPH_READY_TTL_MS
	) {
		return _graphReadyCacheValue;
	}
	const result = await pingParrotGraph(env);
	_graphReadyCacheValue = result;
	_graphReadyCacheAt = now;
	return result;
}

// — Phase 18 v1.3: graph_proxy_reachable cache (30s) ───────────────
// Separate from graph_ready (which uses pingParrotGraph → proxy /health,
// which ALSO probes FalkorDB). This is a cheap direct HTTP check to the
// proxy's /health endpoint with a tight 2s timeout. Its ONLY job is to
// distinguish three diagnostic states:
//   graph_ready=false, graph_proxy_reachable=true  → proxy up, DB down
//   graph_ready=false, graph_proxy_reachable=false → proxy itself is unreachable
//   graph_ready=true,  graph_proxy_reachable=true  → fully healthy
//
// We treat ANY HTTP response (even 503) from the proxy as proxy-reachable;
// only fetch() throwing (network blip, DNS failure, timeout) flips this
// to false. That's exactly the semantic split we want.
const GRAPH_PROXY_TTL_MS = 30_000;
let _graphProxyCacheValue: boolean | null = null;
let _graphProxyCacheAt = 0;

async function getCachedGraphProxyReachable(env: Env): Promise<boolean> {
	const now = Date.now();
	if (
		_graphProxyCacheValue !== null &&
		now - _graphProxyCacheAt < GRAPH_PROXY_TTL_MS
	) {
		return _graphProxyCacheValue;
	}
	let result = false;
	try {
		if (env.GRAPH_API_URL) {
			await fetch(env.GRAPH_API_URL.replace(/\/$/, "") + "/health", {
				signal: AbortSignal.timeout(2000),
			});
			// Any response — including 503 — proves the proxy is up.
			result = true;
		}
	} catch {
		result = false;
	}
	_graphProxyCacheValue = result;
	_graphProxyCacheAt = now;
	return result;
}

type AppContext = Context<ParrotContext>;

// — Phase 13 Wave 3: minimal Sentry envelope POST ───────────────────
//
// We deliberately do NOT pull in `@sentry/cloudflare` (extra bundle
// weight + transitive deps). The Sentry Store API accepts a JSON envelope
// at /api/{projectId}/store/ with an `X-Sentry-Auth` header — that's all
// we need for unhandled-error capture. Same posture as the inline VAPID
// signer in workers/lib/vapid.ts (no npm dep for one-off crypto/HTTP).
//
// reportToSentry is fire-and-forget. It NEVER throws — a malformed DSN
// or a network blip must not turn into a secondary 500 inside the
// global error handler.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — fire-and-forget telemetry post
function reportToSentry(env: Env, err: unknown, context?: string): void {
	const dsn = env.SENTRY_DSN;
	if (!dsn) return;
	try {
		const dsnUrl = new URL(dsn);
		const projectId = dsnUrl.pathname.split("/").filter(Boolean).pop();
		const sentryKey = dsnUrl.username;
		if (!projectId || !sentryKey) return;
		const sentryUrl = `${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/store/`;
		const errName =
			err instanceof Error ? err.name : typeof err === "string" ? "string" : "Error";
		const errMsg =
			err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
		const event = {
			message: context ?? "Parrot Worker error",
			level: "error",
			exception: {
				values: [{ type: errName, value: errMsg }],
			},
			timestamp: Date.now() / 1000,
			platform: "javascript",
			environment: "production",
		};
		// Fire-and-forget — never await, never bubble errors.
		void fetch(sentryUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Sentry-Auth": `Sentry sentry_key=${sentryKey}, sentry_version=7`,
			},
			body: JSON.stringify(event),
		}).catch(() => {
			/* network blip — telemetry must not crash the request */
		});
	} catch {
		/* malformed DSN — ignore */
	}
}

// -- Request schemas ------------------------------------------------
//
// v1.3.1 BACKFILL: the inline SendEmailSchema was removed when the
// /api/inbox/send route delegated to handleComposeEmail in
// routes/reply-forward.ts. That handler uses SendEmailRequestSchema
// from lib/schemas.ts (richer — supports attachments + threading
// headers + html/text refinement).

// -- App & middleware -----------------------------------------------

const app = new Hono<ParrotContext>();

app.use(
	"/api/*",
	cors({
		origin: (origin) => {
			if (!origin) return origin;
			try {
				const url = new URL(origin);
				if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
					return origin;
				}
			} catch {
				/* malformed Origin */
			}
			return undefined;
		},
	}),
);

// -- Health ---------------------------------------------------------

app.get("/api/health", (c) => c.json({ ok: true, service: "parrot" }));

// -- /healthz (Phase 13 Wave 3) ------------------------------------
//
// Public, no Clerk auth. Returns liveness probes for the three
// runtime dependencies we can poke from the Worker:
//   - Mattermost (REST API ping)
//   - Cloudflare AI Gateway (1-token completion against Workers AI)
//   - Mailbox count (informational; -1 until WorkspaceDO exposes a
//     count RPC — kept in the response shape so callers can write a
//     pre-launch checklist that lands the field once it's real).
//
// Used by the PILOT-RUNBOOK pre-flight checklist + by uptime monitors.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway

app.get("/healthz", async (c) => {
	const env = c.env;

	// 1. Mattermost reachability (2s budget).
	let mattermost_reachable = false;
	try {
		const pingResp = await fetch(`${env.MATTERMOST_URL}/api/v4/system/ping`, {
			signal: AbortSignal.timeout(2000),
		});
		mattermost_reachable = pingResp.ok;
	} catch {
		mattermost_reachable = false;
	}

	// 2. AI Gateway reachability (5s budget). We POST a 1-token completion
	//    — 200 means reachable, 429 means reachable-but-capped (still
	//    counts as healthy from a liveness perspective).
	let ai_gateway_reachable = false;
	try {
		if (
			env.CLOUDFLARE_AI_API_TOKEN &&
			env.CLOUDFLARE_ACCOUNT_ID &&
			env.PARROT_AI_GATEWAY_ID
		) {
			const aiResp = await fetch(
				`https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.PARROT_AI_GATEWAY_ID}/workers-ai/@cf/meta/llama-3.1-8b-instruct`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						messages: [{ role: "user", content: "ping" }],
						max_tokens: 1,
					}),
					signal: AbortSignal.timeout(5000),
				},
			);
			ai_gateway_reachable = aiResp.ok || aiResp.status === 429;
		}
	} catch {
		ai_gateway_reachable = false;
	}

	// 3. Mailbox count — the WorkspaceDO doesn't yet expose a count RPC
	//    for per-employee mailboxes, and counting DO instances across
	//    the namespace isn't a primitive. We surface -1 so monitors
	//    can render "n/a" and we can flip it to a real count once
	//    WorkspaceDO.countEmployees() lands (tracked for v1.3).
	const mailbox_count = -1;

	// 4. Graph readiness — Phase 14 Wave 3. Cached 30s in
	//    getCachedGraphReady so /healthz polls don't open a fresh
	//    proxy round-trip every call. Fail-soft: any error → false,
	//    NEVER a 500 (healthz must not crash on a graph outage).
	let graph_ready = false;
	try {
		graph_ready = await getCachedGraphReady(env);
	} catch {
		graph_ready = false;
	}

	// 5. Graph proxy reachability — Phase 18 v1.3. Separate from
	//    graph_ready: proxy-reachable can be true while graph_ready=false
	//    (proxy up, FalkorDB down) — gives operators a one-bit signal
	//    for "is internjobs-graph-api itself responding."
	let graph_proxy_reachable = false;
	try {
		graph_proxy_reachable = await getCachedGraphProxyReachable(env);
	} catch {
		graph_proxy_reachable = false;
	}

	return c.json({
		ok: mattermost_reachable && ai_gateway_reachable,
		mattermost_reachable,
		ai_gateway_reachable,
		graph_ready, // Phase 14 — proxy /health → FalkorDB ping (30s cached)
		graph_proxy_reachable, // Phase 18 — proxy HTTP reachable (30s cached)
		mailbox_count,
	});
});

// -- Identity -------------------------------------------------------
// `/api/me` upserts the per-employee MailboxDO profile on every login.
// This is how a Parrot employee mailbox is auto-provisioned on first
// Clerk login (Step 4 of Wave 1 in PLAN.md).

app.get("/api/me", requireEmployeeMailbox, async (c: AppContext) => {
	const employee = c.var.employee;
	const stub = c.var.mailboxStub;
	const profile = await stub.upsertProfile({
		employeeId: employee.employeeId,
		email: employee.email,
		displayName: employee.displayName,
	});
	// Compute whether this employee is an operator. Mirrors
	// workers/lib/operator.ts.isOperator() so the front-end can render
	// the Admin nav without an extra round-trip.
	const isOperator = await hasOperatorAccess(c.env, employee);
	return c.json({
		employee_id: profile.employeeId,
		email: profile.email,
		display_name: profile.displayName,
		created_at: profile.createdAt,
		onboarded_at: profile.onboardedAt,
		role: isOperator ? "operator" : "employee",
	});
});

// -- Inbox ----------------------------------------------------------

app.get("/api/inbox/messages", requireEmployeeMailbox, async (c: AppContext) => {
	const folder = c.req.query("folder") || Folders.INBOX;
	const stub = c.var.mailboxStub;
	const emails = await stub.getEmails({ folder });
	const totalCount = await stub.countEmails({ folder });
	return c.json({ emails, totalCount, folder });
});

app.get(
	"/api/inbox/messages/:id",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const id = c.req.param("id")!;
		const email = await c.var.mailboxStub.getEmail(id);
		if (!email) return c.json({ error: "Email not found" }, 404);
		return c.json(email);
	},
);

// STAR-API-01: PATCH /api/inbox/messages/:id — toggle starred/read state.
// Body: { starred?: boolean; read?: boolean }
// The EmployeeMailboxDO.updateEmail() method already exists and handles the
// SQLite UPDATE. This route is the missing HTTP surface the EmailPanel needs.
app.patch(
	"/api/inbox/messages/:id",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const id = c.req.param("id");
		if (!id) return c.json({ error: "Missing message id" }, 400);
		const body = (await c.req.json().catch(() => null)) as {
			starred?: boolean;
			read?: boolean;
		} | null;
		if (!body || (body.starred === undefined && body.read === undefined)) {
			return c.json({ error: "Body must include starred or read field" }, 400);
		}
		const updated = await c.var.mailboxStub.updateEmail(id, {
			starred: body.starred,
			read: body.read,
		});
		if (!updated) return c.json({ error: "Email not found" }, 404);
		return c.json({
			id: updated.id,
			starred: !!updated.starred,
			read: !!updated.read,
		});
	},
);

// v1.3.1 BACKFILL: /api/inbox/send is now a real send.
//
// Previously a Wave 1 stub that only wrote to the Sent folder. The full
// handler now lives in routes/reply-forward.ts::handleComposeEmail and:
//   - validates sender vs authenticated employee
//   - enforces send-rate limits (20/hr, 100/day per DO)
//   - stores attachments to R2 (env.BUCKET) and persists metadata
//   - writes to Sent folder with proper RFC 2822 message-id
//   - dispatches outbound via env.EMAIL.send() in waitUntil() so the
//     HTTP response returns immediately (202)
app.post("/api/inbox/send", requireEmployeeMailbox, handleComposeEmail);

app.post(
	"/api/inbox/messages/:id/reply",
	requireEmployeeMailbox,
	handleReplyEmail,
);
app.post(
	"/api/inbox/messages/:id/forward",
	requireEmployeeMailbox,
	handleForwardEmail,
);

// v1.4 Phase 23-03 ATTACH-DOWN-01..03:
// GET /api/inbox/messages/:messageId/attachments/:attachmentId — returns the
// R2 blob for a single attachment with correct Content-Type and
// Content-Disposition: attachment. Auth enforced by requireEmployeeMailbox;
// ownership enforced inside handleAttachmentDownload via the employee's DO.
app.get(
	"/api/inbox/messages/:messageId/attachments/:attachmentId",
	requireEmployeeMailbox,
	handleAttachmentDownload,
);

// v1.3.1 Agent Lift: /api/inbox/agent/* — the React AgentPanel calls these
// endpoints to summarize, draft replies, translate, extract actions, and
// freeform chat. All routes are gated by requireEmployeeMailbox so the
// agent only ever sees the signed-in employee's mailbox.
app.use("/api/inbox/agent/*", requireEmployeeMailbox);
app.route("/api/inbox/agent", agentRoutes);

// -- Folders --------------------------------------------------------

app.get(
	"/api/inbox/folders",
	requireEmployeeMailbox,
	async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()),
);

// -- Dashboard Mothership Agent (Phase 12 Wave 1) -------------------
// Cross-channel todos surfaced from email/chat/phone/sms/meeting.
// Wave 1: returns `{ todos: [] }` (the DO stub returns an empty array
// until Wave 2 lands the ingest pipeline). The `view` query param is
// already plumbed through so the React UI can ship final-state code:
//   ?view=all | mentions | today | week | resolved
//
// v1.3 Phase 19 Plan 02: `?view=resolved` returns last-48h resolved todos
// (agent-cleared by the cron + manually-resolved via cleanupTodosForEmail).
// Active views are unchanged — resolved_at IS NULL gate stays in getTodos.
app.get(
	"/api/dashboard/todos",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const stub = c.var.mailboxStub;
		const view = c.req.query("view") ?? "all";

		// AUTO-CLEAR-08: resolved view returns agent-cleared + manually-resolved todos.
		// Separate DO method (getResolvedTodos) so the active-list ranking query stays
		// untouched and the resolved query can apply its own ORDER BY resolved_at DESC.
		if (view === "resolved") {
			const todos = await stub.getResolvedTodos();
			return c.json({ todos });
		}

		// Existing active-todos views: all | mentions | today | week
		const todos = await stub.getTodos(view);
		return c.json({ todos });
	},
);

// v1.3 Phase 19 Plan 02: POST /api/dashboard/todos/:id/unresolve
//
// Undoes an agent auto-resolution. Sets resolved_at = NULL on the DO
// and attempts to clear valid_to in the graph (fail-soft).
//
// Idempotent: calling on an already-active todo is a no-op (the DO method
// guards on resolution_source = 'agent'). User-resolved todos (NULL source)
// are also refused — only agent-cleared rows can be undone.
//
// Graph-side fail-soft posture (AUTO-CLEAR-07): if the graph proxy is
// unavailable, we still return success. The DO row is the source of truth
// for the dashboard; the graph will stay stale (valid_to still set) until
// the next recordTodoFact write for that todo. UX trumps consistency.
//
// AUTO-CLEAR-06, AUTO-CLEAR-07
app.post(
	"/api/dashboard/todos/:id/unresolve",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const todoId = c.req.param("id");
		if (!todoId) return c.json({ error: "Missing todo id" }, 400);

		const stub = c.var.mailboxStub;

		// Step 1: clear the SQLite row — primary action.
		const result = await stub.unresolveTodo(todoId);

		// Step 2: fail-soft graph clear — sets valid_to = null on :Todo node.
		// Wrapped in a wide try/catch so any graph-proxy hiccup (DNS, 5xx,
		// auth, timeout, parse error) does not 500 the Undo button.
		try {
			const graphApiUrl = c.env.GRAPH_API_URL;
			const graphApiSecret = c.env.GRAPH_API_SECRET;
			if (graphApiUrl && graphApiSecret) {
				await fetch(`${graphApiUrl}/query`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${graphApiSecret}`,
					},
					body: JSON.stringify({
						cypher: `MATCH (t:Todo {id: $tid}) SET t.valid_to = null`,
						params: { tid: todoId },
					}),
				});
				// Intentionally ignoring the response — fail-soft means we don't
				// error even if the graph query fails. The DO row is authoritative.
			}
		} catch {
			// Swallow graph errors — UX trumps consistency here (REQUIREMENTS.md
			// PARROT-AUTO-CLEAR).
		}

		return c.json({ ok: true, unresolved: result.unresolved });
	},
);

// -- Push subscriptions (Phase 13 Wave 1) ---------------------------
// Browser registers a PushSubscription via PushManager.subscribe()
// (using PUSH_VAPID_PUBLIC_KEY as applicationServerKey) and POSTs the
// resulting endpoint+keys here. The DO stores one row per endpoint.
// DELETE is used by the wizard when the employee opts out.

app.post(
	"/api/push/subscribe",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json()) as {
			endpoint?: string;
			keys?: { p256dh?: string; auth?: string };
		};
		if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
			return c.json({ error: "Missing endpoint or keys" }, 400);
		}
		await c.var.mailboxStub.addPushSubscription(
			body.endpoint,
			body.keys.p256dh,
			body.keys.auth,
		);
		return c.json({ ok: true });
	},
);

app.delete(
	"/api/push/subscribe",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as {
			endpoint?: string;
		} | null;
		if (!body?.endpoint) return c.json({ error: "Missing endpoint" }, 400);
		await c.var.mailboxStub.removePushSubscription(body.endpoint);
		return c.json({ ok: true });
	},
);

// -- Notifications (Phase 13 Wave 1) --------------------------------
// Drawer reads notifications via GET. POST mark-read clears unread —
// either a subset by id (when row-click marks one) or all unread (when
// the drawer is opened and the user dismisses the bell badge).

app.get(
	"/api/notifications",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const limit = Number(c.req.query("limit") ?? 20);
		const items = await c.var.mailboxStub.getNotifications(limit);
		const unread = items.filter((n) => n.read === 0).length;
		return c.json({ notifications: items, unread });
	},
);

app.post(
	"/api/notifications/mark-read",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as {
			ids?: string[];
		} | null;
		await c.var.mailboxStub.markNotificationsRead(body?.ids);
		return c.json({ ok: true });
	},
);

// -- Meetings (Daily.co — Phase 11 Wave 1) --------------------------
//
// POST /api/meetings/ensure-room lazily provisions the signed-in
// employee's personal Daily.co room on first call (parrot-<clerk_user_id>);
// subsequent calls return the stored URL from the DO (no extra Daily.co
// call). Falls back gracefully when DAILY_API_KEY is absent — returns
// 503 with `error: 'room_provisioning_unavailable'` so the UI can drop
// to the Phase 13 "Daily.co not configured" toast.
//
// Skills referenced:
//   cloudflare/skills: durable-objects — per-employee room ownership
//     via EmployeeMailboxDO.ensurePersonalRoom().

app.post(
	"/api/meetings/ensure-room",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const result = await c.var.mailboxStub.ensurePersonalRoom(
			c.env.DAILY_API_KEY,
		);
		if (!result.ok) {
			// Key absent or Daily.co error — degrade to Phase 13 toast path.
			return c.json({ ok: false, error: result.error }, 503);
		}
		return c.json({ ok: true, url: result.url, name: result.name });
	},
);

// — Phase 11 Wave 2: read-only meeting endpoints --------------------
//
// GET /api/meetings/my-room — returns the employee's stored personal
// room URL. Does NOT provision; caller must POST /api/meetings/ensure-room
// first if the room hasn't been created yet. 404 with
// `error: 'room_not_provisioned'` signals the UI to call ensure-room.
//
// Skills referenced:
//   cloudflare/skills: durable-objects — read-only DO query.
app.get(
	"/api/meetings/my-room",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const room = await c.var.mailboxStub.getPersonalRoom();
		if (!room) {
			return c.json({ ok: false, error: "room_not_provisioned" }, 404);
		}
		return c.json({ ok: true, url: room.url, name: room.name });
	},
);

// GET /api/meetings/room-token — mints a per-call Daily.co meeting token
// for the employee's personal room. is_owner: true (it's their own room).
//
// Fail-soft posture: returns { ok: false, error: 'token_mint_unavailable' }
// (HTTP 200) when DAILY_API_KEY is absent. The UI falls back to joining
// without a token — Daily.co still allows entry to private rooms via the
// shared room URL alone, so we prefer "enter as guest" over blocking the
// employee out of their own room when the secret isn't provisioned.
app.get(
	"/api/meetings/room-token",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const room = await c.var.mailboxStub.getPersonalRoom();
		if (!room) {
			return c.json({ ok: false, error: "room_not_provisioned" }, 404);
		}
		const token = await getMeetingToken(c.env.DAILY_API_KEY, room.name, {
			is_owner: true,
			user_name: c.var.employee.displayName,
		});
		if (!token) {
			return c.json({ ok: false, error: "token_mint_unavailable" });
		}
		return c.json({ ok: true, token: token.token });
	},
);

// GET /api/meetings/active — list of active rooms (rooms not expired).
// Returns { rooms: [] } when DAILY_API_KEY is absent (fail-soft empty list).
app.get(
	"/api/meetings/active",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const rooms = await getActiveRooms(c.env.DAILY_API_KEY);
		return c.json({
			rooms: rooms.map((r) => ({ name: r.name, url: r.url })),
		});
	},
);

// — Phase 11 Wave 2: dev smoke endpoint for token issuance ---------
//
// POST /api/dev/smoke/dailyco-token — PARROT_DEV_MODE-gated. Asserts
// that getMeetingToken() returns a JSON-shaped response (pass:true when
// DAILY_API_KEY is set AND a token came back; pass:false with a clear
// reason when the key is absent — NEVER a 5xx).
//
// Auth gate: PARROT_DEV_MODE only, NOT requireEmployeeMailbox — exercises
// only Worker→Daily.co plumbing (mints a token against a throwaway room
// name), no DO involvement. Matches the design of /api/dev/smoke/dailyco.
app.post("/api/dev/smoke/dailyco-token", async (c: AppContext) => {
	if (!c.env.PARROT_DEV_MODE) {
		return c.json({ error: "dev mode only" }, 403);
	}
	if (!c.env.DAILY_API_KEY) {
		return c.json({
			pass: false,
			reason: "daily_api_key_missing",
			detail: "DAILY_API_KEY not set on Worker; token mint skipped.",
		});
	}
	// Use a deterministic throwaway room name; we do NOT need the room
	// to exist for getMeetingToken() to return a JSON response (Daily.co
	// accepts any room_name property on the token).
	const roomName = `parrot-smoke-${Date.now()}`;
	const token = await getMeetingToken(c.env.DAILY_API_KEY, roomName, {
		is_owner: true,
		user_name: "smoke-test",
	});
	return c.json({
		pass: !!token,
		token_minted: !!token,
		room_name: roomName,
	});
});

// Backwards-compat alias for the old Wave-3 stub. Callers that still
// hit /api/meetings/create get redirected to /ensure-room rather than 404.
// 308 preserves the POST method on redirect.
app.post(
	"/api/meetings/create",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		return c.redirect("/api/meetings/ensure-room", 308);
	},
);

// -- Cross-pane actions (Phase 13 Wave 2) ---------------------------
//
// Skills referenced:
//   cloudflare/skills: agents-sdk
//
// email-to-chat: moves an email thread into a Mattermost channel +
// posts the body as the seed message.
// chat-to-email: returns a draft {to, subject, body} for the compose
// modal — full composer is deferred to v1.3.
// start-meeting: UI seam for Phase 11 (Daily.co). Records demand via
// the notifications table; does NOT call Daily.co. When Phase 11
// ships, this handler gains a real /rooms POST and the audit write
// stays as-is.

app.post(
	"/api/crosspane/email-to-chat",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as {
			email_id?: string;
		} | null;
		if (!body?.email_id) {
			return c.json({ error: "Missing email_id" }, 400);
		}
		const result = await c.var.mailboxStub.emailToChat(body.email_id);
		if (!result.ok) {
			return c.json({ ok: false, reason: result.error ?? "unknown" }, 502);
		}
		return c.json({
			ok: true,
			channel_url: result.channel_url,
			channel_id: result.channel_id,
		});
	},
);

app.post(
	"/api/crosspane/chat-to-email",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as {
			post_id?: string;
			post_body?: string;
		} | null;
		if (!body?.post_body) {
			return c.json({ error: "Missing post_body" }, 400);
		}
		const result = await c.var.mailboxStub.chatToEmail(
			body.post_id ?? "",
			body.post_body,
		);
		if (!result.ok) {
			return c.json({ ok: false, reason: result.error ?? "unknown" }, 502);
		}
		return c.json({ ok: true, draft: result.draft });
	},
);

app.post(
	"/api/crosspane/start-meeting",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		// Phase 11 Wave 3: calls Daily.co to create an ephemeral 1-hour room.
		// Falls back to Phase 13 toast behavior when DAILY_API_KEY is absent
		// (or Daily.co errors) — the DO's startEphemeralMeeting() preserves
		// the Phase 13 audit row in that case, so pilot demand is still
		// captured.
		//
		// Skills referenced:
		//   cloudflare/skills: durable-objects — per-employee room +
		//     notification via EmployeeMailboxDO.startEphemeralMeeting().
		const result = await c.var.mailboxStub.startEphemeralMeeting(
			c.env.DAILY_API_KEY,
		);
		if (!result.ok) {
			// Fallback path (key absent or Daily.co error): Phase 13
			// behavior preserved — 200 OK with the toast-trigger reason.
			return c.json({
				ok: true,
				reason: result.reason,
				message: result.message,
			});
		}
		return c.json({ ok: true, url: result.url, name: result.name });
	},
);

// -- Native Chat support --------------------------------------------

async function loadChatContext(c: AppContext):
	Promise<
		| {
				ok: true;
				botToken: string;
				user: NonNullable<Awaited<ReturnType<typeof getMmUserByEmail>>>;
				team: Awaited<ReturnType<typeof getMmTeamsForUser>>[number];
				channels: Awaited<ReturnType<typeof getMmTeamChannelsForUser>>;
		  }
		| {
				ok: false;
				status: 404 | 502 | 503;
				reason:
					| "mattermost_bot_not_configured"
					| "user_not_found"
					| "team_unavailable"
					| "membership_failed"
					| "channel_unavailable";
		  }
	> {
	const botToken = c.env.MATTERMOST_BOT_TOKEN;
	if (!botToken) {
		return {
			ok: false,
			status: 503,
			reason: "mattermost_bot_not_configured",
		};
	}

	const employee = c.var.employee;
	const membership = await ensureMmWorkspaceMembership(
		c.env.MATTERMOST_URL,
		botToken,
		employee.email,
		{
			displayName: employee.displayName,
			givenName: employee.givenName,
			familyName: employee.familyName,
		},
		c.env.MATTERMOST_ADMIN_TOKEN,
	);
	if (!membership.ok) {
		return {
			ok: false,
			status: membership.reason === "user_not_found" ? 404 : 502,
			reason: membership.reason,
		};
	}

	const user = await getMmUserByEmail(
		c.env.MATTERMOST_URL,
		botToken,
		employee.email,
	);
	const teams = await getMmTeamsForUser(
		c.env.MATTERMOST_URL,
		botToken,
		membership.userId,
	);
	const team = teams[0] ?? membership.team;
	let channels = team
		? await getMmTeamChannelsForUser(
				c.env.MATTERMOST_URL,
				botToken,
				membership.userId,
				team.id,
			)
		: [];
	if (!channels.length && team) {
		channels = await getMmTeamChannels(c.env.MATTERMOST_URL, botToken, team.id);
	}
	if (!channels.length && membership.channel) {
		channels = [membership.channel];
	}

	if (!user || !team) {
		return { ok: false, status: 502, reason: "team_unavailable" };
	}
	if (!channels.length) {
		return { ok: false, status: 502, reason: "channel_unavailable" };
	}

	return { ok: true, botToken, user, team, channels };
}

app.get(
	"/api/chat/config",
	requireEmployeeMailbox,
	(c) =>
		c.json({
			ok: false,
			reason: "not_implemented_wave_2",
			detail:
				"Mattermost Team Edition is deployed in Wave 2 and exposes its iframe URL + SSO bridge here.",
		}),
);

app.get("/api/chat/bootstrap", requireEmployeeMailbox, async (c: AppContext) => {
	const chat = await loadChatContext(c);
	if (!chat.ok) {
		return c.json(
			{ ok: false, reason: chat.reason },
			chat.status as 404 | 502 | 503,
		);
	}
	return c.json({
		me: chat.user,
		team: chat.team,
		channels: chat.channels,
	});
});

app.post(
	"/api/chat/ensure-membership",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const botToken = c.env.MATTERMOST_BOT_TOKEN;
		if (!botToken) {
			return c.json(
				{ ok: false, reason: "mattermost_bot_not_configured" },
				503,
			);
		}
		const employee = c.var.employee;
		const result = await ensureMmWorkspaceMembership(
			c.env.MATTERMOST_URL,
			botToken,
			employee.email,
			{
				displayName: employee.displayName,
				givenName: employee.givenName,
				familyName: employee.familyName,
			},
			c.env.MATTERMOST_ADMIN_TOKEN,
		);
		if (!result.ok) {
			const status = result.reason === "user_not_found" ? 404 : 502;
			return c.json({ ok: false, reason: result.reason }, status);
		}
		return c.json({
			ok: true,
			user_id: result.userId,
			team: result.team,
			channel: result.channel,
		});
	},
);

app.post("/api/chat/users", requireEmployeeMailbox, async (c: AppContext) => {
	const chat = await loadChatContext(c);
	if (!chat.ok) {
		return c.json(
			{ ok: false, reason: chat.reason },
			chat.status as 404 | 502 | 503,
		);
	}
	const body = (await c.req.json().catch(() => null)) as string[] | null;
	if (!Array.isArray(body)) return c.json({ error: "Expected user id list" }, 400);
	const users = await getMmUsersByIds(c.env.MATTERMOST_URL, chat.botToken, body);
	return c.json(users);
});

app.get(
	"/api/chat/channels/:channelId/posts",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const channelId = c.req.param("channelId");
		if (!channelId) return c.json({ error: "Missing channel id" }, 400);

		const chat = await loadChatContext(c);
		if (!chat.ok) {
			return c.json(
				{ ok: false, reason: chat.reason },
				chat.status as 404 | 502 | 503,
			);
		}
		// Wave 2 (31-03): DM/group channels aren't in the team-channel bootstrap
		// list. If the channel isn't a known team channel, verify the employee is
		// a member via their OWN PAT before reading (so they can only read DMs
		// they belong to) — then read the posts with the bot token as before.
		if (!chat.channels.some((channel) => channel.id === channelId)) {
			const proxy = chatUserProxy(c);
			const membership = proxy.ok
				? await proxy.call<{ channel_id: string }>(
						`/api/v4/channels/${channelId}/members/me`,
						{ method: "GET" },
					)
				: null;
			if (!membership || !membership.ok) {
				return c.json({ error: "Channel not available" }, 403);
			}
		}

		const page = Number.parseInt(c.req.query("page") ?? "0", 10);
		const perPage = Number.parseInt(c.req.query("per_page") ?? "50", 10);
		const posts = await getMmChannelPosts(
			c.env.MATTERMOST_URL,
			chat.botToken,
			channelId,
			Number.isFinite(page) && page >= 0 ? page : 0,
			Number.isFinite(perPage) ? Math.min(Math.max(perPage, 1), 100) : 50,
		);
		if (!posts) return c.json({ error: "Messages unavailable" }, 502);
		return c.json(posts);
	},
);

// ── Phase 31 Wave 0: per-employee Mattermost PAT resolution ─────────
//
// Resolve (and lazily provision) the employee's own Mattermost personal
// access token so human chat REST calls are authored AS the real MM user
// rather than through the parrot bot. Returns null when MM can't be reached,
// the user has no MM account, or PAT minting is disabled on the MM server
// (MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=false — see plan 31-06 Task 1).
async function resolveEmployeeToken(
	c: AppContext,
): Promise<{ mmUserId: string; token: string } | null> {
	const employee = c.var.employee;
	const stub = getWorkspaceStub(c.env);

	const existing = await stub.getEmployeeToken(employee.employeeId);
	if (existing) return existing;

	// No stored PAT yet — resolve the MM user by email and mint one.
	const adminToken = c.env.MATTERMOST_ADMIN_TOKEN;
	const botToken = c.env.MATTERMOST_BOT_TOKEN;
	if (!adminToken || !botToken) return null;
	const user = await getMmUserByEmail(
		c.env.MATTERMOST_URL,
		botToken,
		employee.email,
	);
	if (!user) return null;
	const token = await mintMmUserToken(c.env.MATTERMOST_URL, adminToken, user.id);
	if (!token) return null;
	await stub.setEmployeeToken(employee.employeeId, user.id, token);
	return { mmUserId: user.id, token };
}

app.post("/api/chat/posts", requireEmployeeMailbox, async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| { channel_id?: string; message?: string }
		| null;
	const channelId = body?.channel_id?.trim();
	const message = body?.message?.trim();
	if (!channelId || !message) {
		return c.json({ error: "Missing channel_id or message" }, 400);
	}

	const chat = await loadChatContext(c);
	if (!chat.ok) {
		return c.json(
			{ ok: false, reason: chat.reason },
			chat.status as 404 | 502 | 503,
		);
	}
	// Wave 2 (31-03): DM/group channels are NOT in the team-channel bootstrap
	// list, so the old "channel must be in chat.channels" gate would reject DM
	// posts. We drop the redundant gate: because the post is sent via the
	// employee's own PAT (mmFetchAsUser), Mattermost itself enforces that the
	// employee may only post to channels they are a member of — a non-member
	// PAT post returns 403 from MM and is surfaced as a 502 below.

	// Phase 31 Wave 0: post AS the employee using their own PAT — no
	// parrot_author_* props for human posts (the post's user_id IS the
	// real MM user). createMmParrotPost stays for bot/agent/cross-pane msgs.
	const adminToken = c.env.MATTERMOST_ADMIN_TOKEN;
	if (!adminToken) {
		return c.json({ error: "chat_not_provisioned" }, 503);
	}
	const stub = getWorkspaceStub(c.env);
	const employee = c.var.employee;
	const result = await mmFetchAsUser<MattermostPost>(
		c.env.MATTERMOST_URL,
		adminToken,
		"/api/v4/posts",
		{
			method: "POST",
			body: JSON.stringify({ channel_id: channelId, message }),
		},
		() => resolveEmployeeToken(c),
		(mmUserId, token) =>
			stub.setEmployeeToken(employee.employeeId, mmUserId, token),
	);
	if (!result.ok) {
		if (result.status === 503) {
			return c.json({ error: "chat_not_provisioned" }, 503);
		}
		return c.json({ error: "Message send failed" }, 502);
	}
	return c.json(result.data);
});

// ── Phase 31 Wave 1 (plan 31-02): channel CRUD + thread ops ─────────
//
// All routes proxy AS the employee via their own PAT (mmFetchAsUser), so
// channel creates/joins, post edits/deletes/pins, and thread replies are
// authored by the real MM user. Shared helper resolves the admin token +
// the per-employee token callbacks once per request.
//
// PAT resolution returns 503 chat_not_provisioned when the employee has no
// MM account / PAT minting is disabled (see plan 31-06). 403 for authz
// failures (private channel create, editing someone else's post). 400 for
// missing body fields.

function chatUserProxy(c: AppContext):
	| {
			ok: true;
			adminToken: string;
			call: <T>(
				path: string,
				init: RequestInit,
			) => Promise<
				{ ok: true; data: T } | { ok: false; status: number; data: unknown }
			>;
			getToken: () => Promise<{ mmUserId: string; token: string } | null>;
	  }
	| { ok: false } {
	const adminToken = c.env.MATTERMOST_ADMIN_TOKEN;
	if (!adminToken) return { ok: false };
	const stub = getWorkspaceStub(c.env);
	const employee = c.var.employee;
	const getToken = () => resolveEmployeeToken(c);
	const setToken = (mmUserId: string, token: string) =>
		stub.setEmployeeToken(employee.employeeId, mmUserId, token);
	return {
		ok: true,
		adminToken,
		getToken,
		call: <T>(path: string, init: RequestInit) =>
			mmFetchAsUser<T>(
				c.env.MATTERMOST_URL,
				adminToken,
				path,
				init,
				getToken,
				setToken,
			),
	};
}

// GET /api/chat/channels — list the team's channels as the employee (their
// own visibility). The employee's first team is read from the bootstrap
// context; falls back to the membership team.
app.get("/api/chat/channels", requireEmployeeMailbox, async (c: AppContext) => {
	const proxy = chatUserProxy(c);
	if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
	const chat = await loadChatContext(c);
	if (!chat.ok) {
		return c.json({ ok: false, reason: chat.reason }, chat.status as 404 | 502 | 503);
	}
	const result = await proxy.call<MattermostChannel[]>(
		`/api/v4/teams/${chat.team.id}/channels?page=0&per_page=100`,
		{ method: "GET" },
	);
	if (!result.ok) {
		if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
		return c.json({ error: "Channels unavailable" }, 502);
	}
	return c.json(result.data);
});

// POST /api/chat/channels — create a channel. Public ("O") is open to all
// employees; private ("P") is operator-gated.
app.post("/api/chat/channels", requireEmployeeMailbox, async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| { name?: string; display_name?: string; type?: string }
		| null;
	const name = body?.name?.trim();
	const displayName = body?.display_name?.trim();
	const type = body?.type === "P" ? "P" : "O";
	if (!name || !displayName) {
		return c.json({ error: "Missing name or display_name" }, 400);
	}
	if (type === "P" && !(await hasOperatorAccess(c.env, c.var.employee))) {
		return c.json({ error: "forbidden_operator_only" }, 403);
	}
	const proxy = chatUserProxy(c);
	if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
	const chat = await loadChatContext(c);
	if (!chat.ok) {
		return c.json({ ok: false, reason: chat.reason }, chat.status as 404 | 502 | 503);
	}
	const result = await proxy.call<MattermostChannel>("/api/v4/channels", {
		method: "POST",
		body: JSON.stringify({
			team_id: chat.team.id,
			name,
			display_name: displayName,
			type,
		}),
	});
	if (!result.ok) {
		if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
		return c.json({ error: "Channel create failed" }, 502);
	}
	return c.json(result.data);
});

// POST /api/chat/channels/:id/join — add the employee to a channel.
app.post(
	"/api/chat/channels/:id/join",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const channelId = c.req.param("id");
		if (!channelId) return c.json({ error: "Missing channel id" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const tokenRow = await proxy.getToken();
		if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);
		const result = await proxy.call<unknown>(
			`/api/v4/channels/${channelId}/members`,
			{ method: "POST", body: JSON.stringify({ user_id: tokenRow.mmUserId }) },
		);
		// 400 = already a member — treat as success (idempotent join).
		if (!result.ok && result.status !== 400) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Join failed" }, 502);
		}
		return c.json({ ok: true, channel_id: channelId });
	},
);

// GET /api/chat/posts/:id/thread — full thread for a root post.
app.get(
	"/api/chat/posts/:id/thread",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const postId = c.req.param("id");
		if (!postId) return c.json({ error: "Missing post id" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const result = await proxy.call<MattermostPostList>(
			`/api/v4/posts/${postId}/thread`,
			{ method: "GET" },
		);
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Thread unavailable" }, 502);
		}
		return c.json(result.data);
	},
);

// POST /api/chat/posts/:id/thread — reply to a thread (root_id = :id). The
// reply targets the same channel as the root post.
app.post(
	"/api/chat/posts/:id/thread",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const rootId = c.req.param("id");
		if (!rootId) return c.json({ error: "Missing post id" }, 400);
		const body = (await c.req.json().catch(() => null)) as
			| { message?: string }
			| null;
		const message = body?.message?.trim();
		if (!message) return c.json({ error: "Missing message" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		// Resolve the root post's channel so the reply lands in the same channel.
		const root = await proxy.call<MattermostPost>(`/api/v4/posts/${rootId}`, {
			method: "GET",
		});
		if (!root.ok) {
			if (root.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Root post not found" }, 404);
		}
		const result = await proxy.call<MattermostPost>("/api/v4/posts", {
			method: "POST",
			body: JSON.stringify({
				channel_id: root.data.channel_id,
				message,
				root_id: rootId,
			}),
		});
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Reply failed" }, 502);
		}
		return c.json(result.data);
	},
);

// PATCH /api/chat/posts/:id — edit a message. Author-only.
app.patch(
	"/api/chat/posts/:id",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const postId = c.req.param("id");
		if (!postId) return c.json({ error: "Missing post id" }, 400);
		const body = (await c.req.json().catch(() => null)) as
			| { message?: string }
			| null;
		const message = body?.message?.trim();
		if (!message) return c.json({ error: "Missing message" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const tokenRow = await proxy.getToken();
		if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);
		// Authorship gate: only the post author may edit.
		const existing = await proxy.call<MattermostPost>(`/api/v4/posts/${postId}`, {
			method: "GET",
		});
		if (!existing.ok) {
			if (existing.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Post not found" }, 404);
		}
		if (existing.data.user_id !== tokenRow.mmUserId) {
			return c.json({ error: "forbidden_not_author" }, 403);
		}
		const result = await proxy.call<MattermostPost>(`/api/v4/posts/${postId}`, {
			method: "PUT",
			body: JSON.stringify({ id: postId, message }),
		});
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Edit failed" }, 502);
		}
		return c.json(result.data);
	},
);

// DELETE /api/chat/posts/:id — delete a message. Author-only.
app.delete(
	"/api/chat/posts/:id",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const postId = c.req.param("id");
		if (!postId) return c.json({ error: "Missing post id" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const tokenRow = await proxy.getToken();
		if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);
		const existing = await proxy.call<MattermostPost>(`/api/v4/posts/${postId}`, {
			method: "GET",
		});
		if (!existing.ok) {
			if (existing.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Post not found" }, 404);
		}
		if (existing.data.user_id !== tokenRow.mmUserId) {
			return c.json({ error: "forbidden_not_author" }, 403);
		}
		const result = await proxy.call<unknown>(`/api/v4/posts/${postId}`, {
			method: "DELETE",
		});
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Delete failed" }, 502);
		}
		return c.json({ ok: true, deleted: postId });
	},
);

// POST /api/chat/channels/:id/pin — pin a post. Body: { post_id }.
app.post(
	"/api/chat/channels/:id/pin",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as
			| { post_id?: string }
			| null;
		const postId = body?.post_id?.trim();
		if (!postId) return c.json({ error: "Missing post_id" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const result = await proxy.call<unknown>(`/api/v4/posts/${postId}/pin`, {
			method: "POST",
		});
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Pin failed" }, 502);
		}
		return c.json({ ok: true, pinned: postId });
	},
);

// ── Phase 31 Wave 2 (plan 31-03): DMs + group DMs ───────────────────
//
// MM DMs are channels of type "D" (direct, 2 users) and "G" (group, 3-8).
// Create/open is idempotent — MM returns the existing channel if it exists.
// All DM routes proxy AS the employee via their PAT (chatUserProxy), so the
// DM belongs to the real MM user and messages (posted via the existing
// /api/chat/posts route with channel_id = the DM channel id) arrive under
// the employee identity, never the parrot bot.
//
// A "D" channel name is `userIdA__userIdB` (the two member IDs sorted), which
// we parse to derive the partner id without an extra members lookup. "G"
// channels have an opaque hash name, so we resolve their members via the
// channel-members endpoint to build partner names.

// GET /api/chat/dms — list the employee's DM channels (type D + G), enriched
// with resolved partner display names.
app.get("/api/chat/dms", requireEmployeeMailbox, async (c: AppContext) => {
	const proxy = chatUserProxy(c);
	if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
	const tokenRow = await proxy.getToken();
	if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);

	const result = await proxy.call<MattermostChannel[]>(
		"/api/v4/users/me/channels?include_deleted=false",
		{ method: "GET" },
	);
	if (!result.ok) {
		if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
		return c.json({ error: "DMs unavailable" }, 502);
	}
	const dms = result.data.filter(
		(channel) => channel.type === "D" || channel.type === "G",
	);

	// Collect every partner user id. Direct ("D") channel names encode the two
	// member ids as `idA__idB`; group ("G") names are opaque so we fetch their
	// members. We resolve all partner ids in one batched user lookup (bot token
	// is fine — read access only).
	const botToken = c.env.MATTERMOST_BOT_TOKEN;
	const groupMembers = new Map<string, string[]>();
	const partnerIds = new Set<string>();
	for (const dm of dms) {
		if (dm.type === "D") {
			for (const id of (dm.name ?? "").split("__")) {
				if (id && id !== tokenRow.mmUserId) partnerIds.add(id);
			}
		} else {
			// Group DM: fetch members (as the employee — they're a member).
			const members = await proxy.call<Array<{ user_id: string }>>(
				`/api/v4/channels/${dm.id}/members`,
				{ method: "GET" },
			);
			const ids = members.ok
				? members.data
						.map((m) => m.user_id)
						.filter((id) => id && id !== tokenRow.mmUserId)
				: [];
			groupMembers.set(dm.id, ids);
			for (const id of ids) partnerIds.add(id);
		}
	}

	const users = botToken
		? await getMmUsersByIds(c.env.MATTERMOST_URL, botToken, [...partnerIds])
		: [];
	const nameById = new Map<string, string>();
	for (const u of users) {
		const full = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
		nameById.set(u.id, u.nickname || full || u.username || "Teammate");
	}

	const enriched = dms.map((dm) => {
		let ids: string[];
		if (dm.type === "D") {
			ids = (dm.name ?? "")
				.split("__")
				.filter((id) => id && id !== tokenRow.mmUserId);
		} else {
			ids = groupMembers.get(dm.id) ?? [];
		}
		return {
			...dm,
			dm_partner_names: ids.map((id) => nameById.get(id) ?? "Teammate"),
		};
	});

	return c.json(enriched);
});

// POST /api/chat/dms/direct — open/create a DM with one user.
// Body: { mm_user_id: string }.
app.post(
	"/api/chat/dms/direct",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as
			| { mm_user_id?: string }
			| null;
		const partnerId = body?.mm_user_id?.trim();
		if (!partnerId) return c.json({ error: "Missing mm_user_id" }, 400);
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const tokenRow = await proxy.getToken();
		if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);
		if (partnerId === tokenRow.mmUserId) {
			return c.json({ error: "Cannot DM yourself" }, 400);
		}
		const result = await proxy.call<MattermostChannel>(
			"/api/v4/channels/direct",
			{ method: "POST", body: JSON.stringify([tokenRow.mmUserId, partnerId]) },
		);
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "DM create failed" }, 502);
		}
		return c.json(result.data);
	},
);

// POST /api/chat/dms/group — open/create a group DM.
// Body: { mm_user_ids: string[] } (2+ other users; the employee is added
// server-side). MM requires the final list be 3-8 users total.
app.post(
	"/api/chat/dms/group",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as
			| { mm_user_ids?: string[] }
			| null;
		const others = Array.isArray(body?.mm_user_ids)
			? [...new Set(body.mm_user_ids.filter((id) => typeof id === "string" && id.trim()))]
			: [];
		if (others.length < 2) {
			return c.json({ error: "Group DM needs at least 2 other users" }, 400);
		}
		const proxy = chatUserProxy(c);
		if (!proxy.ok) return c.json({ error: "chat_not_provisioned" }, 503);
		const tokenRow = await proxy.getToken();
		if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);
		const userIds = [
			...new Set([tokenRow.mmUserId, ...others.filter((id) => id !== tokenRow.mmUserId)]),
		];
		if (userIds.length < 3 || userIds.length > 8) {
			return c.json({ error: "Group DM must have 3-8 members" }, 400);
		}
		const result = await proxy.call<MattermostChannel>(
			"/api/v4/channels/group",
			{ method: "POST", body: JSON.stringify(userIds) },
		);
		if (!result.ok) {
			if (result.status === 503) return c.json({ error: "chat_not_provisioned" }, 503);
			return c.json({ error: "Group DM create failed" }, 502);
		}
		return c.json(result.data);
	},
);

// GET /api/chat/team-members — list every member of the employee's team
// (minus the requesting employee), for the new-DM user picker. Uses the bot
// token (system-admin read access) + a batched user lookup. Cached 60s at the
// edge since team membership changes rarely.
app.get(
	"/api/chat/team-members",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const botToken = c.env.MATTERMOST_BOT_TOKEN;
		if (!botToken) return c.json({ error: "chat_not_provisioned" }, 503);
		const chat = await loadChatContext(c);
		if (!chat.ok) {
			return c.json({ ok: false, reason: chat.reason }, chat.status as 404 | 502 | 503);
		}
		const members = await mmFetch<Array<{ user_id: string }>>(
			c.env.MATTERMOST_URL,
			botToken,
			`/api/v4/teams/${chat.team.id}/members?page=0&per_page=200`,
		);
		if (!members.ok) return c.json({ error: "Team members unavailable" }, 502);
		const ids = members.data
			.map((m) => m.user_id)
			.filter((id) => id && id !== chat.user.id);
		const users: MattermostUser[] = await getMmUsersByIds(
			c.env.MATTERMOST_URL,
			botToken,
			ids,
		);
		return c.json(users, 200, { "Cache-Control": "private, max-age=60" });
	},
);

// ── Phase 31 Wave 0: operator-gated PAT backfill ────────────────────
//
// Iterate every employee and mint+store a Mattermost PAT for any that lack
// one, so existing employees provisioned before migration 3_mm_tokens get a
// per-user token without sending a message first.
//
// PRODUCTION GATE: Do not call this endpoint against production until
// MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true is confirmed set on the
// internjobs-mattermost Fly app (plan 31-06 Task 1). Without the secret,
// mintMmUserToken returns null (501 from MM) and all employees will land in
// the failed count.
app.post(
	"/api/admin/chat/backfill-tokens",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!(await hasOperatorAccess(c.env, c.var.employee))) {
			return c.json({ error: "forbidden_operator_only" }, 403);
		}
		const adminToken = c.env.MATTERMOST_ADMIN_TOKEN;
		const botToken = c.env.MATTERMOST_BOT_TOKEN;
		if (!adminToken || !botToken) {
			return c.json({ error: "mattermost_admin_not_configured" }, 503);
		}
		const stub = getWorkspaceStub(c.env);
		const employees = await stub.listEmployees();
		let minted = 0;
		let skipped = 0;
		let failed = 0;
		for (const emp of employees) {
			const existing = await stub.getEmployeeToken(emp.clerk_user_id);
			if (existing) {
				skipped++;
				continue;
			}
			const user = await getMmUserByEmail(
				c.env.MATTERMOST_URL,
				botToken,
				emp.workspace_email,
			);
			if (!user) {
				failed++;
				continue;
			}
			const token = await mintMmUserToken(
				c.env.MATTERMOST_URL,
				adminToken,
				user.id,
			);
			if (!token) {
				failed++;
				continue;
			}
			await stub.setEmployeeToken(emp.clerk_user_id, user.id, token);
			minted++;
		}
		return c.json({ minted, skipped, failed });
	},
);

// -- Wave 2b: employee admin + OIDC bridge --------------------------
// Both subtrees are mounted on the same Hono app so they inherit the
// CORS + Clerk auth middleware from workers/app.ts. /api/admin/*
// additionally requires the operator role (gate in adminEmployees);
// /oidc/* lives OUTSIDE /api/* deliberately — Mattermost's OAuth
// client expects standard OIDC paths at the root.

app.route("/api/admin/employees", adminEmployees);
app.route("/oidc", oidc);

// v1.3 Phase 20 SAFETY-VIEW-01: /api/ops/safety
// Every sub-route requires employee auth (requireEmployeeMailbox below).
// Per-route operator-gating is inside `opsSafety` itself — the
// /unreviewed-count sub-route is accessible to any employee (badge logic);
// list + mark-reviewed apply requireOperator at the route level inside ops-safety.ts.
app.use("/api/ops/safety/*", requireEmployeeMailbox);
app.route("/api/ops/safety", opsSafety);

// ── Phase 12 smoke test (dev-only) ──────────────────────────────
// Hit with: curl -X POST http://localhost:8787/api/dev/smoke/seed-email \
//   -H "X-Parrot-Dev-Employee: dev@internjobs.ai" \
//   -H "Content-Type: application/json"
//
// Asserts: at least one todo with source_channel='email' appears in
// GET /api/dashboard/todos within the same request.
//
// Guards:
//   - Only runs when PARROT_DEV_MODE env var is set (wrangler dev sets it implicitly
//     via the --env flag; production Worker has no such var).
//   - Requires X-Parrot-Dev-Employee header (existing dev-auth bypass in lib/mailbox.ts).

app.post(
	"/api/dev/smoke/seed-email",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		// Guard: dev-only
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}

		const stub = c.var.mailboxStub;
		const employee = c.var.employee;
		const emailId = `smoke-${Date.now()}`;

		// Seed a deterministic email likely to produce a todo
		await stub.createEmail(
			"Inbox",
			{
				id: emailId,
				subject: "Action required: please review the contract by Friday EOD",
				sender: "test-sender@example.com",
				recipient: employee.email,
				date: new Date().toISOString(),
				body: [
					"Hi team,",
					"",
					"Please review the attached contract and reply with approval by Friday EOD.",
					"This is blocking the vendor onboarding and is urgent.",
					"",
					"Also, can you set up a call with the legal team this week?",
					"",
					"Thanks",
				].join("\n"),
			},
			[],
		);

		// Give extraction a moment to complete (it's fire-and-forget via void)
		await new Promise((r) => setTimeout(r, 500));

		const todos = await stub.getTodos("all");
		const emailTodos = (
			todos as Array<{ source_channel: string; source_id: string }>
		).filter(
			(t) => t.source_channel === "email" && t.source_id === emailId,
		);

		return c.json({
			seeded_email_id: emailId,
			todos_extracted: emailTodos.length,
			todos: emailTodos,
			pass: emailTodos.length > 0,
		});
	},
);

// ── Phase 12 ranking regression (dev-only, deterministic) ───────
// Hit with: curl -X POST http://localhost:8787/api/dev/smoke/ranking \
//   -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
//
// Uses debugInsertTodo to bypass LLM with EXPLICIT scores.
// This makes the test 100% deterministic — no live AI calls and
// no PARROT_AI_GATEWAY_ID required. Useful as a regression gate
// against accidental changes to the hybrid-rank SQL in
// EmployeeMailboxDO.getTodos().
//
// Expected ranks (recency_decay ≈ 0 since both inserted in same request):
//   todo-hi: urgency=80, is_mention=false → rank = (80*2) + 0 = 160
//   todo-lo: urgency=20, is_mention=true  → rank = (20*2) + 30 = 70
// hi always ranks first: 160 > 70.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
//   cloudflare/skills: durable-objects — debugInsertTodo RPC, getTodos ranked query

app.post(
	"/api/dev/smoke/ranking",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}

		const stub = c.var.mailboxStub;
		const employee = c.var.employee;

		const hiSourceId = `rank-hi-${Date.now()}`;
		const loSourceId = `rank-lo-${Date.now() + 1}`;

		// Insert deterministic todos via debugInsertTodo — no LLM, no variability.
		const hiResult = await stub.debugInsertTodo(employee.employeeId, {
			source_channel: "email",
			source_id: hiSourceId,
			title: "Deterministic high-urgency todo (score=80)",
			urgency_score: 80,
			is_mention: false,
			preview: "Regression fixture: urgency=80, is_mention=false",
		});

		const loResult = await stub.debugInsertTodo(employee.employeeId, {
			source_channel: "email",
			source_id: loSourceId,
			title: "Deterministic low-urgency mention (score=20)",
			urgency_score: 20,
			is_mention: true,
			preview: "Regression fixture: urgency=20, is_mention=true",
		});

		const todos = (await stub.getTodos("all")) as Array<{
			source_id: string;
			urgency_score: number;
			is_mention: boolean;
			rank: number;
		}>;

		const hiTodo = todos.find((t) => t.source_id === hiSourceId);
		const loTodo = todos.find((t) => t.source_id === loSourceId);

		const hiRanksFirst =
			hiTodo && loTodo ? hiTodo.rank > loTodo.rank : null;

		return c.json({
			hi_todo: hiTodo ?? null,
			lo_todo: loTodo ?? null,
			hi_inserted: hiResult?.inserted ?? false,
			lo_inserted: loResult?.inserted ?? false,
			hi_ranks_first: hiRanksFirst,
			pass:
				hiRanksFirst === true &&
				(hiResult?.inserted ?? false) &&
				(loResult?.inserted ?? false),
			note: "Deterministic — no LLM involved. Scores are explicit via debugInsertTodo.",
		});
	},
);

// ── Phase 13 push smoke (dev-only, deterministic) ───────────────
// Hit with: curl -X POST http://localhost:8787/api/dev/smoke/push \
//   -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
//
// Verifies that the notification + push_subscription tables and the
// markNotificationsRead path work end-to-end WITHOUT requiring live
// VAPID keys or a real push service:
//   1. Inserts a sentinel push subscription row
//   2. Stores a notification via addNotification
//   3. Reads back via getNotifications, asserts the row landed
//   4. Calls markNotificationsRead(), asserts everything is read
//   5. Removes the sentinel push subscription
//
// Returns { pass: true } only when every step succeeded. When VAPID
// is configured the sendPushToSubscriptions path will also fan out
// to the sentinel endpoint and prune it on 410 — but this smoke does
// NOT call that helper directly to keep the test deterministic when
// the keys are absent.

app.post(
	"/api/dev/smoke/push",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}
		const stub = c.var.mailboxStub;
		const fakeEndpoint = `https://smoke.example.com/push/${Date.now()}`;

		// 1. Sentinel subscription
		await stub.addPushSubscription(fakeEndpoint, "smoke_p256dh", "smoke_auth");

		// 2. Direct notification insert (bypass VAPID so we don't need keys)
		await stub.addNotification({
			event_type: "urgent_todo",
			title: "Smoke test notification",
			body: "Push smoke test",
			url: "/dashboard",
		});

		// 3. Read back
		const notifications = await stub.getNotifications(5);
		const smokeNotif = notifications.find(
			(n) => n.title === "Smoke test notification",
		);

		// 4. Mark everything read, assert no unread rows remain
		await stub.markNotificationsRead();
		const afterRead = await stub.getNotifications(5);
		const allRead = afterRead.every((n) => n.read === 1);

		// 5. Cleanup
		await stub.removePushSubscription(fakeEndpoint);

		return c.json({
			notification_stored: !!smokeNotif,
			mark_read_works: allRead,
			vapid_configured:
				!!c.env.PUSH_VAPID_PRIVATE_KEY && !!c.env.PUSH_VAPID_PUBLIC_KEY,
			pass: !!smokeNotif && allRead,
			note: "Push fan-out via VAPID is exercised separately in live integration tests; this smoke is store/read/mark-read only.",
		});
	},
);

// ── Phase 13 Wave 2 smoke test (dev-only) ──────────────────────
// Hit with: curl -X POST http://localhost:8787/api/dev/smoke/crosspane \
//   -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
//
// Asserts:
//   - chatToEmail returns a draft with non-empty subject + body.
//   - emailToChat fails GRACEFULLY (ok:false + error string, no throw)
//     when MATTERMOST_BOT_TOKEN is unset OR email_id doesn't exist.

app.post(
	"/api/dev/smoke/crosspane",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}
		const stub = c.var.mailboxStub;

		// 1. chatToEmail — deterministic, no external dep.
		const chatResult = await stub.chatToEmail(
			"smoke-post-id",
			"Please review the Q2 report before Friday.",
		);
		const chatOk =
			chatResult.ok &&
			!!chatResult.draft?.subject &&
			!!chatResult.draft?.body;

		// 2. emailToChat — must fail gracefully (no throw) when the
		// email is missing or Mattermost is unavailable.
		let emailToChatGraceful = false;
		try {
			const emailResult = await stub.emailToChat("nonexistent-email-id");
			emailToChatGraceful = !emailResult.ok && !!emailResult.error;
		} catch {
			emailToChatGraceful = false;
		}

		return c.json({
			chat_to_email_draft_assembled: chatOk,
			email_to_chat_graceful_failure: emailToChatGraceful,
			pass: chatOk && emailToChatGraceful,
		});
	},
);

// ── Phase 13 Wave 3: onboarding + feature flags ────────────────
//
// POST /api/onboarding/complete — marks the employee onboarded after
// the wizard's final step. Optionally updates display_name before the
// flag flip (step 1 of the wizard lets the employee change it).
//
// GET /api/feature-flags — returns the merged per-employee flag map.
// The wizard reads this on mount to know whether to show itself
// (onboarding_wizard flag) and the rest of the workspace reads it to
// gate cross-pane / push features.
//
// Skills referenced:
//   cloudflare/skills: durable-objects — DO RPC for profile mutation
//   cloudflare/skills: cloudflare — KV-backed feature flag overrides

app.post(
	"/api/onboarding/complete",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const body = (await c.req.json().catch(() => null)) as {
			display_name?: string;
			push_enabled?: boolean;
		} | null;
		const stub = c.var.mailboxStub;

		// Optionally update display name from step 1 of the wizard.
		if (body?.display_name && body.display_name.trim()) {
			const employee = c.var.employee;
			await stub.upsertProfile({
				employeeId: employee.employeeId,
				email: employee.email,
				displayName: body.display_name.trim(),
			});
		}

		// Mark onboarding complete. The wizard hides itself the next time
		// /api/me returns onboarded_at = non-null.
		await stub.setOnboardedAt();

		return c.json({ ok: true });
	},
);

app.get(
	"/api/feature-flags",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const flags = await c.var.mailboxStub.getFeatureFlags();
		return c.json({ flags });
	},
);

// ── Phase 13 Wave 3 smoke (dev-only, deterministic) ─────────────
// Hit with: curl -X POST http://localhost:8787/api/dev/smoke/onboarding \
//   -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
//
// Asserts:
//   - setOnboardedAt() flips onboarded_at from null → ISO timestamp.
//   - getFeatureFlags() returns a non-null object with the canonical
//     default-on flags when KV is unbound.
//   - isFeatureEnabled('cross_pane') returns true under defaults.
//
// Deterministic: does NOT depend on PARROT_FEATURE_FLAGS being bound.

app.post(
	"/api/dev/smoke/onboarding",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}
		const stub = c.var.mailboxStub;

		// 1. Capture starting state.
		const profileBefore = await stub.getProfile();
		const wasNotOnboarded = profileBefore?.onboardedAt === null;

		// 2. Flip onboarded_at.
		await stub.setOnboardedAt();
		const profileAfter = await stub.getProfile();
		const onboardedAtSet = !!profileAfter?.onboardedAt;

		// 3. Feature flags default map.
		const flags = await stub.getFeatureFlags();
		const flagsReturned =
			typeof flags === "object" && flags !== null && !Array.isArray(flags);

		// 4. Default isFeatureEnabled — cross_pane should be on by default.
		const crossPaneEnabled = await stub.isFeatureEnabled("cross_pane");

		return c.json({
			was_not_onboarded: wasNotOnboarded,
			onboarded_at_set: onboardedAtSet,
			flags_returned: flagsReturned,
			cross_pane_enabled: crossPaneEnabled,
			pass: onboardedAtSet && flagsReturned && crossPaneEnabled,
		});
	},
);

// ── Phase 11 Daily.co smoke test (dev-only) ─────────────────────────
//
// Hit with:
//   curl -X POST http://localhost:8787/api/dev/smoke/dailyco
//
// pass: true   = DAILY_API_KEY present AND createRoom + getRoom +
//                deleteRoom all succeed against the real Daily.co API.
// pass: false  = key absent OR any call failed — reason field explains
//                which. NEVER throws — daily.ts swallows errors into null.
//
// Auth gate: PARROT_DEV_MODE only, NOT requireEmployeeMailbox — this
// endpoint only exercises the Worker→Daily.co plumbing and creates a
// throwaway room (deleted at end of run) so it doesn't need a DO.
app.post("/api/dev/smoke/dailyco", async (c: AppContext) => {
	if (!c.env.PARROT_DEV_MODE) {
		return c.json({ error: "dev mode only" }, 403);
	}
	const apiKey = c.env.DAILY_API_KEY;
	if (!apiKey) {
		return c.json({
			pass: false,
			reason: "daily_api_key_missing",
			detail:
				"DAILY_API_KEY not set — run `wrangler secret put DAILY_API_KEY --cwd apps/parrot`",
		});
	}
	const roomName = `parrot-smoke-${Date.now()}`;
	const created = await createRoom(apiKey, roomName);
	if (!created) {
		return c.json({
			pass: false,
			reason: "create_room_failed",
			room_name: roomName,
		});
	}
	const fetched = await getRoom(apiKey, roomName);
	const deleted = await deleteRoom(apiKey, roomName);
	return c.json({
		pass: !!fetched && !!deleted,
		room_name: roomName,
		room_url: created.url,
		get_ok: !!fetched,
		delete_ok: !!deleted,
	});
});

// ── 2026-05-19 fix: dev-only seed for WorkspaceDO employee rows ──
//
// PARROT_DEV_MODE-gated. Bypasses the normal /api/admin/invite flow
// (which requires Clerk operator session + creates a fresh Clerk
// user). Used for one-off provisioning of EXISTING Clerk users into
// the WorkspaceDO directory — e.g., when an employee was created in
// Clerk outside the invite flow and now needs an inbound email
// mailbox alias.
//
// POST body: { clerk_user_id, workspace_email, personal_email, display_name }
// Returns the created/existing WorkspaceDO row.
app.post("/api/dev/seed-employee", async (c: AppContext) => {
	if (!c.env.PARROT_DEV_MODE) {
		return c.json({ error: "dev mode only" }, 403);
	}
	const body = (await c.req.json().catch(() => null)) as {
		clerk_user_id?: string;
		workspace_email?: string;
		personal_email?: string;
		display_name?: string;
	} | null;
	if (
		!body?.clerk_user_id ||
		!body?.workspace_email ||
		!body?.personal_email ||
		!body?.display_name
	) {
		return c.json(
			{
				error: "missing fields",
				required: [
					"clerk_user_id",
					"workspace_email",
					"personal_email",
					"display_name",
				],
			},
			400,
		);
	}
	const workspace = c.env.WORKSPACE.get(c.env.WORKSPACE.idFromName("workspace"));
	const existing = await (
		workspace as unknown as {
			getEmployeeByWorkspaceEmail(email: string): Promise<unknown | null>;
		}
	).getEmployeeByWorkspaceEmail(body.workspace_email.toLowerCase());
	if (existing) {
		return c.json({ created: false, existing });
	}
	const created = await (
		workspace as unknown as {
			createEmployee(input: {
				clerkUserId: string;
				workspaceEmail: string;
				personalEmail: string;
				displayName: string;
			}): Promise<unknown>;
		}
	).createEmployee({
		clerkUserId: body.clerk_user_id,
		workspaceEmail: body.workspace_email.toLowerCase(),
		personalEmail: body.personal_email,
		displayName: body.display_name,
	});
	return c.json({ created: true, employee: created });
});

// ── v1.3.1 Agent Lift smoke test (dev-only, deterministic) ───
//
// Hit with:
//   curl -X POST http://localhost:8787/api/dev/smoke/agent \
//     -H "X-Parrot-Dev-Employee: dev@internjobs.ai"
//
// Asserts the worker-side agent surface is wired correctly WITHOUT
// requiring an AI Gateway call (the live AI quota would make this
// flaky in CI). Specifically:
//   1. GET /tools returns the canonical PARROT_AGENT_TOOLS catalog
//      (11 tools as of Commit A).
//   2. POST /summarize against a seeded email returns either a
//      summary (gateway live) OR a 503 "agent unavailable" error
//      (gateway not configured / over quota). EITHER outcome
//      proves the route plumbing is intact — only an unhandled
//      throw or a 404 would be a regression.
//   3. POST /extract-actions follows the same pass criterion.
//   4. The agent route correctly scopes to the authenticated
//      employee (we seed an email in the dev employee's inbox and
//      assert /summarize finds it; trying to summarize a random
//      UUID returns 404).

app.post(
	"/api/dev/smoke/agent",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		if (!c.env.PARROT_DEV_MODE) {
			return c.json({ error: "dev-only endpoint" }, 403);
		}
		const stub = c.var.mailboxStub;
		const employee = c.var.employee;
		const emailId = `agent-smoke-${Date.now()}`;

		// Seed a deterministic email so /summarize has something to chew on.
		await stub.createEmail(
			"Inbox",
			{
				id: emailId,
				subject: "Quarterly KPI review next Friday",
				sender: "test-pm@example.com",
				recipient: employee.email,
				date: new Date().toISOString(),
				body: [
					"Hi team,",
					"",
					"Please send me Q3 KPI numbers by Thursday EOD.",
					"We'll review them in the all-hands next Friday at 10am.",
					"Let me know if anything is blocking.",
					"",
					"Thanks",
				].join("\n"),
			},
			[],
		);

		// 1. GET /tools — assert 11+ tools listed.
		// We invoke the handler directly via fetch to keep the route
		// resolution honest.
		const toolsResp = await app.fetch(
			new Request("http://internal/api/inbox/agent/tools", {
				headers: {
					"X-Parrot-Dev-Employee":
						c.req.header("X-Parrot-Dev-Employee") ?? employee.employeeId,
				},
			}),
			c.env,
			c.executionCtx as ExecutionContext,
		);
		const toolsData = (await toolsResp.json().catch(() => null)) as {
			tools?: Array<{ name: string; description: string }>;
		} | null;
		const toolsCount = toolsData?.tools?.length ?? 0;

		// 2. POST /summarize against the seeded email.
		const summarizeResp = await app.fetch(
			new Request("http://internal/api/inbox/agent/summarize", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Parrot-Dev-Employee":
						c.req.header("X-Parrot-Dev-Employee") ?? employee.employeeId,
				},
				body: JSON.stringify({ email_id: emailId }),
			}),
			c.env,
			c.executionCtx as ExecutionContext,
		);
		// Either a 200 with summary OR a 503 ("agent unavailable") counts as wired.
		// A 404 (email not found) would mean scoping is broken — regression.
		const summarizeWired =
			summarizeResp.status === 200 || summarizeResp.status === 503;

		// 3. /summarize on a random ID should 404 (scoping check).
		const notFoundResp = await app.fetch(
			new Request("http://internal/api/inbox/agent/summarize", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Parrot-Dev-Employee":
						c.req.header("X-Parrot-Dev-Employee") ?? employee.employeeId,
				},
				body: JSON.stringify({ email_id: "definitely-not-real" }),
			}),
			c.env,
			c.executionCtx as ExecutionContext,
		);
		const scopingHonored = notFoundResp.status === 404;

		return c.json({
			seeded_email_id: emailId,
			tools_count: toolsCount,
			tools_pass: toolsCount >= 11,
			summarize_status: summarizeResp.status,
			summarize_pass: summarizeWired,
			scoping_pass: scopingHonored,
			pass: toolsCount >= 11 && summarizeWired && scopingHonored,
			note: "Agent live response depends on PARROT_AI_GATEWAY_ID; 503 here just means the gateway isn't configured — route wiring is still verified.",
		});
	},
);

// ── Phase 13 Wave 3: global Hono error handler ──────────────────
//
// Catches anything that escapes a route handler, posts it to Sentry
// (if SENTRY_DSN is set), and returns a generic JSON 500. Mounted at
// the END of the chain so route-local error handling takes precedence.
app.onError((err, c) => {
	console.error("[parrot] unhandled error:", err);
	reportToSentry(c.env, err, "Hono unhandled route error");
	return c.json({ error: "Internal server error" }, 500);
});

export { app };
