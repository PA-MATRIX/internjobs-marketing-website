// v1.3.1 Agent Lift: Shared agent + MCP tool business logic.
//
// Lifted from apps/agentic-inbox/workers/lib/tools.ts. Adaptations for
// Parrot's multi-employee model:
//   - Tool functions take an `EmployeeMailboxDO` stub (resolved by the
//     route handler from c.var.mailboxStub) instead of being passed a
//     mailboxId and resolving the stub internally. This means EVERY tool
//     is implicitly scoped to the authenticated employee — there is no
//     code path through which an employee can reach another employee's
//     mailbox via a tool call.
//   - verifyDraft is called with (clerkUserId, env, body) instead of
//     (ai, body) — Parrot's verifyDraft goes through the AI Gateway
//     transport so it needs the employee ID for per-user quota.
//   - toolListMailboxes is dropped — Parrot doesn't expose a multi-mailbox
//     directory; each employee sees only their own inbox.
//   - toolSendEmail / toolSendReply route through the existing
//     workers/lib/email.ts `sendEmail` helper (env.EMAIL binding) instead
//     of agentic-inbox's email-sender.ts.
//
// Each function returns a plain object. The HTTP agent route and (future)
// MCP endpoint wrap these results in their own response formats.

import type { Env } from "../types";
import type { EmployeeMailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import {
	getFullEmail,
	getFullThread,
	buildQuotedReplyBlock,
	textToHtml,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
} from "./email-helpers";
import { verifyDraft } from "./ai";
import { sendEmail } from "./email-sender";
import { Folders } from "../../shared/folders";

type MailboxStub = DurableObjectStub<EmployeeMailboxDO>;

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
	stub: MailboxStub,
	params: { folder?: string; limit?: number; page?: number },
): Promise<unknown> {
	return stub.getEmails({
		folder: params.folder ?? Folders.INBOX,
		limit: params.limit ?? 20,
		page: params.page ?? 1,
		sortColumn: "date",
		sortDirection: "DESC",
	});
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(
	stub: MailboxStub,
	emailId: string,
): Promise<unknown> {
	const email = await getFullEmail(stub, emailId);
	if (!email) return { error: "Email not found" };
	return email;
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(
	stub: MailboxStub,
	threadId: string,
): Promise<unknown> {
	return getFullThread(stub, threadId);
}

// ── search_emails ──────────────────────────────────────────────────

type MailboxSearchStub = {
	searchEmails?: (options: {
		query: string;
		folder?: string;
	}) => Promise<unknown>;
};

export async function toolSearchEmails(
	stub: MailboxStub,
	params: { query: string; folder?: string },
): Promise<unknown> {
	const searchable = stub as unknown as MailboxSearchStub;
	if (typeof searchable.searchEmails !== "function") {
		// EmployeeMailboxDO doesn't yet expose searchEmails — fall back to
		// listing the requested folder and filtering by subject/sender
		// client-side. Tolerable for small mailboxes; can grow into a real
		// SQL LIKE/FTS5 search later (see TODO PARROT-SEARCH).
		const emails = (await stub.getEmails({
			folder: params.folder ?? Folders.INBOX,
			limit: 200,
		})) as Array<{
			id: string;
			subject?: string | null;
			sender?: string | null;
			snippet?: string | null;
		}>;
		const q = params.query.toLowerCase();
		return emails.filter((e) => {
			const hay = `${e.subject ?? ""} ${e.sender ?? ""} ${e.snippet ?? ""}`.toLowerCase();
			return hay.includes(q);
		});
	}
	return searchable.searchEmails({
		query: params.query,
		folder: params.folder,
	});
}

// ── draft_reply ────────────────────────────────────────────────────

export async function toolDraftReply(
	stub: MailboxStub,
	env: Env,
	clerkUserId: string,
	mailboxEmail: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
	},
): Promise<
	| {
			status: "draft_saved";
			draftId: string;
			message: string;
			draft: Record<string, string>;
	  }
	| { error: string }
> {
	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(clerkUserId, env, processedBody);
		if (!sanitized) {
			return {
				error:
					"Draft verification failed — body could not be verified. Please try again.",
			};
		}
		processedBody = sanitized;
	}

	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	const original = (await stub.getEmail(params.originalEmailId)) as
		| EmailFull
		| null;
	const threadId = original?.thread_id || params.originalEmailId;

	const quotedBlock = original
		? buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender || params.to,
				body: original.body ?? undefined,
			})
		: "";
	const bodyHtml = processedBody + quotedBlock;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxEmail.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: bodyHtml,
			in_reply_to: params.originalEmailId,
			email_references: null,
			thread_id: threadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		message:
			"Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			originalEmailId: params.originalEmailId,
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : bodyHtml,
		},
	};
}

// ── draft_email (new, not a reply) ─────────────────────────────────

export async function toolDraftEmail(
	stub: MailboxStub,
	env: Env,
	clerkUserId: string,
	mailboxEmail: string,
	params: {
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		in_reply_to?: string;
		thread_id?: string;
	},
): Promise<
	| {
			status: string;
			draftId: string;
			threadId?: string;
			message: string;
			draft?: Record<string, string>;
	  }
	| { error: string }
> {
	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(clerkUserId, env, processedBody);
		if (!sanitized) {
			return {
				error:
					"Draft verification failed — body could not be verified. Please try again.",
			};
		}
		processedBody = sanitized;
	}

	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	let resolvedThreadId = params.thread_id;
	if (!resolvedThreadId && params.in_reply_to) {
		const original = (await stub.getEmail(params.in_reply_to)) as
			| EmailFull
			| null;
		resolvedThreadId = original?.thread_id || params.in_reply_to;
	}
	if (!resolvedThreadId) {
		resolvedThreadId = draftId;
	}

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxEmail.toLowerCase(),
			recipient: (params.to || "").toLowerCase(),
			date: new Date().toISOString(),
			body: processedBody,
			in_reply_to: params.in_reply_to || null,
			email_references: null,
			thread_id: resolvedThreadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		threadId: resolvedThreadId,
		message:
			"Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : processedBody,
		},
	};
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
	stub: MailboxStub,
	emailId: string,
	read: boolean,
): Promise<{ status: string; emailId: string; read: boolean }> {
	await stub.updateEmail(emailId, { read });
	return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
	stub: MailboxStub,
	emailId: string,
	folderId: string,
): Promise<{ status: string; emailId: string; folder: string } | { error: string }> {
	const success = await stub.moveEmail(emailId, folderId);
	if (success) {
		return { status: "moved", emailId, folder: folderId };
	}
	return { error: "Failed to move email" };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(
	stub: MailboxStub,
	draftId: string,
): Promise<{ status: string; draftId: string } | { error: string }> {
	const email = (await stub.getEmail(draftId)) as
		| { folder_id?: string }
		| null;
	if (!email) return { error: "Draft not found" };
	if (email.folder_id !== Folders.DRAFT) {
		return { error: "Cannot discard: email is not a draft" };
	}
	await stub.deleteEmail(draftId);
	return { status: "discarded", draftId };
}

// ── delete_email ───────────────────────────────────────────────────

export async function toolDeleteEmail(
	stub: MailboxStub,
	emailId: string,
): Promise<{ status: string; emailId: string } | { error: string; emailId: string }> {
	const result = await stub.deleteEmail(emailId);
	if (result === null) {
		return { error: "Email not found", emailId };
	}
	return { status: "deleted", emailId };
}

// ── send_reply ─────────────────────────────────────────────────────

type RateLimitStub = {
	checkSendRateLimit?: () => Promise<string | null>;
};

export async function toolSendReply(
	stub: MailboxStub,
	env: Env,
	clerkUserId: string,
	mailboxEmail: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		bodyHtml: string;
	},
): Promise<
	| { status: "sent"; messageId: string; message: string }
	| { error: string }
> {
	const rateLimited = stub as unknown as RateLimitStub;
	if (typeof rateLimited.checkSendRateLimit === "function") {
		const err = await rateLimited.checkSendRateLimit();
		if (err) return { error: err };
	}

	const originalEmail = (await stub.getEmail(
		params.originalEmailId,
	)) as EmailFull | null;
	if (!originalEmail) return { error: "Original email not found" };

	const { originalMsgId, references, threadId } =
		buildReferencesChain(originalEmail);
	const fromDomain = mailboxEmail.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const sanitizedBody = await verifyDraft(clerkUserId, env, params.bodyHtml);
	if (!sanitizedBody) {
		return {
			error:
				"Draft verification failed — refusing to send unverified content. Please try again.",
		};
	}
	const quotedBlock = buildQuotedReplyBlock({
		date: originalEmail.date,
		sender: originalEmail.sender || params.to,
		body: originalEmail.body ?? undefined,
	});
	const fullBodyHtml = sanitizedBody + quotedBlock;

	try {
		await sendEmail(env.EMAIL, {
			to: params.to,
			from: mailboxEmail,
			subject: params.subject,
			html: fullBodyHtml,
			headers: buildThreadingHeaders(originalMsgId, references),
		});
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send reply: ${(e as Error).message}` };
	}

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject: params.subject,
			sender: mailboxEmail.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: fullBodyHtml,
			in_reply_to: originalMsgId,
			email_references:
				references.length > 0 ? JSON.stringify(references) : null,
			thread_id: threadId,
			message_id: outgoingMessageId,
		},
		[],
	);

	return { status: "sent", messageId, message: `Reply sent to ${params.to}` };
}

// ── send_email ─────────────────────────────────────────────────────

export async function toolSendEmail(
	stub: MailboxStub,
	env: Env,
	clerkUserId: string,
	mailboxEmail: string,
	params: { to: string; subject: string; bodyHtml: string },
): Promise<
	| { status: "sent"; messageId: string; message: string }
	| { error: string }
> {
	const rateLimited = stub as unknown as RateLimitStub;
	if (typeof rateLimited.checkSendRateLimit === "function") {
		const err = await rateLimited.checkSendRateLimit();
		if (err) return { error: err };
	}

	const fromDomain = mailboxEmail.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const sanitizedBody = await verifyDraft(clerkUserId, env, params.bodyHtml);
	if (!sanitizedBody) {
		return {
			error:
				"Draft verification failed — refusing to send unverified content. Please try again.",
		};
	}

	try {
		await sendEmail(env.EMAIL, {
			to: params.to,
			from: mailboxEmail,
			subject: params.subject,
			html: sanitizedBody,
		});
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send email: ${(e as Error).message}` };
	}

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject: params.subject,
			sender: mailboxEmail.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: sanitizedBody,
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
		},
		[],
	);

	return { status: "sent", messageId, message: `Email sent to ${params.to}` };
}

// ── Tool catalog for the MCP-style panel ───────────────────────────
//
// Exposes the list of tools the Parrot Agent supports. Used by:
//   - MCPPanel.tsx (UI list of available tools)
//   - /api/inbox/agent/tools (JSON descriptor endpoint)

export const PARROT_AGENT_TOOLS: ReadonlyArray<{
	name: string;
	description: string;
}> = [
	{ name: "list_emails", description: "List emails in a folder" },
	{ name: "get_email", description: "Read a full email with body" },
	{ name: "get_thread", description: "Load a conversation thread" },
	{ name: "search_emails", description: "Search emails by query" },
	{ name: "draft_reply", description: "Draft a reply to an email" },
	{ name: "draft_email", description: "Draft a new email" },
	{ name: "mark_email_read", description: "Mark email as read or unread" },
	{ name: "move_email", description: "Move email to a folder" },
	{ name: "discard_draft", description: "Discard a draft email" },
	{ name: "send_reply", description: "Send a reply" },
	{ name: "send_email", description: "Send a new email" },
];
