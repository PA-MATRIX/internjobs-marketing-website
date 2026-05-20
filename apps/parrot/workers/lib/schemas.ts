// v1.3.1 BACKFILL: Lifted from apps/agentic-inbox/workers/lib/schemas.ts.
//
// Adaptations for Parrot:
//   - The schemas themselves are pure data; no identity fields needed.
//     Parrot's multi-mailbox model is enforced at the Hono middleware
//     layer (requireEmployeeMailbox) — the DO stub is already keyed to
//     the authenticated employee, so the schemas don't need to carry
//     employee_id in the request body. The Worker route reads it from
//     c.var.employee.
//   - The "from" field is still accepted in the schema for symmetry with
//     agentic-inbox's surface, but the route handler ignores any client-
//     provided value and always overrides with employee.email — this
//     prevents a logged-in employee from spoofing the From address of
//     a different employee's mailbox.
//   - EmailFull / EmailMetadata are re-exported so the lifted reply/forward
//     handler can type-narrow the DO stub's getEmail() response without
//     importing from agentic-inbox.
//
// Source of truth: this file does NOT modify apps/agentic-inbox/.

import { z } from "zod";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

/**
 * Reply / forward request body. The `from` field is OPTIONAL in Parrot
 * (defaults to the authenticated employee's email at the route layer);
 * clients can omit it entirely. We accept it for compatibility with the
 * agentic-inbox compose flow but the route handler is the source of truth.
 */
export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z
			.union([
				z.string().email(),
				z.object({ email: z.string().email(), name: z.string() }),
			])
			.optional(),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: z
			.array(
				z.object({
					content: z.string(), // base64 encoded
					filename: z.string(),
					type: z.string(),
					disposition: z.enum(["attachment", "inline"]),
					contentId: z.string().optional(),
				}),
			)
			.optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});

export type SendEmailRequest = z.infer<typeof SendEmailRequestSchema>;
