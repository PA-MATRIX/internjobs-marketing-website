// v1.2 Phase 10 Wave 1: EmployeeMailboxDO — per-employee mailbox.
//
// Forked from apps/agentic-inbox/workers/durableObject/index.ts.
// Wave 1 differences:
//   - DO instance keyed by stable clerk_user_id (NOT by email address as
//     in agentic-inbox). Lets us rename the @internjobs.ai alias without
//     losing the mailbox.
//   - Adds a `profile` table + getProfile() / upsertProfile() so the UI
//     can hydrate `{ email, displayName, employeeId }` in one call.
//   - Drops the agentic-inbox threaded/search/threading-helper SQL — Wave 1
//     only needs basic CRUD; the heavier threading logic will be lifted
//     verbatim in a later wave when the InboxPane needs it.
//
// Keeps the same schema shape (emails / attachments / folders) so the
// agentic-inbox patterns port over cleanly when we need them.
//
// Skills referenced:
//   cloudflare/skills: agents-sdk, durable-objects — per-employee DO,
//     alarm-driven Mattermost poll, Web Push VAPID signing via crypto.subtle.

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { applyMigrations, employeeMailboxMigrations } from "./migrations";
import { extractTodosFromText } from "../lib/ai";
import {
	resolveMmUserId,
	getMmUserByEmail,
	getMmChannelsForUser,
	getMmChannel,
	mmChannelLabel,
	getMmPostsSince,
	matchesMention,
	MM_USER_ID_NONE,
} from "../lib/mattermost";
import { buildVapidAuthHeader } from "../lib/vapid";
import { createRoom } from "../lib/daily";
// Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): offline @mention/DM email.
import { sendOfflineChatNotification } from "../lib/email-sender";
// Phase 14 Wave 2: graph wiring (fail-soft when FALKORDB_URL absent).
import {
	getEmployeeContext,
	recordTodoFact,
	ensureParrotGraphSchema,
} from "../lib/graph";

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, (typeof schema.emails)[keyof typeof schema.emails]>;

interface GetEmailsOptions {
	folder?: string;
	thread_id?: string;
	starred?: boolean;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export interface EmployeeProfile {
	employeeId: string;
	email: string;
	displayName: string;
	createdAt: string;
	/** Phase 13 Wave 3: NULL until the onboarding wizard is completed. */
	onboardedAt: string | null;
}

export class EmployeeMailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(
			this.ctx.storage.sql,
			employeeMailboxMigrations,
			this.ctx.storage,
		);
	}

	// ── Profile ────────────────────────────────────────────────────

	/**
	 * Insert-or-update the per-employee profile row. Called from the
	 * Hono /api/me handler on first hit and on every login to keep
	 * email/displayName in sync with Clerk.
	 */
	async upsertProfile(input: {
		employeeId: string;
		email: string;
		displayName: string;
	}): Promise<EmployeeProfile> {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`INSERT INTO profile (id, employee_id, email, display_name, created_at, updated_at)
			 VALUES (1, ?1, ?2, ?3, ?4, ?4)
			 ON CONFLICT(id) DO UPDATE SET
			   email = excluded.email,
			   display_name = excluded.display_name,
			   updated_at = excluded.updated_at`,
			input.employeeId,
			input.email,
			input.displayName,
			now,
		);
		const profile = await this.getProfile();
		if (!profile) {
			throw new Error("upsertProfile: row missing after upsert");
		}
		// Fire-and-forget alarm init — idempotent, only registers if no alarm exists.
		void this.initAlarm();
		return profile;
	}

	async getProfile(): Promise<EmployeeProfile | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT employee_id, email, display_name, created_at, onboarded_at
				 FROM profile WHERE id = 1`,
			),
		][0] as
			| {
					employee_id: string;
					email: string;
					display_name: string;
					created_at: string;
					onboarded_at: string | null;
			  }
			| undefined;
		if (!row) return null;
		return {
			employeeId: row.employee_id,
			email: row.email,
			displayName: row.display_name,
			createdAt: row.created_at,
			onboardedAt: row.onboarded_at ?? null,
		};
	}

	// ── Phase 13 Wave 3: onboarding + feature flags ─────────────────

	/**
	 * Mark this employee as onboarded. Called from POST /api/onboarding/complete
	 * when the wizard's final step succeeds. The Hono route owns input
	 * validation; this method is intentionally side-effect-only.
	 */
	async setOnboardedAt(): Promise<void> {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`UPDATE profile SET onboarded_at = ?1, updated_at = ?1 WHERE id = 1`,
			now,
		);
	}

	/**
	 * Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): record activity for the
	 * offline-detection path. Called fire-and-forget from requireEmployeeMailbox
	 * (via c.executionCtx.waitUntil) on every authenticated request, so
	 * `last_seen_at` always reflects the employee's most recent Workspace touch.
	 *
	 * Stored as `datetime('now')` (UTC, SQLite text) so the alarm can compare it
	 * directly against `datetime('now', '-5 minutes')`. Cheap single-row UPDATE;
	 * no profile row yet (pre-/api/me) is a harmless no-op (0 rows written).
	 */
	async touchLastSeen(): Promise<void> {
		this.ctx.storage.sql.exec(
			`UPDATE profile SET last_seen_at = datetime('now') WHERE id = 1`,
		);
		// Employee is active again → reset the offline-email high-water mark so a
		// future away-period re-notifies from scratch (see maybeSendOfflineChatEmail).
		await this.ctx.storage.delete("offline_chat_notified_count");
		// Phase 31 gap-fix (#18): guarantee the 2-minute Mattermost polling alarm
		// is scheduled. initAlarm() runs from upsertProfile() on first login, but
		// a mailbox provisioned by another path (or whose alarm somehow lapsed)
		// could otherwise never start polling — so the offline @mention email
		// would never fire. touchLastSeen runs on every authenticated request, so
		// it is a reliable hook. getAlarm() guards against clobbering a pending
		// alarm (we must NOT reset the timer on every request).
		await this.initAlarm();
	}

	/**
	 * Return merged feature flags: global defaults from PARROT_FEATURE_FLAGS
	 * KV (key `global_defaults`) overlaid with per-employee overrides from
	 * the profile.feature_flags JSON column. Employee overrides win.
	 *
	 * Degrades gracefully when the KV namespace is unbound (dev without KV):
	 * returns the canonical default-all-on map so the workspace stays usable.
	 * Any unexpected error (KV throw, malformed JSON) also returns the
	 * default-all-on map — we'd rather over-grant than lock the user out.
	 *
	 * Skills referenced:
	 *   cloudflare/skills: durable-objects, cloudflare — KV read with safe
	 *   defaults; per-employee override merge.
	 */
	async getFeatureFlags(): Promise<Record<string, boolean>> {
		const defaults: Record<string, boolean> = {
			cross_pane: true,
			push: true,
			onboarding_wizard: true,
		};
		try {
			// 1. Per-employee overrides from the profile row (JSON).
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT feature_flags FROM profile WHERE id = 1`,
				),
			][0] as { feature_flags: string | null } | undefined;
			let employeeOverrides: Record<string, boolean> = {};
			if (row?.feature_flags) {
				try {
					const parsed = JSON.parse(row.feature_flags);
					if (parsed && typeof parsed === "object") {
						employeeOverrides = parsed as Record<string, boolean>;
					}
				} catch {
					/* malformed JSON in the column — ignore and use defaults */
				}
			}

			// 2. Global defaults from KV (if bound).
			let kvDefaults: Record<string, boolean> = {};
			const kv = this.env.PARROT_FEATURE_FLAGS;
			if (kv && typeof kv.get === "function") {
				try {
					const fromKv = await kv.get("global_defaults", { type: "json" });
					if (fromKv && typeof fromKv === "object") {
						kvDefaults = fromKv as Record<string, boolean>;
					}
				} catch {
					/* KV miss / network blip — fall through to defaults */
				}
			}

			return { ...defaults, ...kvDefaults, ...employeeOverrides };
		} catch (err) {
			console.error("getFeatureFlags failed; returning defaults", err);
			return defaults;
		}
	}

	/**
	 * Convenience wrapper: returns `true` unless the named flag is
	 * explicitly set to `false`. Missing keys default to enabled — we
	 * roll out new features on by default and only override to disable.
	 */
	async isFeatureEnabled(flag: string): Promise<boolean> {
		const flags = await this.getFeatureFlags();
		return flags[flag] !== false;
	}

	// ── Email list / get (Drizzle) ─────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			thread_id,
			starred,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? (rawSortColumn as SortColumn)
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}
		// PARROT-FOLDER-ACTIONS-01: Starred is a cross-folder virtual view.
		// Applied independently of `folder`; the caller passes only one.
		if (starred) {
			conditions.push(eq(schema.emails.starred, 1));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
		}));
	}

	async countEmails(
		options: { folder?: string; thread_id?: string; starred?: boolean } = {},
	) {
		const { folder, thread_id, starred } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		// PARROT-FOLDER-ACTIONS-01: parameterless literal — safe with ?N indexing.
		if (starred) {
			conditions.push("starred = 1");
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
		};
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) data.read = read ? 1 : 0;
		if (starred !== undefined) data.starred = starred ? 1 : 0;

		if (Object.keys(data).length === 0) return this.getEmail(id);

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		return this.getEmail(id);
	}

	/**
	 * v1.3.1 BACKFILL: mark every unread row in a thread as read.
	 * Called from the reply route after the sender has clearly engaged
	 * with the thread — they composed a reply, so by definition they've
	 * read it. Mirrors apps/agentic-inbox/workers/durableObject/index.ts.
	 */
	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		// Phase 12 Wave 2: mark todos resolved before source is gone.
		this.cleanupTodosForEmail(id);

		this.db.delete(schema.emails).where(eq(schema.emails.id, id)).run();

		return emailAttachments;
	}

	/**
	 * v1.3.1 Agent Lift: move an email between folders.
	 *
	 * Returns true if the row was updated, false otherwise. The target
	 * folder is validated against the `folders` table — unknown folder
	 * IDs return false so the agent can surface a clean error instead of
	 * silently no-oping.
	 */
	async moveEmail(id: string, folderId: string): Promise<boolean> {
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(
				or(eq(schema.folders.id, folderId), eq(schema.folders.name, folderId)),
			)
			.limit(1)
			.all();
		if (folderRow.length === 0) return false;
		const resolvedFolderId = folderRow[0].id;

		const existing = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();
		if (!existing) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: resolvedFolderId })
			.where(eq(schema.emails.id, id))
			.run();
		return true;
	}

	/**
	 * v1.3.1 Agent Lift: search emails by query against subject / sender /
	 * body. Uses SQL LIKE — no FTS5 yet, but the row count per employee is
	 * usually small enough that this is fine. Returns metadata only (same
	 * shape as getEmails).
	 *
	 * Limit is capped at 50 so a runaway agent query can't ship a 10k-row
	 * payload back over the wire.
	 */
	async searchEmails(options: {
		query: string;
		folder?: string;
		limit?: number;
	}) {
		const limit = Math.min(options.limit ?? 20, 50);
		const q = `%${options.query.toLowerCase()}%`;
		const params: unknown[] = [q, q, q];
		let sqlStr = `
			SELECT id, folder_id, subject, sender, recipient, date,
				read, starred, in_reply_to, email_references, thread_id,
				substr(body, 1, 200) AS snippet
			FROM emails
			WHERE (LOWER(subject) LIKE ?1 OR LOWER(sender) LIKE ?2 OR LOWER(body) LIKE ?3)
		`;
		if (options.folder) {
			sqlStr += ` AND folder_id = ?4`;
			params.push(options.folder);
		}
		sqlStr += ` ORDER BY date DESC LIMIT ${limit}`;

		const rows = [
			...this.ctx.storage.sql.exec(sqlStr, ...params),
		] as Array<{
			id: string;
			folder_id: string;
			subject: string | null;
			sender: string | null;
			recipient: string | null;
			date: string | null;
			read: number;
			starred: number;
			in_reply_to: string | null;
			email_references: string | null;
			thread_id: string | null;
			snippet: string | null;
		}>;

		return rows.map((r) => ({
			...r,
			read: r.read === 1,
			starred: r.starred === 1,
		}));
	}

	// ── Folders ────────────────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(
					Number,
				),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	// ── Send-rate limiting (matches agentic-inbox) ─────────────────

	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as cnt FROM emails
				 WHERE folder_id = ?1
				   AND date >= datetime('now', '-1 hour')`,
				Folders.SENT,
			),
		][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as cnt FROM emails
				 WHERE folder_id = ?1
				   AND date >= datetime('now', '-1 day')`,
				Folders.SENT,
			),
		][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	// ── Email creation ─────────────────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;

		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isSent ? 1 : email.read ? 1 : 0,
				starred: email.starred ? 1 : 0,
				body: email.body,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}

		// Phase 12 Wave 2: Extract todos from inbound Inbox emails only.
		// Fire-and-forget (void) — extraction errors NEVER block email storage.
		if (folderId === Folders.INBOX) {
			const profile = await this.getProfile();
			if (profile) {
				void this.extractTodosFromEmail(email, profile.employeeId);
			}
		}

		// Phase 13 Wave 1: starred inbound email → push notification.
		if (folderId === Folders.INBOX && email.starred === true) {
			void this.sendPushToSubscriptions({
				title: `Starred email from ${email.sender}`,
				body: email.subject ?? undefined,
				// Phase 31 gap-fix: deep-link straight to the email in the reader.
				url: `/inbox?message=${email.id}`,
				event_type: "starred_email",
			});
		}
	}

	// ── Todos ──────────────────────────────────────────────────────

	private insertTodos(
		todos: Array<{
			source_channel: string;
			source_id: string;
			title: string;
			preview?: string;
			urgency_score: number;
			deadline_at?: string | null;
			mentioned_actors?: string[];
			is_mention: boolean;
			employee_id: string;
			// Phase 31 gap-fix: deep-link target for the urgent-todo notification
			// (e.g. `/chat?channel=…&post=…` or `/inbox?message=…`). Falls back to
			// `/dashboard` when absent.
			source_url?: string;
		}>,
	) {
		// Phase 13 Wave 1: fire a push for every newly-inserted urgent todo.
		// We intentionally cannot tell from `INSERT OR IGNORE` whether the
		// row was a duplicate, so we guard by `source_id` being present in
		// the table BEFORE insert. (Phase 12 dedup uses the unique index
		// on (source_channel, source_id) — a re-insert silently no-ops.)
		const urgentToPush: Array<{
			title: string;
			preview?: string;
			url?: string;
		}> = [];
		for (const todo of todos) {
			const id = crypto.randomUUID();
			const wasPresent =
				todo.urgency_score >= 70
					? [
							...this.ctx.storage.sql.exec(
								`SELECT 1 FROM todos WHERE source_channel = ? AND source_id = ? LIMIT 1`,
								todo.source_channel,
								todo.source_id,
							),
						].length > 0
					: false;
			this.ctx.storage.sql.exec(
				`INSERT OR IGNORE INTO todos
					(id, employee_id, source_channel, source_id, title, preview,
					 urgency_score, deadline_at, mentioned_actors, is_mention)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				id,
				todo.employee_id,
				todo.source_channel,
				todo.source_id,
				todo.title,
				todo.preview ?? null,
				todo.urgency_score,
				todo.deadline_at ?? null,
				todo.mentioned_actors ? JSON.stringify(todo.mentioned_actors) : null,
				todo.is_mention ? 1 : 0,
			);
			if (todo.urgency_score >= 70 && !wasPresent) {
				urgentToPush.push({
					title: todo.title,
					preview: todo.preview,
					url: todo.source_url,
				});
			}
		}
		// Phase 13 Wave 1: fire-and-forget push notifications for new urgent todos.
		if (urgentToPush.length > 0) {
			for (const t of urgentToPush) {
				void this.sendPushToSubscriptions({
					title: t.title,
					body: t.preview,
					url: t.url ?? "/dashboard",
					event_type: "urgent_todo",
				});
			}
		}
	}

	/**
	 * Return unresolved todos ordered by hybrid rank formula:
	 *   rank = (urgency_score * 2)
	 *        + (is_mention ? 30 : 0)
	 *        + (deadline within 24h ? 40 : 0, +20 if within 1h)
	 *        - floor(hours_since_created / 6)  [recency decay]
	 *
	 * view: 'all' | 'mentions' | 'today' | 'week'
	 */
	async getTodos(view: string): Promise<unknown[]> {
		const whereExtra =
			{
				mentions: "AND is_mention = 1",
				today: "AND created_at >= datetime('now', 'start of day')",
				week: "AND created_at >= datetime('now', '-7 days')",
			}[view] ?? "";

		// Phase 14 Wave 2 (ROADMAP SC-7): resolved_at IS NULL = active in SQLite.
		// The FalkorDB layer mirrors this via valid_to IS NULL on :Todo nodes
		// (see graph.ts getActiveTodos). Auto-clear happens when recordTodoFact()
		// is called for a thread reply that resolves the item — it sets valid_to
		// on the :Todo node so it drops from getEmployeeContext() prose on the
		// next extraction cycle. The SQLite row is closed via cleanupTodosForEmail()
		// when the source email is deleted; cross-pane resolution is the graph's
		// job, not SQLite's.
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT
					id, employee_id, source_channel, source_id, title, preview,
					urgency_score, deadline_at, mentioned_actors, is_mention,
					created_at, resolved_at,
					(
						(urgency_score * 2)
						+ (CASE WHEN is_mention = 1 THEN 30 ELSE 0 END)
						+ (CASE WHEN deadline_at IS NOT NULL
												AND deadline_at < datetime('now', '+24 hours')
										THEN 40 ELSE 0 END)
						+ (CASE WHEN deadline_at IS NOT NULL
												AND deadline_at < datetime('now', '+1 hour')
										THEN 20 ELSE 0 END)
						- CAST((JULIANDAY('now') - JULIANDAY(created_at)) * 24 / 6 AS INTEGER)
					) AS rank
				 FROM todos
				 WHERE resolved_at IS NULL
				 ${whereExtra}
				 ORDER BY rank DESC
				 LIMIT 50`,
			),
		];

		return rows.map((row) => ({
			...(row as Record<string, unknown>),
			is_mention: Boolean((row as Record<string, unknown>).is_mention),
			mentioned_actors: (() => {
				const raw = (row as Record<string, unknown>).mentioned_actors;
				if (!raw || typeof raw !== "string") return [];
				try {
					return JSON.parse(raw);
				} catch {
					return [];
				}
			})(),
		}));
	}

	/**
	 * v1.3 Phase 19 Plan 01: Mark a todo as resolved by the agent cron.
	 *
	 * Called from workers/lib/auto-clear.ts via DO stub RPC after the cron
	 * finds a :Todo node in FalkorDB whose valid_to has been set (more than
	 * 5 minutes ago — see FIND_CLOSED_TODOS_CYPHER grace period).
	 *
	 * Idempotent: a second call on an already-resolved todo is a no-op via
	 * the `WHERE resolved_at IS NULL` guard — `rowsWritten` reports 0.
	 *
	 * Returns `{ resolved: true }` only when this call actually flipped a row
	 * from active to resolved. The cron logs this for the operator audit
	 * trail; replays / overlaps quietly return `{ resolved: false }`.
	 *
	 * AUTO-CLEAR-01, AUTO-CLEAR-02
	 */
	async resolveTodo(sourceId: string): Promise<{ resolved: boolean }> {
		const cursor = this.ctx.storage.sql.exec(
			`UPDATE todos
			 SET resolved_at = datetime('now'), resolution_source = 'agent'
			 WHERE source_id = ? AND resolved_at IS NULL`,
			sourceId,
		);
		// Drain the cursor before reading rowsWritten (CF DO SqlStorageCursor
		// requires iteration to materialize the statement's effect counters).
		for (const _row of cursor) void _row;
		return { resolved: cursor.rowsWritten > 0 };
	}

	/**
	 * v1.3 Phase 19 Plan 01: Undo an agent auto-resolution.
	 *
	 * Called from POST /api/dashboard/todos/:id/unresolve (Plan 02 route).
	 * Sets resolved_at and resolution_source back to NULL — restores the todo
	 * to the active list on the next poll cycle.
	 *
	 * Idempotent + guarded:
	 *   - Already-active todos (resolved_at IS NULL): no-op, returns
	 *     `{ unresolved: false }`.
	 *   - User-resolved todos (resolution_source IS NULL, the legacy
	 *     cleanupTodosForEmail path): no-op via the `resolution_source =
	 *     'agent'` guard. We refuse to "undo" manual-dismiss because the user
	 *     deliberately closed those — only agent-resolved rows are reversible.
	 *
	 * AUTO-CLEAR-06, AUTO-CLEAR-07
	 */
	async unresolveTodo(todoId: string): Promise<{ unresolved: boolean }> {
		const cursor = this.ctx.storage.sql.exec(
			`UPDATE todos
			 SET resolved_at = NULL, resolution_source = NULL
			 WHERE id = ? AND resolution_source = 'agent'`,
			todoId,
		);
		for (const _row of cursor) void _row;
		return { unresolved: cursor.rowsWritten > 0 };
	}

	/**
	 * v1.3 Phase 19 Plan 02: Resolved-todo view for the Resolved nav item.
	 *
	 * Returns todos where resolved_at IS NOT NULL, ordered by resolved_at DESC.
	 * Limited to the last 48 hours so the Resolved view doesn't accumulate
	 * months of history (FEATURES.md: "Limit to last 48 hours by default").
	 *
	 * The agent vs user distinction is on `resolution_source`:
	 *   - 'agent'  : auto-cleared by the cron (Phase 19) — render with violet
	 *                Agent pill + Undo button.
	 *   - NULL/user: closed by cleanupTodosForEmail or future manual dismiss —
	 *                render with grey You pill, no Undo.
	 *
	 * AUTO-CLEAR-08, AUTO-CLEAR-UX-03
	 */
	async getResolvedTodos(): Promise<unknown[]> {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT
					id, employee_id, source_channel, source_id, title, preview,
					urgency_score, deadline_at, mentioned_actors, is_mention,
					created_at, resolved_at, resolution_source
				 FROM todos
				 WHERE resolved_at IS NOT NULL
					 AND resolved_at >= datetime('now', '-48 hours')
				 ORDER BY resolved_at DESC
				 LIMIT 100`,
			),
		];

		return rows.map((row) => ({
			...(row as Record<string, unknown>),
			is_mention: Boolean((row as Record<string, unknown>).is_mention),
			mentioned_actors: (() => {
				const raw = (row as Record<string, unknown>).mentioned_actors;
				if (!raw || typeof raw !== "string") return [];
				try {
					return JSON.parse(raw);
				} catch {
					return [];
				}
			})(),
		}));
	}

	/**
	 * DEV-ONLY: Insert a todo directly with an explicit urgency_score, bypassing LLM extraction.
	 * Gated by PARROT_DEV_MODE=1. Used by Plan 12-03 regression tests for deterministic assertions.
	 */
	async debugInsertTodo(
		employeeId: string,
		todo: {
			source_channel: string;
			source_id: string;
			title: string;
			urgency_score: number;
			is_mention: boolean;
			preview?: string;
		},
	): Promise<{ inserted: boolean }> {
		if (!this.env.PARROT_DEV_MODE) {
			return { inserted: false };
		}
		this.insertTodos([{ ...todo, employee_id: employeeId }]);
		return { inserted: true };
	}

	private cleanupTodosForEmail(emailId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE todos SET resolved_at = datetime('now')
			 WHERE source_channel = 'email' AND source_id = ?
				 AND resolved_at IS NULL`,
			emailId,
		);
	}

	/**
	 * v1.4 Phase 26 follow-up: resolve the dashboard todo(s) for an email the
	 * user just replied to. Called from handleReplyEmail so the todo clears on
	 * the next 10s dashboard poll instead of waiting on the auto-clear cron
	 * (graph close + 5-min grace + the every-5-min cron = ~10-15 min, and only
	 * if the agent decides the reply satisfied it). `emailId` is the original
	 * email id,
	 * which equals the todo's `source_id`. Mirrors the delete-path cleanup SQL;
	 * resolution_source stays NULL = user-resolved.
	 */
	async resolveTodosForEmail(emailId: string): Promise<{ resolved: boolean }> {
		const cursor = this.ctx.storage.sql.exec(
			`UPDATE todos SET resolved_at = datetime('now')
			 WHERE source_channel = 'email' AND source_id = ?
				 AND resolved_at IS NULL`,
			emailId,
		);
		return { resolved: cursor.rowsWritten > 0 };
	}

	private async extractTodosFromEmail(email: EmailData, employeeId: string) {
		try {
			const text = [email.subject, email.body].filter(Boolean).join("\n\n");

			// Phase 14 Wave 2: pre-extraction context from graph (fail-soft).
			// ensureParrotGraphSchema is idempotent — first call per isolate
			// boots the schema; subsequent calls return immediately.
			// getEmployeeContext returns "" when FalkorDB is unreachable or
			// when the employee has no open todos / collaborators yet, so the
			// AI Gateway cache TTL stays at 3600 for that warm-up path.
			void ensureParrotGraphSchema(this.env);
			const contextBlock = await getEmployeeContext(this.env, employeeId);

			const extracted = await extractTodosFromText(
				text,
				employeeId,
				3600,
				this.env,
				contextBlock || undefined,
			);
			if (extracted === null || extracted.length === 0) {
				// null indicates 429 quota exceeded — log audit event (best-effort).
				if (extracted === null) {
					try {
						this.ctx.storage.sql.exec(
							`INSERT OR IGNORE INTO audit_events (id, employee_id, event_type, created_at)
							 VALUES (?, ?, 'ai_gateway_quota_exceeded', datetime('now'))`,
							crypto.randomUUID(),
							employeeId,
						);
					} catch {
						/* audit_events table may not exist yet */
					}
				}
				return;
			}
			this.insertTodos(
				extracted.map((t) => ({
					...t,
					source_channel: "email",
					source_id: email.id,
					employee_id: employeeId,
					source_url: `/inbox?message=${email.id}`,
				})),
			);

			// Phase 14 Wave 2: persist todos to graph (fire-and-forget, never blocks).
			// recordTodoFact is idempotent via deterministic hash id — re-runs
			// over the same (employeeId, email.id) are MERGE-skipped server-side.
			for (const t of extracted) {
				void recordTodoFact(this.env, {
					employeeId,
					sourceChannel: "email",
					sourceId: email.id,
					title: t.title,
					preview: t.preview,
					urgencyScore: t.urgency_score,
					deadlineAt: t.deadline_at ?? null,
					mentionedActors: t.mentioned_actors ?? [],
					isMention: t.is_mention,
					blockedByIds: t.blocked_by_ids ?? [],
				});
			}
		} catch (err) {
			console.error("extractTodosFromEmail failed", err);
			// Fail-soft: never block email storage
		}
	}

	// ── DO Alarm — Mattermost polling ──────────────────────────────

	/**
	 * Register the 60-second polling alarm if not already set.
	 * Called from upsertProfile() so the alarm starts on first employee login.
	 * #15: tightened from 2min → 60s so offline @mention emails (and todo
	 * extraction) fire closer to real time.
	 */
	async initAlarm() {
		const existing = await this.ctx.storage.getAlarm();
		if (!existing) {
			await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
		}
	}

	/**
	 * DO alarm handler. Polls Mattermost for new posts and extracts todos.
	 * Always self-reschedules — even on error — to maintain the polling cycle.
	 *
	 * Skills referenced:
	 *   cloudflare/skills: durable-objects — alarm self-reschedule pattern
	 *   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
	 */
	async alarm() {
		try {
			await this.pollMattermostNewPosts();
		} catch (err) {
			console.error("Parrot alarm: Mattermost poll failed", err);
		}
		// Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): offline @mention/DM email.
		// Run in its own try/catch so a poll failure above never skips it and an
		// email failure never blocks the reschedule below.
		try {
			await this.maybeSendOfflineChatEmail();
		} catch (err) {
			console.error("Parrot alarm: offline chat email check failed", err);
		} finally {
			// Always reschedule unconditionally (at-least-once guarantee).
			// #15: 60s cadence so offline @mention emails arrive promptly.
			await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
		}
	}

	/**
	 * Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): when the employee has been
	 * offline (last_seen_at older than 90 seconds) AND has unread `chat_mention`
	 * notifications, email them so they don't miss mentions/DMs while the
	 * Workspace tab is closed.
	 *
	 * De-dupe: we only email when there are NEW unread mentions since the last
	 * email we sent. The high-water mark is the count we last notified about,
	 * stored in DO KV (`offline_chat_notified_count`). This keeps the 2-minute
	 * alarm from spamming a fresh email every cycle while the employee stays
	 * away — a follow-up email only fires when the unread-mention count grows.
	 *
	 * Fail-soft: sendOfflineChatNotification never throws; any read/email error
	 * is swallowed by the alarm's wrapping try/catch.
	 */
	private async maybeSendOfflineChatEmail(): Promise<void> {
		const profileRow = [
			...this.ctx.storage.sql.exec(
				`SELECT email, last_seen_at FROM profile WHERE id = 1`,
			),
		][0] as { email: string; last_seen_at: string | null } | undefined;
		if (!profileRow) return;

		const lastSeen = profileRow.last_seen_at
			? new Date(`${profileRow.last_seen_at}Z`)
			: null;
		// No last_seen_at yet → employee never touched the WS-era request path;
		// treat as "not offline" to avoid false-positive emails on first deploy.
		if (!lastSeen) return;
		// #15: "offline" threshold tightened from 5min → 90s so a mention emails
		// soon after the tab is closed, instead of forcing a 5-7min wait. Active
		// employees still see mentions instantly in-app via the WebSocket, so the
		// only people this emails are genuinely away from the Workspace.
		const offlineCutoff = new Date(Date.now() - 90 * 1000);
		if (lastSeen >= offlineCutoff) return; // still active — no email

		const unreadRow = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) AS cnt FROM notifications
				 WHERE event_type = 'chat_mention' AND read = 0`,
			),
		][0] as { cnt: number } | undefined;
		const unreadCount = unreadRow?.cnt ?? 0;
		if (unreadCount === 0) return;

		// Only email when the unread count has GROWN since our last notification,
		// so a stationary backlog doesn't re-email every 2 minutes.
		const lastNotified =
			(await this.ctx.storage.get<number>("offline_chat_notified_count")) ?? 0;
		if (unreadCount <= lastNotified) return;

		const result = await sendOfflineChatNotification(
			this.env,
			profileRow.email,
			unreadCount,
		);
		if (result.ok) {
			await this.ctx.storage.put("offline_chat_notified_count", unreadCount);
		}
	}

	private async pollMattermostNewPosts() {
		const botToken = this.env.MATTERMOST_BOT_TOKEN;
		const mattermostUrl = this.env.MATTERMOST_URL;
		if (!botToken) {
			// Not configured — skip silently
			return;
		}

		const profile = await this.getProfile();
		if (!profile) return;

		// Resolve or retrieve cached MM user_id + username.
		//
		// Phase 31 gap-fix (#18): we now also resolve and cache the employee's MM
		// `username`, because mention detection below matches the @username that
		// Mattermost autocomplete actually inserts — not the human display name.
		// getMmUserByEmail returns both id and username in one call, so we use it
		// in place of resolveMmUserId (which returns the id only).
		let mmUserId = await this.ctx.storage.get<string>("mm_user_id");
		let mmUsername = await this.ctx.storage.get<string>("mm_username");
		if (!mmUserId || (mmUserId !== MM_USER_ID_NONE && !mmUsername)) {
			const user = await getMmUserByEmail(
				mattermostUrl,
				botToken,
				profile.email,
			);
			if (!user?.id) {
				// Employee hasn't logged into Mattermost yet — retry next cycle
				await this.ctx.storage.put("mm_user_id", MM_USER_ID_NONE);
				return;
			}
			mmUserId = user.id;
			mmUsername = user.username ?? undefined;
			await this.ctx.storage.put("mm_user_id", mmUserId);
			if (mmUsername) await this.ctx.storage.put("mm_username", mmUsername);
		}
		if (mmUserId === MM_USER_ID_NONE) {
			// Retry resolution on each alarm — employee may have logged in since
			const user = await getMmUserByEmail(
				mattermostUrl,
				botToken,
				profile.email,
			);
			if (!user?.id) return;
			mmUserId = user.id;
			mmUsername = user.username ?? undefined;
			await this.ctx.storage.put("mm_user_id", mmUserId);
			if (mmUsername) await this.ctx.storage.put("mm_username", mmUsername);
		}

		const lastPollMs =
			(await this.ctx.storage.get<number>("last_mm_poll_at")) ??
			Date.now() - 2 * 60 * 1000;

		// Get channels this employee belongs to
		const channelIds = await getMmChannelsForUser(
			mattermostUrl,
			botToken,
			mmUserId,
		);
		if (channelIds.length === 0) return;

		const nowMs = Date.now();

		for (const channelId of channelIds) {
			const posts = await getMmPostsSince(
				mattermostUrl,
				botToken,
				channelId,
				lastPollMs,
			);
			if (posts.length === 0) continue;

			// Phase 13 Wave 1 / Phase 31 gap-fix (#18): @mention push + offline
			// email. For every post in this batch that @mentions the employee,
			// enqueue a push (which also writes the read=0 `chat_mention`
			// notification row that maybeSendOfflineChatEmail() keys off).
			//
			// We match BOTH the MM @username (what autocomplete inserts, e.g.
			// "@john.doe") AND the @displayName (manual "@John Doe"), with
			// word-boundary safety so "@john" never matches "@johnny". The
			// username is the primary fix for #18 — the original detector only
			// matched displayName and missed every real autocomplete mention.
			//
			// DM-offline LIMITATION (#18 follow-up): this poll only covers
			// CHANNEL posts the bot can see. The bot token cannot enumerate or
			// read the employee's direct-message ("D"/"G") channels, so an
			// offline DM-only mention is NOT detected here and produces no email.
			// Closing that gap needs a per-employee PAT-based poll (the Wave 0
			// identity) and is deliberately out of scope for this fix — see the
			// scope note in the #18 gap report.
			// Resolve the channel/DM label once per channel (only when a mention
			// is actually found, to avoid an extra fetch on every quiet channel).
			let channelLabel: string | null = null;
			for (const post of posts) {
				if (matchesMention(post.message, [mmUsername, profile.displayName])) {
					if (channelLabel === null) {
						const ch = await getMmChannel(mattermostUrl, botToken, channelId);
						channelLabel = ch ? mmChannelLabel(ch) : "";
					}
					void this.sendPushToSubscriptions({
						// Phase 31 gap-fix: name the channel/DM in the title so the user
						// knows where the mention happened, e.g. "Mention in #general".
						title: channelLabel
							? `Mention in Chat (${channelLabel})`
							: "Mention in Chat",
						body: post.message.slice(0, 100),
						// Phase 31 gap-fix: deep-link to the exact channel + message so
						// clicking the notification opens that channel and flashes the post.
						url: `/chat?channel=${channelId}&post=${post.id}`,
						event_type: "chat_mention",
					});
				}
			}

			const batchText = posts
				.map((p) => p.message)
				.filter(Boolean)
				.join("\n---\n")
				.slice(0, 8000);

			await this.extractTodosFromChat(
				batchText,
				posts,
				profile.employeeId,
				channelId,
			);
		}

		// Advance watermark only on success
		await this.ctx.storage.put("last_mm_poll_at", nowMs);
	}

	private async extractTodosFromChat(
		batchText: string,
		posts: Array<{ id: string; message: string }>,
		employeeId: string,
		channelId?: string,
	) {
		try {
			// Phase 14 Wave 2: pre-extraction context from graph (fail-soft).
			// Same idempotent schema-bootstrap pattern as the email path.
			void ensureParrotGraphSchema(this.env);
			const contextBlock = await getEmployeeContext(this.env, employeeId);

			// cacheTtl=1800 (30min) — chat posts are idempotent but refresh faster than email.
			const extracted = await extractTodosFromText(
				batchText,
				employeeId,
				1800,
				this.env,
				contextBlock || undefined,
			);
			if (extracted === null || extracted.length === 0) {
				if (extracted === null) {
					// 429 quota exceeded — log audit event (best-effort)
					try {
						this.ctx.storage.sql.exec(
							`INSERT OR IGNORE INTO audit_events (id, employee_id, event_type, created_at)
							 VALUES (?, ?, 'ai_gateway_quota_exceeded', datetime('now'))`,
							crypto.randomUUID(),
							employeeId,
						);
					} catch {
						/* audit_events table may not exist yet */
					}
				}
				return;
			}
			// Associate extracted todos with the first post in the batch as source_id.
			// This matches the source_id stored in the todos SQLite table so the
			// graph :Todo node id (sha256(employeeId|sourceId)) lines up with the
			// SQLite (source_channel, source_id) unique-index key. Falls back to
			// "unknown" if posts[] is empty for some reason (shouldn't happen —
			// the alarm only calls this method when posts.length > 0).
			const sourceId = posts[0]?.id ?? "unknown";
			this.insertTodos(
				extracted.map((t) => ({
					...t,
					source_channel: "chat",
					source_id: sourceId,
					employee_id: employeeId,
					// Deep-link to the channel + first message of the batch when we
					// know the channel; otherwise the notification falls back to /dashboard.
					source_url: channelId
						? `/chat?channel=${channelId}&post=${sourceId}`
						: undefined,
				})),
			);

			// Phase 14 Wave 2: persist todos to graph (fire-and-forget, never blocks).
			for (const t of extracted) {
				void recordTodoFact(this.env, {
					employeeId,
					sourceChannel: "chat",
					sourceId,
					title: t.title,
					preview: t.preview,
					urgencyScore: t.urgency_score,
					deadlineAt: t.deadline_at ?? null,
					mentionedActors: t.mentioned_actors ?? [],
					isMention: t.is_mention,
					blockedByIds: t.blocked_by_ids ?? [],
				});
			}
		} catch (err) {
			console.error("extractTodosFromChat failed", err);
		}
	}

	// ── Push subscriptions + notifications (Phase 13 Wave 1) ───────

	/**
	 * Register (or replace) a Web Push subscription for the current
	 * employee. Called from `POST /api/push/subscribe` after the
	 * browser hands us a PushSubscription via PushManager.subscribe().
	 */
	async addPushSubscription(
		endpoint: string,
		p256dh: string,
		auth: string,
	): Promise<void> {
		const profile = await this.getProfile();
		if (!profile) {
			throw new Error("addPushSubscription: no profile row — call /api/me first");
		}
		this.ctx.storage.sql.exec(
			`INSERT INTO push_subscriptions (endpoint, employee_id, p256dh, auth, created_at)
			 VALUES (?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(endpoint) DO UPDATE SET
			   employee_id = excluded.employee_id,
			   p256dh = excluded.p256dh,
			   auth = excluded.auth,
			   created_at = excluded.created_at`,
			endpoint,
			profile.employeeId,
			p256dh,
			auth,
		);
	}

	async removePushSubscription(endpoint: string): Promise<void> {
		this.ctx.storage.sql.exec(
			`DELETE FROM push_subscriptions WHERE endpoint = ?`,
			endpoint,
		);
	}

	async getPushSubscriptions(): Promise<
		Array<{ endpoint: string; p256dh: string; auth: string }>
	> {
		const profile = await this.getProfile();
		if (!profile) return [];
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE employee_id = ?`,
				profile.employeeId,
			),
		] as Array<{ endpoint: string; p256dh: string; auth: string }>;
		return rows;
	}

	async addNotification(input: {
		event_type:
			| "urgent_todo"
			| "starred_email"
			| "chat_mention"
			| "meeting_started";
		title: string;
		body?: string;
		url?: string;
	}): Promise<void> {
		const profile = await this.getProfile();
		if (!profile) return;
		// Phase 31 gap-fix: chat mentions/DMs can be created from TWO sources —
		// the live WS path (client POST /api/chat/notify, instant) and the 60s
		// background poll. Both stamp the same `/chat?channel=…&post=…` url, so
		// dedupe on (employee_id, url) to avoid a duplicate drawer row.
		if (input.event_type === "chat_mention" && input.url) {
			const existing = [
				...this.ctx.storage.sql.exec(
					`SELECT 1 FROM notifications
					 WHERE employee_id = ? AND url = ? LIMIT 1`,
					profile.employeeId,
					input.url,
				),
			];
			if (existing.length > 0) return;
		}
		const id = crypto.randomUUID();
		this.ctx.storage.sql.exec(
			`INSERT INTO notifications (id, employee_id, event_type, title, body, url, read, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
			id,
			profile.employeeId,
			input.event_type,
			input.title,
			input.body ?? null,
			input.url ?? null,
		);
	}

	async getNotifications(limit?: number): Promise<
		Array<{
			id: string;
			event_type: string;
			title: string;
			body: string | null;
			url: string | null;
			read: number;
			created_at: string;
		}>
	> {
		const profile = await this.getProfile();
		if (!profile) return [];
		const lim = Math.min(Math.max(limit ?? 20, 1), 200);
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT id, event_type, title, body, url, read, created_at
				 FROM notifications
				 WHERE employee_id = ?
				 ORDER BY created_at DESC
				 LIMIT ?`,
				profile.employeeId,
				lim,
			),
		] as Array<{
			id: string;
			event_type: string;
			title: string;
			body: string | null;
			url: string | null;
			read: number;
			created_at: string;
		}>;
		return rows;
	}

	async markNotificationsRead(ids?: string[]): Promise<void> {
		const profile = await this.getProfile();
		if (!profile) return;
		if (ids && ids.length > 0) {
			// Build a parameterized IN (?, ?, …) clause.
			const placeholders = ids.map(() => "?").join(",");
			this.ctx.storage.sql.exec(
				`UPDATE notifications SET read = 1
				 WHERE employee_id = ? AND id IN (${placeholders})`,
				profile.employeeId,
				...ids,
			);
		} else {
			this.ctx.storage.sql.exec(
				`UPDATE notifications SET read = 1
				 WHERE employee_id = ? AND read = 0`,
				profile.employeeId,
			);
		}
	}

	/**
	 * Phase 31 gap-fix: permanently DELETE notifications (the drawer's "Clear
	 * all" and per-row dismiss). With `ids` deletes just those; without, clears
	 * the employee's entire notification history.
	 */
	async clearNotifications(ids?: string[]): Promise<void> {
		const profile = await this.getProfile();
		if (!profile) return;
		if (ids && ids.length > 0) {
			const placeholders = ids.map(() => "?").join(",");
			this.ctx.storage.sql.exec(
				`DELETE FROM notifications
				 WHERE employee_id = ? AND id IN (${placeholders})`,
				profile.employeeId,
				...ids,
			);
		} else {
			this.ctx.storage.sql.exec(
				`DELETE FROM notifications WHERE employee_id = ?`,
				profile.employeeId,
			);
		}
	}

	// — Phase 13 Wave 2: cross-pane actions ——————————————————————
	//
	// Skills referenced:
	//   cloudflare/skills: agents-sdk

	/**
	 * Move an email thread into a Mattermost channel:
	 * 1. Look up the email row in this DO's `emails` table.
	 * 2. Create a Mattermost private channel via bot REST API on the first
	 *    team the bot can see.
	 * 3. Seed the channel with the email body as the first post.
	 *
	 * Gracefully degrades when MATTERMOST_BOT_TOKEN / MATTERMOST_URL are
	 * unset or any HTTP call fails — returns { ok: false, error } rather
	 * than throwing, so callers (and the dev smoke endpoint) can assert
	 * graceful-failure semantics without needing live Mattermost.
	 */
	async emailToChat(emailId: string): Promise<{
		ok: boolean;
		channel_url?: string;
		channel_id?: string;
		error?: string;
	}> {
		// 1. Fetch the email row.
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT id, subject, sender, recipient, body
				 FROM emails WHERE id = ?`,
				emailId,
			),
		] as Array<{
			id: string;
			subject: string | null;
			sender: string | null;
			recipient: string | null;
			body: string | null;
		}>;
		if (rows.length === 0) {
			return { ok: false, error: "email_not_found" };
		}
		const email = rows[0];

		const mattermostUrl = this.env.MATTERMOST_URL;
		const botToken = this.env.MATTERMOST_BOT_TOKEN;
		if (!mattermostUrl || !botToken) {
			return { ok: false, error: "mattermost_unavailable" };
		}

		// 4. Slugify channel name.
		const rawSubject = (email.subject ?? "").trim();
		const slug = (
			rawSubject
				? rawSubject
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-+|-+$/g, "")
				: `email-${emailId.slice(0, 8)}`
		).slice(0, 60) || `email-${emailId.slice(0, 8)}`;
		const displayName = rawSubject || `Email ${emailId.slice(0, 8)}`;

		try {
			// 5a. Resolve a team for the bot.
			const teamsResp = await fetch(`${mattermostUrl}/api/v4/teams`, {
				headers: { Authorization: `Bearer ${botToken}` },
			});
			if (!teamsResp.ok) return { ok: false, error: "mattermost_unavailable" };
			const teams = (await teamsResp.json()) as Array<{
				id: string;
				name: string;
			}>;
			if (!Array.isArray(teams) || teams.length === 0) {
				return { ok: false, error: "mattermost_no_team" };
			}
			const teamId = teams[0].id;
			const teamName = teams[0].name;

			// 5b. Create channel (private = type 'P').
			const channelResp = await fetch(
				`${mattermostUrl}/api/v4/channels`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${botToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						team_id: teamId,
						type: "P",
						display_name: displayName,
						name: slug,
					}),
				},
			);
			if (!channelResp.ok) {
				return { ok: false, error: "mattermost_channel_create_failed" };
			}
			const channel = (await channelResp.json()) as {
				id: string;
				name: string;
			};

			// 6. Post seed message with email body.
			const seedBody = (email.body ?? "").slice(0, 2000);
			const seedMessage = `**Email from ${email.sender ?? "(unknown sender)"}**\n\n${seedBody}`;
			await fetch(`${mattermostUrl}/api/v4/posts`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel_id: channel.id,
					message: seedMessage,
				}),
			});

			// 7. Return success with channel URL.
			return {
				ok: true,
				channel_id: channel.id,
				channel_url: `${mattermostUrl}/${teamName}/channels/${channel.name}`,
			};
		} catch {
			return { ok: false, error: "mattermost_error" };
		}
	}

	/**
	 * Build an email draft from a Mattermost chat post. The full
	 * composer modal lives on the client — this method only returns a
	 * draft shape (to/subject/body) the UI can pre-fill.
	 *
	 * Subject heuristic: first 60 chars of the post body, newlines
	 * collapsed to spaces, ellipsis if truncated. Body: every line
	 * prefixed with `> ` (markdown quote) + trailing blank line for
	 * the reply.
	 *
	 * No LLM call here — this is intentionally deterministic. If we
	 * want AI summarization later, route through callAiGateway() from
	 * Phase 12.
	 */
	async chatToEmail(
		postId: string,
		postBody: string,
	): Promise<{
		ok: boolean;
		draft?: { to: string; subject: string; body: string };
		error?: string;
	}> {
		// Touch postId so it's recorded in flow context (not used in draft
		// assembly itself; reserved for future thread-link references).
		void postId;
		const profile = await this.getProfile();
		if (!profile) {
			return { ok: false, error: "profile_not_found" };
		}

		const firstChunk = postBody.slice(0, 60).replace(/\n/g, " ").trim();
		const truncated = postBody.length > 60;
		const subject = `From chat: ${firstChunk}${truncated ? "…" : ""}`;
		const body = `> ${postBody.split("\n").join("\n> ")}\n\n`;

		return {
			ok: true,
			draft: {
				to: "",
				subject,
				body,
			},
		};
	}

	/**
	 * Fan-out push notifications to every subscription for this employee.
	 * Always stores a notifications row first (drawer-visible regardless of
	 * push delivery). Each push attempt is wrapped in try/catch — a 410
	 * Gone response triggers `removePushSubscription()` so dead endpoints
	 * don't accumulate.
	 *
	 * If `PUSH_VAPID_PRIVATE_KEY` / `PUSH_VAPID_PUBLIC_KEY` are not
	 * configured, we still store the notification row (drawer continues
	 * to work) and log a single warning — we DO NOT crash.
	 */
	async sendPushToSubscriptions(payload: {
		title: string;
		body?: string;
		url?: string;
		event_type: "urgent_todo" | "starred_email" | "chat_mention";
	}): Promise<void> {
		// 1. Always record the notification row (drawer reads this).
		try {
			await this.addNotification({
				event_type: payload.event_type,
				title: payload.title,
				body: payload.body,
				url: payload.url,
			});
		} catch (err) {
			console.error("sendPushToSubscriptions: addNotification failed", err);
			// Continue — try to push even if drawer-row insert failed.
		}

		// 2. If VAPID isn't configured, skip the actual push.
		const privateKeyPem = this.env.PUSH_VAPID_PRIVATE_KEY;
		const publicKey = this.env.PUSH_VAPID_PUBLIC_KEY;
		if (!privateKeyPem || !publicKey) {
			console.warn(
				"sendPushToSubscriptions: VAPID keys not configured — skipping push fan-out (notification row saved)",
			);
			return;
		}

		const subs = await this.getPushSubscriptions();
		if (subs.length === 0) return;

		const body = JSON.stringify({
			title: payload.title,
			body: payload.body ?? "",
			url: payload.url ?? "/",
			event_type: payload.event_type,
		});

		// 3. Fan out — fire-and-forget per endpoint. Don't await sequentially.
		await Promise.all(
			subs.map(async (sub) => {
				try {
					const authHeader = await buildVapidAuthHeader({
						endpoint: sub.endpoint,
						publicKey,
						privateKeyPem,
					});
					const res = await fetch(sub.endpoint, {
						method: "POST",
						headers: {
							Authorization: authHeader,
							"Content-Type": "application/json",
							TTL: "60",
						},
						body,
					});
					if (res.status === 410 || res.status === 404) {
						// Subscription is dead — prune it.
						await this.removePushSubscription(sub.endpoint);
					} else if (!res.ok) {
						console.warn(
							`push send to ${sub.endpoint} returned ${res.status}`,
						);
					}
				} catch (err) {
					console.error("push send failed", sub.endpoint, err);
				}
			}),
		);
	}

	/**
	 * Phase 11 Wave 1: lazily provision the employee's personal Daily.co
	 * room. Idempotent — if `profile.personal_room_url` is already set we
	 * return it without hitting Daily.co.
	 *
	 * Fail-soft: when `DAILY_API_KEY` is absent (or Daily.co errors), we
	 * return `{ ok: false, error: 'room_provisioning_unavailable' }` so the
	 * route handler can return a 503 and the UI can degrade to the Phase 13
	 * "Daily.co not configured" toast. NEVER throws.
	 *
	 * Room name derivation: `parrot-<employee_id>` where employee_id is the
	 * Clerk user ID (already URL-safe — Clerk emits `user_<base64-ish>`).
	 * Keeping it short + deterministic means we can derive the URL from the
	 * employee ID alone in places where we don't have the DO handy.
	 *
	 * Skills referenced:
	 *   cloudflare/skills: durable-objects — single-writer guarantees so the
	 *     "check existing → create → persist" trio is race-free per employee.
	 */
	async ensurePersonalRoom(
		apiKey: string | undefined,
	): Promise<
		| { ok: true; url: string; name: string }
		| { ok: false; error: string }
	> {
		// 1. Idempotency probe — return immediately if we already have a room.
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT employee_id, personal_room_name, personal_room_url
				 FROM profile WHERE id = 1`,
			),
		] as Array<{
			employee_id: string;
			personal_room_name: string | null;
			personal_room_url: string | null;
		}>;
		if (rows.length === 0) {
			// No profile row yet — onboarding hasn't run. Caller (the route)
			// should have ensured upsertProfile() ran first.
			return { ok: false, error: "profile_missing" };
		}
		const row = rows[0];
		if (row.personal_room_url && row.personal_room_name) {
			return {
				ok: true,
				url: row.personal_room_url,
				name: row.personal_room_name,
			};
		}

		// 2. Derive the deterministic room name from the Clerk user ID.
		const roomName = `parrot-${row.employee_id}`;

		// 3. Provision via Daily.co. Personal rooms are always-on (no exp).
		const room = await createRoom(apiKey, roomName);
		if (!room) {
			// Key absent OR Daily.co error — already logged inside daily.ts.
			return { ok: false, error: "room_provisioning_unavailable" };
		}

		// 4. Persist to profile (id = 1 is the per-DO singleton row).
		this.ctx.storage.sql.exec(
			`UPDATE profile
			   SET personal_room_name = ?,
			       personal_room_url = ?,
			       updated_at = datetime('now')
			 WHERE id = 1`,
			roomName,
			room.url,
		);

		return { ok: true, url: room.url, name: roomName };
	}

	/**
	 * Phase 11 Wave 2: read-only accessor for the employee's personal
	 * Daily.co room. Unlike ensurePersonalRoom(), this NEVER calls
	 * Daily.co — it only reads what we've already persisted. If the room
	 * has not been provisioned yet, returns null.
	 *
	 * The Meetings pane uses this to render the room embed without
	 * accidentally provisioning on every page load (callers MUST POST
	 * /api/meetings/ensure-room first to provision lazily).
	 *
	 * Skills referenced:
	 *   cloudflare/skills: durable-objects — per-employee room read.
	 */
	async getPersonalRoom(): Promise<{ url: string; name: string } | null> {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT personal_room_name, personal_room_url
				 FROM profile WHERE id = 1`,
			),
		] as Array<{
			personal_room_name: string | null;
			personal_room_url: string | null;
		}>;
		if (rows.length === 0) return null;
		const row = rows[0];
		if (!row.personal_room_url || !row.personal_room_name) return null;
		return { url: row.personal_room_url, name: row.personal_room_name };
	}

	/**
	 * Phase 11 Wave 3: ephemeral Daily.co room for ad-hoc "Start Meeting" CTA.
	 *
	 * Unlike `ensurePersonalRoom()` (which provisions ONE always-on room per
	 * employee), this creates a SHORT-LIVED room each time it is called:
	 *   - Name: `parrot-meet-<uuid8>` (random, non-deterministic).
	 *   - Expiry: now + 3600 seconds (Daily.co auto-deletes after 1 hour).
	 *
	 * On success, writes a `meeting_started` notification row (audit trail +
	 * notification drawer entry) and returns the room URL. The caller (the
	 * /api/crosspane/start-meeting route handler) opens the URL in a new tab.
	 *
	 * Fail-soft contract: when `apiKey` is undefined OR Daily.co rejects the
	 * call, falls back to the Phase 13 behavior — writes an `urgent_todo`
	 * notification ("Meeting requested") so pilot demand is still captured —
	 * and returns `{ ok: false, reason: 'meetings_coming_soon' }`. The UI
	 * shows the existing Phase 13 toast. ZERO regression from the seam-only
	 * path.
	 *
	 * Skills referenced:
	 *   cloudflare/skills: durable-objects — per-employee room + notification
	 *     under the DO's single-writer guarantee.
	 *   cloudflare/skills: cloudflare — Workers fetch() via daily.ts helper.
	 */
	async startEphemeralMeeting(
		apiKey: string | undefined,
	): Promise<
		| { ok: true; url: string; name: string }
		| { ok: false; reason: string; message: string }
	> {
		// 1. Derive a fresh ephemeral room name. The 8-char uuid slice keeps
		//    it short + obvious in logs while still effectively unique
		//    (32 bits of entropy is plenty for 1-hour rooms — collisions
		//    are detectable via Daily.co's 409 response and would only
		//    trigger the fail-soft path).
		const roomName = `parrot-meet-${crypto.randomUUID().slice(0, 8)}`;

		// 2. 1-hour expiry from now. Daily.co accepts a Unix-seconds value.
		const exp = Math.floor(Date.now() / 1000) + 3600;

		// 3. Create the room. createRoom returns null on missing key OR
		//    any Daily.co error (already logged inside daily.ts).
		const room = await createRoom(apiKey, roomName, { exp });

		if (!room) {
			// Fallback: preserve Phase 13 behavior. Record demand via the
			// existing `urgent_todo` notification (the audit row is the
			// pilot-demand signal — see PILOT-RUNBOOK §7).
			await this.addNotification({
				event_type: "urgent_todo",
				title: "Meeting requested",
				body: "Employee clicked Start Meeting — Daily.co room provisioning unavailable.",
				url: "/meetings",
			});
			return {
				ok: false,
				reason: "meetings_coming_soon",
				message:
					"Meetings coming soon — Daily.co integration is on the roadmap.",
			};
		}

		// 4. Real-room path: record the meeting_started notification so the
		//    employee's drawer reflects the event + we have an audit trail
		//    of every ephemeral room they spawned.
		await this.addNotification({
			event_type: "meeting_started",
			title: "Meeting started",
			body: roomName,
			url: room.url,
		});

		return { ok: true, url: room.url, name: roomName };
	}
}
