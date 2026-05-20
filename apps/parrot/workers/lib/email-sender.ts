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
