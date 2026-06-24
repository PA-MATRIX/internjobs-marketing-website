// v1.3.1 BACKFILL: Lifted from apps/agentic-inbox/workers/email-sender.ts.
//
// Adaptations for Parrot:
//   - None. The Cloudflare `send_email` binding (env.EMAIL) is identical
//     across apps. Parrot already uses env.EMAIL.send() in workers/lib/email.ts
//     for the welcome-email path. This module is the reply/forward variant
//     and accepts threading headers (In-Reply-To / References) which the
//     welcome path doesn't need.
//
// Source of truth: this file does NOT modify apps/agentic-inbox/.

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * Send an email using the Cloudflare Email Service `send_email` binding.
 *
 * Throws on validation or delivery errors (error has .code property when
 * raised by the binding itself). Caller is responsible for wrapping in
 * c.executionCtx.waitUntil() with a .catch() — the route handler should
 * NOT block its HTTP response on outbound SMTP delivery.
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	const result = await binding.send(
		message as Parameters<SendEmail["send"]>[0],
	);
	return { messageId: result.messageId };
}

// Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): offline chat-mention/DM email.
//
// Sent by the EmployeeMailboxDO alarm when the employee has been offline
// (last_seen_at older than 5 minutes) AND has unread `chat_mention`
// notifications. This is the deliberate substitute for background push when
// the Workspace tab is closed (push-when-closed is out of scope natively —
// see 31-CONTEXT "Deferred / Decided-Out").
//
// Fail-soft contract: returns `{ ok: false }` (never throws) when the EMAIL
// binding is missing or the send fails, so the alarm's at-least-once
// reschedule loop is never broken by a transient SMTP error.
const WORKSPACE_CHAT_URL = "https://workspace.internjobs.ai/chat";
const OFFLINE_FROM = "noreply@internjobs.ai";

export async function sendOfflineChatNotification(
	env: { EMAIL?: SendEmail },
	email: string,
	mentionCount: number,
): Promise<{ ok: boolean; messageId?: string }> {
	if (!env.EMAIL) {
		console.warn(
			"sendOfflineChatNotification: EMAIL binding missing — skipping",
		);
		return { ok: false };
	}
	const plural = mentionCount === 1 ? "" : "s";
	const subject = `You have ${mentionCount} unread mention${plural} in your workspace chat`;
	const text =
		`You were mentioned ${mentionCount} time${plural} in your workspace while you were away.\n\n` +
		`Open your workspace to read your messages:\n${WORKSPACE_CHAT_URL}\n`;
	const html =
		`<p>You were mentioned <strong>${mentionCount}</strong> time${plural} in your workspace while you were away.</p>` +
		`<p><a href="${WORKSPACE_CHAT_URL}">Open your workspace</a> to read your messages.</p>`;
	try {
		const result = await sendEmail(env.EMAIL, {
			to: email,
			from: OFFLINE_FROM,
			subject,
			text,
			html,
		});
		return { ok: true, messageId: result.messageId };
	} catch (err) {
		console.error("sendOfflineChatNotification: send failed", err);
		return { ok: false };
	}
}
