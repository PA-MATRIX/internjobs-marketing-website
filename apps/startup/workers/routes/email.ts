// apps/startup/workers/routes/email.ts
// v1.4 Phase 28.5 STARTUP-AGENT-EMAIL-02 — catch-all inbound email handler.
//
// Cloudflare Email Routing delivers ALL mail to *@startups.internjobs.ai
// to the `email()` export on this Worker's default export (wired in
// apps/startup/workers/app.ts). This module parses the MIME body, resolves
// the recipient slug to (startup_id, member_id) via the Fly proxy
// (`startup_channel_links WHERE channel_type='email' AND channel_external_id
// = '<slug>@startups.internjobs.ai'`), and inserts an `inbound_messages` row.
//
// Pattern mirror: apps/parrot/workers/lib/inbound-email.ts. Differences from
// parrot:
//   • No WorkspaceDO / EmployeeMailboxDO — startup model is a flat schema
//     with `inbound_messages` (created by 0003b/0004) carrying startup_id
//     directly.
//   • No Lakera screening here — Phase 28.5 scope is the routing path;
//     candidate-side safety screening can land in v1.5 if the threat
//     model warrants it (founders receive cold replies from candidates
//     they themselves messaged, so the inbound surface is lower-risk than
//     parrot's employee mailbox).
//   • Thread stitching is best-effort via In-Reply-To + Message-ID
//     headers, stored on inbound_messages.metadata so 28.5-05 (or a
//     later thread-aware UI) can match replies to outbound emails.
//
// Open risks (preserved as TODOs):
//   • startup_channel_links resolution depends on DEFER-28.5-01-D (CF
//     Email Routing domain verification) + DEFER-28.5-01-E (catch-all
//     rule → Worker). Code is correct; routing is operator config.
//   • If a candidate's MUA strips In-Reply-To, the message lands as a
//     new thread. Acceptable for v1.4.
//   • setReject() is called for unknown slugs — this MIGHT bounce mail
//     back to the sender (CF Email Routing behaviour). For v1.4 that's
//     desired (don't silently swallow misrouted mail); v1.5 may switch
//     to forward-to-raj@ for triage.

import PostalMime from "postal-mime";
import type { Env } from "../types";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Drain a ReadableStream into a single ArrayBuffer. CF Email Routing
 * provides `rawSize` as a size hint so we can preallocate and avoid the
 * cost of growing concatenation.
 *
 * Mirror of apps/parrot/workers/lib/inbound-email.ts::streamToArrayBuffer.
 */
async function streamToArrayBuffer(
	stream: ReadableStream,
	sizeHint: number,
): Promise<ArrayBuffer> {
	const result = new Uint8Array(sizeHint);
	let offset = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (offset + value.byteLength > result.byteLength) {
			// Hint was wrong (rare) — fall back to growing buffer.
			const grown = new Uint8Array(offset + value.byteLength);
			grown.set(result.subarray(0, offset));
			grown.set(value, offset);
			return grown.buffer as ArrayBuffer;
		}
		result.set(value, offset);
		offset += value.byteLength;
	}
	return result.subarray(0, offset).buffer as ArrayBuffer;
}

/**
 * Pull a clean RFC-5322 Message-ID out of an angle-bracketed string.
 * `<abc.def@host>` → `abc.def@host`. For a whitespace-separated
 * References list we take the first id (the thread root).
 */
function extractMsgId(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const m = raw.match(/<([^>]+)>/);
	if (m) return m[1];
	const first = raw.trim().split(/\s+/)[0];
	return first || null;
}

// ── handler ──────────────────────────────────────────────────────────────────

interface ChannelResolveResponse {
	startup_id: string;
	member_id: string | null;
}

/**
 * The Worker's `email()` export delegates to this function. CF Email
 * Routing hands us a ForwardableEmailMessage shape (defined in the
 * @cloudflare/workers-types lib). We parse, resolve slug → startup, and
 * insert an inbound_messages row via the Fly proxy.
 *
 * Errors are surfaced via setReject() when possible (unknown recipient,
 * malformed address). Unrecoverable errors (Fly proxy down, body parse
 * failure) are logged and the message is silently dropped — bouncing
 * mail to a confused sender on infrastructure failure is worse than
 * losing a single inbound message we can recover from logs.
 */
export async function handleInboundEmail(
	message: ForwardableEmailMessage,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	// 1. Extract slug from recipient envelope address.
	const toAddress = message.to?.toLowerCase() ?? "";
	const slug = toAddress.split("@")[0];

	if (!slug || !toAddress.endsWith("@startups.internjobs.ai")) {
		message.setReject("invalid recipient address");
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_inbound_email_invalid_recipient",
				to: toAddress,
				from: message.from,
			}),
		);
		return;
	}

	// 2. Resolve startup_id via Fly proxy — startup_channel_links lookup.
	const baseUrl = env.STARTUP_API_URL.replace(/\/$/, "");
	let resolved: ChannelResolveResponse | null = null;
	try {
		const channelRes = await fetch(
			`${baseUrl}/v1/channels/resolve?email=${encodeURIComponent(toAddress)}`,
			{
				headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
				signal: AbortSignal.timeout(8000),
			},
		);
		if (channelRes.status === 404) {
			// No channel link for this slug → reject so the sender knows.
			message.setReject("startup not found");
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_inbound_email_unknown_slug",
					to: toAddress,
					from: message.from,
					slug,
				}),
			);
			return;
		}
		if (!channelRes.ok) {
			console.error(
				JSON.stringify({
					level: "error",
					event: "startup_inbound_email_resolve_failed",
					status: channelRes.status,
					to: toAddress,
				}),
			);
			// Don't setReject on infra failure — drop and recover from logs.
			return;
		}
		resolved = (await channelRes.json()) as ChannelResolveResponse;
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_inbound_email_resolve_error",
				error: (err as Error)?.message ?? String(err),
				to: toAddress,
			}),
		);
		return;
	}

	if (!resolved?.startup_id) {
		// Defensive — should be caught by status check above.
		message.setReject("startup not found");
		return;
	}

	// 3. Parse MIME body with postal-mime (same package as apps/parrot).
	let parsed: Awaited<ReturnType<InstanceType<typeof PostalMime>["parse"]>>;
	try {
		const rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
		parsed = await new PostalMime().parse(rawEmail);
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_inbound_email_parse_failed",
				error: (err as Error)?.message ?? String(err),
				to: toAddress,
				rawSize: message.rawSize,
			}),
		);
		return;
	}

	// 4. Pull threading + identity headers (best-effort; may be absent).
	const inReplyTo = extractMsgId(message.headers.get("in-reply-to"));
	const references = message.headers.get("references");
	const referencesFirst =
		references != null ? extractMsgId(references.split(/\s+/)[0]) : null;
	const messageId = extractMsgId(message.headers.get("message-id"));
	const threadAnchor = referencesFirst || inReplyTo || messageId;

	// 5. Insert inbound_messages row via Fly proxy.
	// Schema (from migrations/0003b + 0004):
	//   provider (text), provider_event_id (text), channel_type (text),
	//   channel_address (text), student_id (uuid), startup_id (uuid),
	//   direction (text), body (text), metadata (jsonb), processed_at, created_at.
	// We set provider='cloudflare-email' (matches the routing source) and
	// channel_type='email' for parity with the channel_links row that
	// resolved us here. Threading + identity headers go into metadata.
	const bodyText = parsed.text ?? "";
	const bodyHtml = parsed.html ?? "";
	const fromAddress = (parsed.from?.address ?? message.from ?? "").toLowerCase();

	try {
		const insertRes = await fetch(`${baseUrl}/v1/messages/inbound`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			body: JSON.stringify({
				provider: "cloudflare-email",
				provider_event_id: messageId, // RFC Message-ID dedupes resends
				channel_type: "email",
				channel_address: toAddress,
				startup_id: resolved.startup_id,
				member_id: resolved.member_id,
				direction: "inbound",
				from_address: fromAddress,
				subject: parsed.subject ?? "",
				body: bodyHtml || bodyText, // prefer rich body when available
				body_text: bodyText,
				body_html: bodyHtml,
				metadata: {
					in_reply_to: inReplyTo,
					message_id: messageId,
					thread_anchor: threadAnchor,
					references_first: referencesFirst,
					raw_size: message.rawSize,
				},
			}),
			signal: AbortSignal.timeout(10000),
		});

		if (!insertRes.ok) {
			const detail = await insertRes.text().catch(() => "");
			console.error(
				JSON.stringify({
					level: "error",
					event: "startup_inbound_email_insert_failed",
					status: insertRes.status,
					detail: detail.slice(0, 200),
					to: toAddress,
				}),
			);
			return;
		}
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_inbound_email_insert_error",
				error: (err as Error)?.message ?? String(err),
				to: toAddress,
			}),
		);
		return;
	}

	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_inbound_email_routed",
			startup_id: resolved.startup_id,
			member_id: resolved.member_id,
			from: fromAddress,
			to: toAddress,
			subject: (parsed.subject ?? "").slice(0, 80),
			thread_anchor: threadAnchor,
			has_html: bodyHtml.length > 0,
			has_text: bodyText.length > 0,
		}),
	);
}
