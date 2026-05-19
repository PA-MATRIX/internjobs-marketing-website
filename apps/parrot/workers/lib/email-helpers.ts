// v1.2 Phase 10 Wave 1: Parrot email helpers.
//
// Lifted from apps/agentic-inbox/workers/lib/email-helpers.ts but trimmed
// to just the helpers Wave 1 needs. The rest (HTML/text conversion,
// threading helpers, getFullEmail/getFullThread) will be ported as later
// waves grow the inbox surface.

import type { Env } from "../types";
import type { EmployeeMailboxDO } from "../durableObject";

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
