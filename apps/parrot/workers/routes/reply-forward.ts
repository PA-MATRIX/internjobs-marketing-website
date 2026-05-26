// v1.3.1 BACKFILL: Parrot reply / forward routes.
//
// Previously a 501 stub from v1.2 Phase 10 Wave 1. The "later wave" that
// was supposed to lift the real handler from agentic-inbox never happened,
// so compose/reply/forward in the Parrot Inbox failed in production. This
// commit replaces the stub with the real handler, adapted for Parrot's
// multi-employee data model.
//
// Differences vs apps/agentic-inbox/workers/routes/reply-forward.ts:
//
//   1. URL shape — no :mailboxId path param. The DO is resolved by
//      Clerk-authenticated employee in workers/lib/mailbox.ts middleware,
//      so c.var.employee.email is the source of truth for the From
//      address. Any client-supplied "from" in the request body is
//      ignored to prevent employees from spoofing each other.
//
//   2. Schema — SendEmailRequestSchema.from is OPTIONAL in Parrot
//      (workers/lib/schemas.ts). The route always overrides with the
//      authenticated employee's email + display name.
//
//   3. R2 bucket — env.BUCKET points at internjobs-parrot-attachments
//      instead of internjobs-agentic-inbox. The storeAttachments helper
//      itself is identical; only the binding's underlying bucket differs.
//
//   4. Email transport — env.EMAIL is the Parrot SendEmail binding,
//      configured in apps/parrot/wrangler.jsonc. Identical contract to
//      agentic-inbox so the sendEmail helper lifts cleanly.

import type { Context } from "hono";
import { sendEmail } from "../lib/email-sender";
import { storeAttachments } from "../lib/attachments";
import {
	SendEmailRequestSchema,
	type EmailFull,
} from "../lib/schemas";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
	resolveOriginalEmail,
} from "../lib/email-helpers";
import { closeTodoFact } from "../lib/graph";
import { Folders } from "../../shared/folders";
import type { ParrotContext } from "../lib/mailbox";

type AppContext = Context<ParrotContext>;

// CLOSETODO-02: Resolution-acknowledgement phrases.
// Phrases: got it / fixed / done / sent / shipped (case-insensitive).
// Regex is intentionally loose — false positives ("I've done this") are
// acceptable; false negatives (missing a resolved todo) are not.
const ACK_PATTERN = /\b(got\s+it|fixed|done|sent|shipped)\b/i;

/**
 * POST /api/inbox/messages/:id/reply
 *
 * Writes a new message into the Sent folder with proper RFC 2822 threading
 * headers (In-Reply-To + References), schedules outbound delivery via the
 * Cloudflare SendEmail binding, and marks the original thread read.
 *
 * The 'from' address is ALWAYS the authenticated employee's email; any
 * client-supplied value is ignored.
 */
export async function handleReplyEmail(c: AppContext) {
	const id = c.req.param("id") ?? "";
	const employee = c.var.employee;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId } =
		buildReferencesChain(originalEmail);

	// Always use the authenticated employee's identity for outbound mail.
	// Display name comes from the Clerk profile (see workers/app.ts auth).
	const from = {
		email: employee.email,
		name: employee.displayName || employee.email,
	};

	let toStr: string;
	let fromEmail: string;
	let fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(
			to,
			from,
			employee.email,
		));
	} catch (e) {
		if (e instanceof SenderValidationError) {
			return c.json({ error: e.message }, 400);
		}
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const attachmentData = await storeAttachments(
		c.env.BUCKET,
		messageId,
		attachments,
	);

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
			in_reply_to: originalMsgId,
			email_references: JSON.stringify(references),
			thread_id: threadId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{
					key: "from",
					value: `${from.name} <${from.email}>`,
				},
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc
					? [
							{
								key: "cc",
								value: Array.isArray(cc) ? cc.join(", ") : cc,
							},
						]
					: []),
				...(bcc
					? [
							{
								key: "bcc",
								value: Array.isArray(bcc) ? bcc.join(", ") : bcc,
							},
						]
					: []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
				...(originalMsgId
					? [{ key: "in-reply-to", value: `<${originalMsgId}>` }]
					: []),
				...(references.length > 0
					? [
							{
								key: "references",
								value: references.map((r) => `<${r}>`).join(" "),
							},
						]
					: []),
			]),
		},
		attachmentData,
	);

	await stub.markThreadRead(threadId);

	// CLOSETODO-02: If this reply contains a resolution-acknowledgement phrase,
	// close the linked :Todo in FalkorDB so the auto-clear cron can pick it up.
	// IMPORTANT: Use `id` from c.req.param("id") — that is the original email's
	// DO-internal UUID (set at inbound time via crypto.randomUUID()), which is
	// what recordTodoFact stored as :Todo.source_id. Do NOT use the RFC-5322
	// `threadId` from buildReferencesChain: that is a Message-ID header string
	// (e.g. <abc@mail.gmail.com>) and will match zero :Todo nodes in FalkorDB.
	const replyBodyText = (html || text || "").replace(/<[^>]+>/g, " ");
	const matchedPhrase = replyBodyText.match(ACK_PATTERN)?.[0] ?? null;
	if (matchedPhrase && id) {
		// Fire-and-forget via waitUntil — graph write must not block the
		// reply response. Fail-soft: if closeTodoFact returns null, the
		// reply still goes through.
		c.executionCtx.waitUntil(
			closeTodoFact(c.env, {
				threadId: id,
				employeeId: employee.employeeId ?? employee.email,
				resolutionText: matchedPhrase,
			}),
		);
	}

	// Deferred outbound delivery — the 202 response returns immediately;
	// the SMTP send happens in the background via executionCtx.waitUntil.
	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
			headers: buildThreadingHeaders(originalMsgId, references),
		}).catch((e) => {
			console.error(
				"[parrot] Deferred reply delivery failed:",
				(e as Error).message,
			);
		}),
	);

	return c.json({ id: messageId, status: "sent" }, 202);
}

/**
 * POST /api/inbox/messages/:id/forward
 *
 * Same as reply, but starts a NEW thread (thread_id = new messageId, no
 * In-Reply-To header). Attachments may include forwarded files from the
 * original message — the client is responsible for re-uploading them
 * base64-encoded in the request body. A future iteration can let the
 * server reuse R2 keys when the forward target has the same employee
 * scope; for now we keep it simple (clients pay the upload tax).
 */
export async function handleForwardEmail(c: AppContext) {
	const id = c.req.param("id") ?? "";
	const employee = c.var.employee;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	// Resolve in case the forward source is itself a draft pointing at
	// the real email — keeps the audit log consistent.
	await resolveOriginalEmail(stub, rawOriginal);

	const from = {
		email: employee.email,
		name: employee.displayName || employee.email,
	};

	let toStr: string;
	let fromEmail: string;
	let fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(
			to,
			from,
			employee.email,
		));
	} catch (e) {
		if (e instanceof SenderValidationError) {
			return c.json({ error: e.message }, 400);
		}
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const attachmentData = await storeAttachments(
		c.env.BUCKET,
		messageId,
		attachments,
	);

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
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{
					key: "from",
					value: `${from.name} <${from.email}>`,
				},
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc
					? [
							{
								key: "cc",
								value: Array.isArray(cc) ? cc.join(", ") : cc,
							},
						]
					: []),
				...(bcc
					? [
							{
								key: "bcc",
								value: Array.isArray(bcc) ? bcc.join(", ") : bcc,
							},
						]
					: []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		},
		attachmentData,
	);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
		}).catch((e) => {
			console.error(
				"[parrot] Deferred forward delivery failed:",
				(e as Error).message,
			);
		}),
	);

	return c.json({ id: messageId, status: "sent" }, 202);
}

/**
 * POST /api/inbox/compose
 *
 * v1.3.1 BACKFILL: new endpoint for "fresh" compose (no original
 * message context). This is what the ComposePane button hits. It writes
 * to the Sent folder, mints a new thread, and dispatches outbound via
 * the SendEmail binding — same plumbing as forward, but the route layer
 * doesn't need to load + resolve an "original" email.
 *
 * We mount this on the same /api/inbox/* prefix so it inherits the
 * requireEmployeeMailbox middleware in workers/index.ts.
 */
export async function handleComposeEmail(c: AppContext) {
	const employee = c.var.employee;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;

	const from = {
		email: employee.email,
		name: employee.displayName || employee.email,
	};

	let toStr: string;
	let fromEmail: string;
	let fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(
			to,
			from,
			employee.email,
		));
	} catch (e) {
		if (e instanceof SenderValidationError) {
			return c.json({ error: e.message }, 400);
		}
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const attachmentData = await storeAttachments(
		c.env.BUCKET,
		messageId,
		attachments,
	);

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
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{
					key: "from",
					value: `${from.name} <${from.email}>`,
				},
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc
					? [
							{
								key: "cc",
								value: Array.isArray(cc) ? cc.join(", ") : cc,
							},
						]
					: []),
				...(bcc
					? [
							{
								key: "bcc",
								value: Array.isArray(bcc) ? bcc.join(", ") : bcc,
							},
						]
					: []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		},
		attachmentData,
	);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
		}).catch((e) => {
			console.error(
				"[parrot] Deferred compose delivery failed:",
				(e as Error).message,
			);
		}),
	);

	return c.json({ id: messageId, status: "sent" }, 202);
}
