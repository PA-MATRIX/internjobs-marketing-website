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

// -- Cross-pane action stubs (Wave 4 fills the backend) -------------

app.post(
	"/api/crosspane/chat-to-email",
	requireEmployeeMailbox,
	(c) => c.json({ ok: false, reason: "not_implemented_wave_4" }, 501),
);

app.post(
	"/api/crosspane/email-to-chat",
	requireEmployeeMailbox,
	(c) => c.json({ ok: false, reason: "not_implemented_wave_4" }, 501),
);

app.post(
	"/api/crosspane/start-meeting",
	requireEmployeeMailbox,
	(c) => c.json({ ok: false, reason: "not_implemented_wave_4" }, 501),
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

export { app };
