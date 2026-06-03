// v1.2 Phase 10 Wave 1: Parrot email helpers.
//
// Lifted from apps/agentic-inbox/workers/lib/email-helpers.ts but trimmed
// to just the helpers Wave 1 needs. The rest (HTML/text conversion,
// threading helpers, getFullEmail/getFullThread) will be ported as later
// waves grow the inbox surface.
//
// v1.3.1 BACKFILL: added threading helpers (buildReferencesChain,
// buildThreadingHeaders, resolveOriginalEmail) so the reply/forward
// route handler can stop being a 501 stub. These lift verbatim from
// agentic-inbox; the Parrot DO schema mirrors agentic-inbox's threading
// columns (thread_id, message_id, email_references, in_reply_to) so no
// adaptation is required beyond import paths.
//
// v1.3.1 Agent Lift: backfilled the remaining helpers from agentic-inbox —
// stripHtmlToText, textToHtml, buildQuotedReplyBlock, getFullEmail,
// getFullThread. These are needed by:
//   - workers/lib/ai.ts (verifyDraft strips/rewraps HTML)
//   - workers/lib/agent-tools.ts (draft_reply, send_reply quoted blocks)
//   - workers/routes/agent.ts (HTTP agent endpoints — summarize / draft / translate)
// Adaptation: getFullEmail/getFullThread sign `EmployeeMailboxDO` instead
// of agentic-inbox's MailboxDO; otherwise the semantics are identical.

import type { Env } from "../types";
import type { EmployeeMailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import { Folders } from "../../shared/folders";
import { formatQuotedDate } from "../../shared/dates";

export class SenderValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SenderValidationError";
	}
}

/**
 * Normalise to/from addresses and validate the sender matches the mailbox.
 */
export function validateSender(
	to: string | string[],
	from: string | { email: string; name: string },
	mailboxEmail: string,
): { toStr: string; fromEmail: string; fromDomain: string } {
	const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
	const fromEmail = (typeof from === "string" ? from : from.email).toLowerCase();

	if (fromEmail !== mailboxEmail.toLowerCase()) {
		throw new SenderValidationError(
			"From address must match the authenticated employee's mailbox",
		);
	}

	const fromDomain = fromEmail.split("@")[1];
	if (!fromDomain) {
		throw new SenderValidationError("Invalid sender email address");
	}

	return { toStr, fromEmail, fromDomain };
}

export function generateMessageId(fromDomain: string): {
	messageId: string;
	outgoingMessageId: string;
} {
	const messageId = crypto.randomUUID();
	const outgoingMessageId = `${messageId}@${fromDomain}`;
	return { messageId, outgoingMessageId };
}

export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function getMailboxStub(
	env: Env,
	employeeId: string,
): DurableObjectStub<EmployeeMailboxDO> {
	const ns = env.EMPLOYEE_MAILBOX;
	const id = ns.idFromName(employeeId);
	return ns.get(id);
}

// ── Threading (v1.3.1 backfill) ────────────────────────────────────

/**
 * Build the References chain and In-Reply-To from an original email.
 *
 * Lifts agentic-inbox semantics verbatim:
 *   - originalMsgId: prefer the RFC 2822 message_id, fall back to our
 *     internal UUID (id) so reply chains still form for legacy rows
 *     that predate the message_id column.
 *   - references: parse existing JSON array, append originalMsgId.
 *     Malformed JSON is silently treated as empty.
 *   - threadId: thread_id when present, else id of the original (we
 *     anchor the thread on its first message).
 */
export function buildReferencesChain(original: EmailFull): {
	originalMsgId: string;
	references: string[];
	threadId: string;
} {
	const originalMsgId = original.message_id || original.id;
	let existingRefs: string[] = [];
	if (original.email_references) {
		try {
			existingRefs = JSON.parse(original.email_references);
		} catch {
			// Malformed JSON in email_references — treat as empty.
		}
	}
	const references = [...existingRefs, originalMsgId].filter(Boolean);
	const threadId = original.thread_id || original.id;
	return { originalMsgId, references, threadId };
}

/**
 * Build the In-Reply-To + References headers for the outgoing email.
 * Each token is wrapped in angle brackets per RFC 2822 §3.6.4.
 */
export function buildThreadingHeaders(
	originalMsgId: string,
	references: string[],
): Record<string, string> {
	return {
		"In-Reply-To": `<${originalMsgId}>`,
		...(references.length > 0
			? { References: references.map((r) => `<${r}>`).join(" ") }
			: {}),
	};
}

/**
 * If the supplied email is itself a draft with an in_reply_to pointer,
 * resolve to the REAL original message — so reply chains thread against
 * the source thread, not the draft itself. Falls through to the input
 * email if the pointer doesn't resolve (e.g. the original was deleted).
 */
export async function resolveOriginalEmail(
	stub: DurableObjectStub<EmployeeMailboxDO>,
	email: EmailFull,
): Promise<EmailFull> {
	if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
		const realOriginal = (await stub.getEmail(
			email.in_reply_to,
		)) as EmailFull | null;
		if (realOriginal) return realOriginal;
	}
	return email;
}

// ── HTML <-> text utilities (v1.3.1 Agent Lift) ────────────────────

/**
 * Convert plain text to a simple HTML block with preserved whitespace.
 * Uses both `white-space:pre-wrap` (modern clients) and `<br>` tags
 * (clients that strip inline styles, e.g. Outlook) as belt-and-suspenders.
 */
export function textToHtml(text: string): string {
	if (!text) return "";
	const escaped = escapeHtml(text).replace(/\n/g, "<br>");
	return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Strip HTML tags and normalize whitespace to produce plain text.
 * Removes <style> and <script> blocks first to avoid injecting their
 * content into the output.
 */
export function stripHtmlToText(html: string): string {
	if (!html) return "";
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build a quoted reply block HTML string from original email data.
 *
 * The original body is sanitized to plain text before being escaped and
 * line-broken — raw HTML never survives the round-trip because the
 * compose editor and outgoing email path don't run a sandbox.
 */
export function buildQuotedReplyBlock(original: {
	date?: string;
	sender?: string;
	body?: string;
}): string {
	if (!original.body) return "";

	const originalSender = escapeHtml(original.sender || "unknown");
	const originalDate = escapeHtml(formatQuotedDate(original.date || ""));

	const plainBody = stripHtmlToText(original.body);
	const bodyToQuote = escapeHtml(plainBody).replace(/\n/g, "<br>");

	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${originalDate}, ${originalSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

// ── Full email / thread fetchers (v1.3.1 Agent Lift) ───────────────

/**
 * Fetch a single email and return it with both HTML and plain-text body.
 * Returns null if the email is not found.
 *
 * Adapted from agentic-inbox: the DO stub type is EmployeeMailboxDO,
 * not MailboxDO, but the surface contract (`getEmail(emailId)` returns
 * an EmailFull) is identical.
 */
export async function getFullEmail(
	stub: DurableObjectStub<EmployeeMailboxDO>,
	emailId: string,
): Promise<(EmailFull & { body_text: string; body_html: string | null | undefined }) | null> {
	const email = (await stub.getEmail(emailId)) as EmailFull | null;
	if (!email) return null;

	const textBody = email.body ? stripHtmlToText(email.body) : "";
	return { ...email, body_text: textBody, body_html: email.body };
}

/**
 * Fetch all emails in a thread with full bodies.
 *
 * Note: the agentic-inbox version uses a dedicated `getThreadEmails`
 * RPC on its MailboxDO that runs 2 SQL queries (emails + attachments)
 * to avoid N+1. EmployeeMailboxDO doesn't expose that RPC yet, so we
 * fall back to `getEmails({ thread_id })` followed by per-email
 * `getEmail` for full bodies — a tolerable N+1 because threads are
 * usually small (< 20 messages) and the call site is interactive.
 */
export async function getFullThread(
	stub: DurableObjectStub<EmployeeMailboxDO>,
	threadId: string,
): Promise<{
	thread_id: string;
	message_count: number;
	messages: Array<EmailFull & { body_text: string }>;
}> {
	type MailboxThreadReaderStub = {
		getThreadEmails?: (threadId: string) => Promise<EmailFull[]>;
	};
	const threadStub = stub as unknown as MailboxThreadReaderStub;

	let emails: EmailFull[];
	if (typeof threadStub.getThreadEmails === "function") {
		emails = await threadStub.getThreadEmails(threadId);
	} else {
		const metadata = (await stub.getEmails({ thread_id: threadId })) as EmailFull[];
		emails = await Promise.all(
			metadata.map(async (m) => {
				const full = (await stub.getEmail(m.id)) as EmailFull | null;
				return full ?? m;
			}),
		);
	}

	const enriched = emails.map((email) => ({
		...email,
		body_text: email.body ? stripHtmlToText(email.body) : "",
	}));

	enriched.sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	return {
		thread_id: threadId,
		message_count: enriched.length,
		messages: enriched,
	};
}
