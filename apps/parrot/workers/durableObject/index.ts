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
	getMmChannelsForUser,
	getMmPostsSince,
	MM_USER_ID_NONE,
} from "../lib/mattermost";

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
				`SELECT employee_id, email, display_name, created_at FROM profile WHERE id = 1`,
			),
		][0] as
			| {
					employee_id: string;
					email: string;
					display_name: string;
					created_at: string;
			  }
			| undefined;
		if (!row) return null;
		return {
			employeeId: row.employee_id,
			email: row.email,
			displayName: row.display_name,
			createdAt: row.created_at,
		};
	}

	// ── Email list / get (Drizzle) ─────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			thread_id,
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

	async countEmails(options: { folder?: string; thread_id?: string } = {}) {
		const { folder, thread_id } = options;
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
		}>,
	) {
		for (const todo of todos) {
			const id = crypto.randomUUID();
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

	private async extractTodosFromEmail(email: EmailData, employeeId: string) {
		try {
			const text = [email.subject, email.body].filter(Boolean).join("\n\n");
			const extracted = await extractTodosFromText(
				text,
				employeeId,
				3600,
				this.env,
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
				})),
			);
		} catch (err) {
			console.error("extractTodosFromEmail failed", err);
			// Fail-soft: never block email storage
		}
	}

	// ── DO Alarm — Mattermost polling ──────────────────────────────

	/**
	 * Register the 2-minute polling alarm if not already set.
	 * Called from upsertProfile() so the alarm starts on first employee login.
	 */
	async initAlarm() {
		const existing = await this.ctx.storage.getAlarm();
		if (!existing) {
			await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
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
		} finally {
			// Always reschedule unconditionally (at-least-once guarantee)
			await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
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

		// Resolve or retrieve cached MM user_id
		let mmUserId = await this.ctx.storage.get<string>("mm_user_id");
		if (!mmUserId) {
			const resolved = await resolveMmUserId(
				mattermostUrl,
				botToken,
				profile.email,
			);
			if (!resolved) {
				// Employee hasn't logged into Mattermost yet — retry next cycle
				await this.ctx.storage.put("mm_user_id", MM_USER_ID_NONE);
				return;
			}
			mmUserId = resolved;
			await this.ctx.storage.put("mm_user_id", mmUserId);
		}
		if (mmUserId === MM_USER_ID_NONE) {
			// Retry resolution on each alarm — employee may have logged in since
			const resolved = await resolveMmUserId(
				mattermostUrl,
				botToken,
				profile.email,
			);
			if (!resolved) return;
			mmUserId = resolved;
			await this.ctx.storage.put("mm_user_id", mmUserId);
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

			const batchText = posts
				.map((p) => p.message)
				.filter(Boolean)
				.join("\n---\n")
				.slice(0, 8000);

			await this.extractTodosFromChat(batchText, posts, profile.employeeId);
		}

		// Advance watermark only on success
		await this.ctx.storage.put("last_mm_poll_at", nowMs);
	}

	private async extractTodosFromChat(
		batchText: string,
		posts: Array<{ id: string; message: string }>,
		employeeId: string,
	) {
		try {
			// cacheTtl=1800 (30min) — chat posts are idempotent but refresh faster than email.
			const extracted = await extractTodosFromText(
				batchText,
				employeeId,
				1800,
				this.env,
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
			const sourceId = posts[0]?.id ?? "batch";
			this.insertTodos(
				extracted.map((t) => ({
					...t,
					source_channel: "chat",
					source_id: sourceId,
					employee_id: employeeId,
				})),
			);
		} catch (err) {
			console.error("extractTodosFromChat failed", err);
		}
	}
}
