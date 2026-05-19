// v1.2 Phase 10 Wave 1: identical schema to apps/agentic-inbox/workers/db/schema.ts.
// Parrot stores per-employee email in SQLite-in-DO using the same shape so the
// agentic-inbox MailboxDO patterns (threading, search, drafts) port over.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});

// v1.2 Phase 12 Wave 1: cross-channel todo store.
// Drizzle mirror of migration 3_todos_table. Column names/types match
// the SQL exactly so the agent can write via Drizzle and read via the
// ranking SQL query (which uses raw SQL for the integer-arithmetic
// ORDER BY expression).
export const todos = sqliteTable("todos", {
	id: text("id").primaryKey(),
	employee_id: text("employee_id").notNull(),
	source_channel: text("source_channel").notNull(),
	source_id: text("source_id").notNull(),
	title: text("title").notNull(),
	preview: text("preview"),
	urgency_score: integer("urgency_score").notNull().default(50),
	deadline_at: text("deadline_at"),
	mentioned_actors: text("mentioned_actors"),
	is_mention: integer("is_mention").notNull().default(0),
	created_at: text("created_at"),
	resolved_at: text("resolved_at"),
});
