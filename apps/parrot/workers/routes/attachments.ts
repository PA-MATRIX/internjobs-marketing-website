// v1.4 Phase 23-03 ATTACH-DOWN-01..03: Attachment download route.
//
// GET /api/inbox/messages/:messageId/attachments/:attachmentId
//
// Returns the R2 blob with correct Content-Type + Content-Disposition.
// Auth: Clerk session (handled by requireEmployeeMailbox middleware in index.ts).
// Ownership: The route verifies that the :messageId belongs to the authenticated
//   employee's mailbox before fetching from R2. Non-owner → 403. Missing → 404.
//
// R2 key convention (source of truth: apps/parrot/workers/lib/inbound-email.ts:155):
//   attachments/{clerk_user_id}/{messageId}/{attachmentId}/{filename}
//
// At inbound time, `inbound-email.ts` resolves the recipient via
// WorkspaceDO.getEmployeeByWorkspaceEmail() and writes the R2 key using
// `employee.clerk_user_id` (the snake_case field on EmployeeLookupRow). In the
// Clerk-authenticated context here, the same identifier is exposed on the
// `Employee` type as `employeeId` (camelCase) — mailbox.ts comments confirm
// `employeeId === stable Clerk user ID`. Both resolve to the same string at
// runtime. We read snake_case via an unknown-cast as defensive plumbing, and
// fall back to `employeeId` (canonical) so the lookup is robust regardless of
// which shape the upstream auth populated.
//
// ATTACH-DOWN-02: Non-owner → 403. If a different employee's signed-in session
// asks for a messageId that lives in another DO, their own DO simply won't
// return that row from getEmail() (DOs are per-Clerk-user) — we 403 rather
// than 404 to avoid leaking message existence via timing.
//
// Skills: cloudflare Workers + R2 + Durable Objects.

import type { Context } from "hono";
import type { ParrotContext } from "../lib/mailbox";

type AppContext = Context<ParrotContext>;

interface AttachmentMeta {
	id: string;
	filename: string;
	mimetype: string;
}

interface EmailWithAttachments {
	id: string;
	attachments?: AttachmentMeta[];
}

/**
 * GET /api/inbox/messages/:messageId/attachments/:attachmentId
 *
 * Returns the R2 blob as a streaming response with correct headers.
 * Requires Clerk session (enforced by requireEmployeeMailbox in index.ts).
 */
export async function handleAttachmentDownload(c: AppContext) {
	const messageId = c.req.param("messageId") ?? "";
	const attachmentId = c.req.param("attachmentId") ?? "";

	if (!messageId || !attachmentId) {
		return c.json({ error: "missing_params" }, 400);
	}

	const employee = c.var.employee;
	const stub = c.var.mailboxStub;

	// ATTACH-DOWN-02: Ownership check. Look up the email through the
	// authenticated employee's own DO. If the message isn't in their mailbox,
	// return 403 (not 404) to avoid leaking existence of messages in other
	// employees' mailboxes via timing.
	let attachmentMeta: AttachmentMeta | null = null;

	try {
		const email = (await stub.getEmail(messageId)) as
			| EmailWithAttachments
			| null;

		if (!email) {
			return c.json({ error: "forbidden" }, 403);
		}

		const att = email.attachments?.find((a) => a.id === attachmentId);
		if (!att) {
			return c.json({ error: "not_found" }, 404);
		}

		attachmentMeta = att;
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "attachment_lookup_failed",
				messageId,
				attachmentId,
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return c.json({ error: "lookup_failed" }, 500);
	}

	// Reconstruct the R2 key. Convention from inbound-email.ts:155 —
	//   attachments/${employee.clerk_user_id}/${messageId}/${attId}/${filename}
	// `clerk_user_id` (snake_case, EmployeeLookupRow shape) and `employeeId`
	// (camelCase, Employee shape) carry the same Clerk user ID at runtime.
	// We accept either, falling back to `email` as a last resort (matches the
	// plan's spec; the email case is defensive — DO routing keys by employeeId
	// so this branch is functionally unreachable in production).
	const employeeWithSnake = employee as unknown as {
		clerk_user_id?: string;
	};
	const userId =
		employeeWithSnake.clerk_user_id ?? employee.employeeId ?? employee.email;

	const filename = attachmentMeta.filename || "download";
	const r2Key = `attachments/${userId}/${messageId}/${attachmentId}/${filename}`;

	const object = await c.env.BUCKET.get(r2Key);
	if (!object) {
		// Metadata existed but the R2 blob is gone (manual delete or lifecycle).
		return c.json({ error: "not_found" }, 404);
	}

	// RFC 6266 Content-Disposition with both filename (legacy) + filename*
	// (UTF-8 encoded for non-ASCII) so Chrome and Safari both render the
	// correct filename in the Save dialog.
	const safeFilename = encodeURIComponent(filename).replace(/%20/g, "+");

	return new Response(object.body, {
		headers: {
			"Content-Type": attachmentMeta.mimetype || "application/octet-stream",
			"Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
			"Cache-Control": "private, max-age=3600",
			"Content-Length": String(object.size),
		},
	});
}
