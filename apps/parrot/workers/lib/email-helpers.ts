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

import type { Env } from "../types";
import type { EmployeeMailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import { Folders } from "../../shared/folders";

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
