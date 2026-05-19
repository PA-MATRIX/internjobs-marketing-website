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
import { z } from "zod";
import { Folders } from "../shared/folders";
import {
	handleReplyEmail,
	handleForwardEmail,
} from "./routes/reply-forward";
import {
	requireEmployeeMailbox,
	type ParrotContext,
} from "./lib/mailbox";
import {
	SenderValidationError,
	generateMessageId,
	validateSender,
} from "./lib/email-helpers";
import { adminEmployees } from "./routes/admin-employees";
import { oidc } from "./routes/oidc";

type AppContext = Context<ParrotContext>;

// -- Request schemas ------------------------------------------------

const SendEmailSchema = z.object({
	to: z.union([z.string().email(), z.array(z.string().email())]),
	cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
	bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
	subject: z.string().min(1),
	html: z.string().optional(),
	text: z.string().optional(),
});

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
	const allowlist = (c.env.PARROT_OPERATOR_EMAILS || "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	const meta = employee.publicMetadata as
		| { role?: unknown }
		| null
		| undefined;
	const role = String(meta?.role || "").toLowerCase();
	const isOperator =
		role === "operator" ||
		role === "admin" ||
		role === "ceo" ||
		allowlist.includes(String(employee.email).toLowerCase());
	return c.json({
		employee_id: profile.employeeId,
		email: profile.email,
		display_name: profile.displayName,
		created_at: profile.createdAt,
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

app.post(
	"/api/inbox/send",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const employee = c.var.employee;
		const stub = c.var.mailboxStub;
		const body = SendEmailSchema.parse(await c.req.json());
		const { to, cc, bcc, subject, html, text } = body;

		// Wave 1: real outbound delivery via the EMAIL service binding is
		// deferred until Cloudflare Email Routing for *@internjobs.ai apex
		// is reconfigured. For now we only write to the Sent folder so the
		// UI's "send" flow can be exercised end-to-end without bouncing
		// real email at unsuspecting recipients.

		let toStr: string;
		let fromEmail: string;
		let fromDomain: string;
		try {
			({ toStr, fromEmail, fromDomain } = validateSender(
				to,
				employee.email,
				employee.email,
			));
		} catch (e) {
			if (e instanceof SenderValidationError) {
				return c.json({ error: e.message }, 400);
			}
			throw e;
		}

		const rateLimit = await stub.checkSendRateLimit();
		if (rateLimit) return c.json({ error: rateLimit }, 429);

		const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

		const ccStr = cc
			? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase()
			: null;
		const bccStr = bcc
			? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase()
			: null;

		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject,
				sender: fromEmail,
				recipient: toStr,
				cc: ccStr,
				bcc: bccStr,
				date: new Date().toISOString(),
				body: html || text || "",
				thread_id: messageId,
				message_id: outgoingMessageId,
				raw_headers: JSON.stringify([
					{ key: "from", value: fromEmail },
					{
						key: "to",
						value: Array.isArray(to) ? to.join(", ") : to,
					},
					{ key: "subject", value: subject },
					{ key: "date", value: new Date().toISOString() },
					{ key: "message-id", value: `<${outgoingMessageId}>` },
				]),
			},
			[],
		);

		return c.json(
			{
				id: messageId,
				status: "queued_local_only",
				note: "Wave 1 stub: written to Sent but outbound SMTP delivery is deferred.",
			},
			202,
		);
	},
);

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
//   ?view=all | mentions | today | week
app.get(
	"/api/dashboard/todos",
	requireEmployeeMailbox,
	async (c: AppContext) => {
		const stub = c.var.mailboxStub;
		const view = c.req.query("view") ?? "all";
		const todos = await stub.getTodos(view);
		return c.json({ todos });
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

// -- Meetings (Daily.co — Wave 3 stub) ------------------------------

app.post("/api/meetings/create", requireEmployeeMailbox, async (c) => {
	// Wave 3 will replace this with a real POST to Daily.co's /rooms API.
	// Shape mirrors the future real response so the React UI doesn't need
	// to change when the stub flips to live.
	return c.json({
		url: "https://daily.co/room-stub",
		token: "stub-token",
		note: "Wave 3 stub: real Daily.co room creation lands once PARROT_DAILY_API_KEY is provisioned.",
	});
});

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
		// Phase 13: Start Meeting is a UI seam for Phase 11 (Daily.co).
		// We record the request via the notifications table so we can
		// measure pilot demand. When Phase 11 ships, this handler gets a
		// real Daily.co POST /rooms call; the audit write stays as-is.
		const stub = c.var.mailboxStub;
		// event_type 'urgent_todo' is the nearest available type; a
		// dedicated 'start_meeting_requested' type will be added when
		// Phase 11 expands the CHECK constraint.
		void stub.addNotification({
			event_type: "urgent_todo",
			title: "Meeting requested (Phase 11 pending)",
			body: "Employee clicked Start Meeting — Daily.co integration deferred.",
			url: "/meetings",
		});
		return c.json({
			ok: true,
			reason: "meetings_coming_soon",
			message:
				"Meetings coming soon — Daily.co integration is on the roadmap.",
		});
	},
);

// -- Mattermost (Wave 2 stub) ---------------------------------------

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

// -- Wave 2b: employee admin + OIDC bridge --------------------------
// Both subtrees are mounted on the same Hono app so they inherit the
// CORS + Clerk auth middleware from workers/app.ts. /api/admin/*
// additionally requires the operator role (gate in adminEmployees);
// /oidc/* lives OUTSIDE /api/* deliberately — Mattermost's OAuth
// client expects standard OIDC paths at the root.

app.route("/api/admin/employees", adminEmployees);
app.route("/oidc", oidc);

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

export { app };
