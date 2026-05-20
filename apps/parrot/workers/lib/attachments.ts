// v1.3.1 BACKFILL: Lifted from apps/agentic-inbox/workers/lib/attachments.ts.
//
// Adaptations for Parrot:
//   - Bucket name binding is the same (env.BUCKET) but points at
//     `internjobs-parrot-attachments` instead of `internjobs-agentic-inbox`
//     per wrangler.jsonc.
//   - Path layout keeps the agentic-inbox convention `attachments/<emailId>/<attachmentId>/<filename>`
//     because the per-employee mailbox DO already enforces isolation
//     (the calling Worker route is gated by Clerk + employeeId → DO stub,
//     so an employee can only ever drive writes into their own email IDs).
//     We deliberately do NOT prefix with employeeId in the R2 key — that
//     would couple the storage layer to identity and complicate future
//     forwarding/archive flows.
//
// Source of truth: this file does NOT modify apps/agentic-inbox/. If the
// upstream attachments helper changes, re-lift manually and update both.

import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

/**
 * Store base64-encoded attachments to R2 and return metadata for the DO.
 *
 * Filename is sanitized to strip path-traversal and control characters
 * before being baked into the R2 key (defence-in-depth — R2 itself
 * tolerates these, but downstream readers + the operator UI shouldn't
 * have to).
 */
export async function storeAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments?: {
		content: string;
		filename: string;
		type: string;
		disposition: string;
		contentId?: string;
	}[],
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];

	const results: StoredAttachment[] = [];
	for (const att of attachments) {
		const attachmentId = crypto.randomUUID();
		// Sanitize filename to prevent path traversal in R2 keys.
		const safeFilename = (att.filename || "untitled").replace(
			/[\/\\:*?"<>|\x00-\x1f]/g,
			"_",
		);
		const key = `attachments/${emailId}/${attachmentId}/${safeFilename}`;
		const binaryStr = atob(att.content);
		const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
		await bucket.put(key, bytes);
		results.push({
			id: attachmentId,
			email_id: emailId,
			filename: safeFilename,
			mimetype: att.type,
			size: bytes.byteLength,
			content_id: att.contentId || null,
			disposition: att.disposition,
		});
	}
	return results;
}
