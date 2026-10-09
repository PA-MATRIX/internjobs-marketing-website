// apps/startup/workers/routes/email.ts
// v1.4 Phase 28.5 STARTUP-AGENT-EMAIL-02 — inbound email handler.
// v1.5 Phase 33 Plan 01 — refactored: one shared core, two entry points.
//
// ── Two entry points, one core ───────────────────────────────────────────────
//
//   1. POST /internal/email/inbound  (emailInternalRouter — the PRIMARY path)
//      apps/email-worker (`internjobs-email-ingest`) owns the ONE zone-wide
//      Cloudflare Email Routing catch-all for internjobs.ai. Live CF API
//      inspection during Phase 33 confirmed CF supports exactly one catch-all
//      (`matchers:[{type:"all"}]`) per zone — the dashboard's per-subdomain
//      dropdown is only a filtered *view* of that single rule. There is no way
//      to add a second, independent catch-all scoped to employers.internjobs.ai
//      without repointing (and breaking) agent.internjobs.ai's conversation-alias
//      ingestion. So email-worker is the single mail dispatcher: for
//      `@employers.internjobs.ai` recipients it hands the raw MIME off to this
//      Worker over HTTPS, and we reuse the exact same resolve/parse/insert core
//      the CF-native path uses. See apps/email-worker/src/index.js for the
//      authoritative explanation of the catch-all constraint.
//
//   2. email() export  (handleInboundEmail — DEFENSIVE / future-proof path)
//      Wired in apps/startup/workers/app.ts. Currently NOT invoked by CF (see
//      above), but kept working and tested so that if CF ever gains multi-rule
//      routing — or the catch-all is repointed here — the direct path still
//      behaves exactly as it did before this refactor (same setReject()
//      semantics, same structured-log event names).
//
// Both entry points funnel into processInboundEmail(), which does:
//   resolve slug -> (startup_id, member_id) via the Fly proxy
//     (`startup_channel_links WHERE channel_type='email' AND
//       channel_external_id = '<slug>@employers.internjobs.ai'`)
//   -> parse MIME with postal-mime
//   -> extract threading headers (In-Reply-To / References / Message-ID)
//   -> insert an `inbound_messages` row via the Fly proxy.
//
// Pattern mirror: apps/parrot/workers/lib/inbound-email.ts. Differences from
// parrot:
//   • No WorkspaceDO / EmployeeMailboxDO — startup model is a flat schema
//     with `inbound_messages` (created by 0003b/0004) carrying startup_id
//     directly.
//   • No Lakera screening here — Phase 28.5 scope was the routing path;
//     candidate-side safety screening is tracked for a later phase (founders
//     receive cold replies from candidates they themselves messaged, so the
//     inbound surface is lower-risk than parrot's employee mailbox).
//   • Thread stitching is best-effort via In-Reply-To + Message-ID headers,
//     stored on inbound_messages.metadata so a later thread-aware UI can match
//     replies to outbound emails.
//
// Open risks (preserved as TODOs):
//   • If a candidate's MUA strips In-Reply-To, the message lands as a new
//     thread. Acceptable.
//   • setReject() (email() path only) for unknown slugs MIGHT bounce mail back
//     to the sender. On the HTTP path the equivalent case is a 404 and the
//     caller fails safe by forwarding to the operator fallback inbox instead.

import { Hono } from "hono";
import PostalMime from "postal-mime";
import type { Env } from "../types";

// ── Latency budget (Phase 33 — cross-package contract) ───────────────────────
//
// These two constants are the INNER half of the inbound-email latency budget.
// They are exported so that (a) this package's own tests and (b) the
// cross-package CI guard `scripts/check-email-timeout-invariant.mjs` (Plan
// 33-04) can read the REAL values instead of hardcoding duplicates.
//
// Invariant (CI-enforced, NOT comment-enforced):
//   RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS + OVERHEAD_BUDGET_MS
//     <= EMPLOYERS_HANDOFF_TIMEOUT_MS
// where the latter two live in apps/email-worker/src/index.js. Currently:
//   4000 + 5000 + 5000 = 14000 <= 20000  (6000ms of real slack)
//
// Why it matters: if the inner sum could exceed email-worker's outer handoff
// timeout, a slow-but-SUCCESSFUL insert would be misclassified as a failure by
// the caller, which would then fail safe and ALSO forward the mail to the
// operator inbox — a spurious duplicate.
export const RESOLVE_TIMEOUT_MS = 4000;
export const INSERT_TIMEOUT_MS = 5000;

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

type ParsedEmail = Awaited<ReturnType<InstanceType<typeof PostalMime>["parse"]>>;

/**
 * Read a raw header value off a postal-mime parse result.
 *
 * The CF-native email() path used to read these from `message.headers` (CF's
 * own header map). The shared core only ever has the raw MIME bytes (the HTTP
 * handoff carries the body + To/From, not CF's header map), so we read the same
 * headers back out of the parsed MIME — same source data, same values.
 */
function headerValue(parsed: ParsedEmail, key: string): string | null {
	const wanted = key.toLowerCase();
	const hit = parsed.headers?.find((h) => h.key?.toLowerCase() === wanted);
	return hit?.value ?? null;
}

// ── shared core ──────────────────────────────────────────────────────────────

interface ChannelResolveResponse {
	startup_id: string;
	member_id: string | null;
}

export interface ProcessInboundEmailInput {
	/** Lowercased recipient; caller has already validated the @employers domain. */
	toAddress: string;
	/** CF's `message.from` (email() path) or the X-Startup-From handoff header. Fallback only. */
	fromAddressHeader: string | null;
	/** Raw RFC 5322 bytes. */
	rawBytes: ArrayBuffer;
	env: Env;
}

export type ProcessInboundEmailResult =
	| {
			ok: true;
			duplicate: boolean;
			id: string | null;
			startup_id: string;
			member_id: string | null;
	  }
	| {
			ok: false;
			reason: "unknown_slug" | "resolve_failed" | "parse_failed" | "insert_failed";
	  };

/**
 * The single implementation of "route an employers.internjobs.ai email to the
 * right startup". Both the HTTP handoff route and the CF-native email() export
 * call this; neither duplicates any of the logic.
 *
 * Never throws — every failure mode is returned as a tagged `{ok:false, reason}`
 * so each caller can decide its own failure semantics (email(): setReject vs
 * silent-drop; HTTP: status code so email-worker can fail safe).
 */
export async function processInboundEmail(
	input: ProcessInboundEmailInput,
): Promise<ProcessInboundEmailResult> {
	const { toAddress, fromAddressHeader, rawBytes, env } = input;
	const slug = toAddress.split("@")[0];
	const baseUrl = env.STARTUP_API_URL.replace(/\/$/, "");

	// 1. Resolve startup_id via Fly proxy — startup_channel_links lookup.
	let resolved: ChannelResolveResponse | null = null;
	try {
		const channelRes = await fetch(
			`${baseUrl}/v1/channels/resolve?email=${encodeURIComponent(toAddress)}`,
			{
				headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
				// Phase 33 latency budget: RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS +
				// OVERHEAD_BUDGET_MS (apps/email-worker) must stay <=
				// EMPLOYERS_HANDOFF_TIMEOUT_MS (apps/email-worker). Current:
				// 4000+5000=9000ms inner sum. This is CI-enforced by
				// scripts/check-email-timeout-invariant.mjs (Plan 33-04), which reads
				// the real constants from both packages — do not rely on this comment
				// alone.
				signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
			},
		);
		if (channelRes.status === 404) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_inbound_email_unknown_slug",
					to: toAddress,
					from: fromAddressHeader,
					slug,
				}),
			);
			return { ok: false, reason: "unknown_slug" };
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
			return { ok: false, reason: "resolve_failed" };
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
		return { ok: false, reason: "resolve_failed" };
	}

	if (!resolved?.startup_id) {
		// Defensive — should be caught by the 404 status check above.
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_inbound_email_unknown_slug",
				to: toAddress,
				from: fromAddressHeader,
				slug,
			}),
		);
		return { ok: false, reason: "unknown_slug" };
	}

	// 2. Parse MIME body with postal-mime (same package as apps/parrot).
	let parsed: ParsedEmail;
	try {
		parsed = await new PostalMime().parse(rawBytes);
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_inbound_email_parse_failed",
				error: (err as Error)?.message ?? String(err),
				to: toAddress,
				rawSize: rawBytes.byteLength,
			}),
		);
		return { ok: false, reason: "parse_failed" };
	}

	// 3. Pull threading + identity headers (best-effort; may be absent).
	const inReplyTo = extractMsgId(
		parsed.inReplyTo ?? headerValue(parsed, "in-reply-to"),
	);
	const references = parsed.references ?? headerValue(parsed, "references");
	const referencesFirst =
		references != null ? extractMsgId(references.trim().split(/\s+/)[0]) : null;
	const messageId = extractMsgId(
		parsed.messageId ?? headerValue(parsed, "message-id"),
	);
	const threadAnchor = referencesFirst || inReplyTo || messageId;

	// 4. Insert inbound_messages row via Fly proxy.
	// Schema (from migrations/0003b + 0004):
	//   provider (text), provider_event_id (text), channel_type (text),
	//   channel_address (text), student_id (uuid), startup_id (uuid),
	//   direction (text), body (text), metadata (jsonb), processed_at, created_at.
	// We set provider='cloudflare-email' (matches the routing source) and
	// channel_type='email' for parity with the channel_links row that
	// resolved us here. Threading + identity headers go into metadata.
	const bodyText = parsed.text ?? "";
	const bodyHtml = parsed.html ?? "";
	const fromAddress = (
		parsed.from?.address ??
		fromAddressHeader ??
		""
	).toLowerCase();

	let insertBody: { id?: string; duplicate?: boolean } = {};
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
					raw_size: rawBytes.byteLength,
				},
			}),
			// Phase 33 latency budget: RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS +
			// OVERHEAD_BUDGET_MS (apps/email-worker) must stay <=
			// EMPLOYERS_HANDOFF_TIMEOUT_MS (apps/email-worker). Current:
			// 4000+5000=9000ms inner sum. This is CI-enforced by
			// scripts/check-email-timeout-invariant.mjs (Plan 33-04), which reads the
			// real constants from both packages — do not rely on this comment alone.
			signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
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
			return { ok: false, reason: "insert_failed" };
		}
		insertBody = ((await insertRes.json().catch(() => ({}))) ?? {}) as {
			id?: string;
			duplicate?: boolean;
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_inbound_email_insert_error",
				error: (err as Error)?.message ?? String(err),
				to: toAddress,
			}),
		);
		return { ok: false, reason: "insert_failed" };
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

	return {
		ok: true,
		duplicate: insertBody.duplicate ?? false,
		id: insertBody.id ?? null,
		startup_id: resolved.startup_id,
		member_id: resolved.member_id,
	};
}

// ── entry point 1: CF-native email() export (defensive path) ─────────────────

/**
 * The Worker's `email()` export delegates to this function. CF Email Routing
 * hands us a ForwardableEmailMessage shape (defined in @cloudflare/workers-types).
 *
 * NOTE: as of Phase 33 this path is not actually invoked by CF — the zone's one
 * catch-all belongs to apps/email-worker, which reaches us over HTTP instead
 * (see the module header). It is retained, unchanged in behavior, as the
 * defensive/future-proof direct-routing path.
 *
 * Failure semantics (UNCHANGED by the Phase 33 refactor):
 *   • invalid recipient  → setReject("invalid recipient address")
 *   • unknown slug       → setReject("startup not found")
 *   • infra/parse failure→ log + silent drop, NO setReject (bouncing mail to a
 *     confused sender on our own infrastructure failure is worse than losing a
 *     single message we can recover from logs).
 */
export async function handleInboundEmail(
	message: ForwardableEmailMessage,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	// Recipient-shape validation stays OUTSIDE processInboundEmail: it is
	// specific to the envelope CF hands the email() export. (The HTTP path does
	// the equivalent check on its X-Startup-To header and answers 400.)
	const toAddress = message.to?.toLowerCase() ?? "";
	const slug = toAddress.split("@")[0];

	if (!slug || !toAddress.endsWith("@employers.internjobs.ai")) {
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

	const rawBytes = await streamToArrayBuffer(message.raw, message.rawSize);

	const result = await processInboundEmail({
		toAddress,
		fromAddressHeader: message.from ?? null,
		rawBytes,
		env,
	});

	if (!result.ok && result.reason === "unknown_slug") {
		// Reject so the sender knows (same as pre-refactor behavior).
		message.setReject("startup not found");
		return;
	}

	// resolve_failed / parse_failed / insert_failed → already logged inside the
	// core; drop silently without setReject (same as pre-refactor behavior).
	// ok → already logged startup_inbound_email_routed inside the core.
}

// ── entry point 2: HTTP handoff from apps/email-worker (primary path) ────────

/**
 * Constant-time compare of the provided Bearer secret against
 * env.EMAIL_HANDOFF_SECRET. Returns false on length mismatch without leaking
 * the real length (compares provided against itself to keep both code paths
 * cost-equivalent).
 *
 * Deliberately a local copy of routes/admin.ts::verifyAdminSecret rather than a
 * shared import — admin.ts already owns its own copy for its own secret, and a
 * few duplicated lines beat coupling two unrelated routers together.
 */
async function verifyEmailHandoffSecret(
	provided: string,
	env: Env,
): Promise<boolean> {
	const secret = env.EMAIL_HANDOFF_SECRET;
	if (!secret || !provided) return false;
	const enc = new TextEncoder();
	const a = enc.encode(provided);
	const b = enc.encode(secret);
	if (a.byteLength !== b.byteLength) {
		return !crypto.subtle.timingSafeEqual(a, a);
	}
	return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Mounted at `/internal` from app.ts → the full path is
 * POST /internal/email/inbound.
 *
 * Contract with apps/email-worker (Plan 33-02) — both sides were written against
 * this exact spec:
 *   Headers: Authorization: Bearer <EMAIL_HANDOFF_SECRET>
 *            Content-Type: message/rfc822
 *            X-Startup-To:   <recipient, e.g. acme@employers.internjobs.ai>
 *            X-Startup-From: <CF's message.from>
 *   Body:    the exact raw MIME bytes CF handed the email-worker (octets, not JSON)
 *   Status:  200 {ok:true, duplicate?, id?}  success
 *            400 invalid recipient
 *            401 bad/missing auth
 *            404 unknown slug (no channel link)
 *            422 MIME parse failure
 *            502 resolve/insert infra failure
 * The caller treats ANY non-2xx / timeout / throw as "fail safe": forward the
 * original mail to its operator fallback inbox.
 */
export const emailInternalRouter = new Hono<{ Bindings: Env }>();

const STATUS_BY_REASON = {
	unknown_slug: 404,
	resolve_failed: 502,
	parse_failed: 422,
	insert_failed: 502,
} as const;

emailInternalRouter.post("/email/inbound", async (c) => {
	// 1. Auth — before any downstream work.
	const provided = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
	if (!(await verifyEmailHandoffSecret(provided, c.env))) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_inbound_email_handoff_unauthorized",
				to: c.req.header("X-Startup-To") ?? null,
			}),
		);
		return c.json({ error: "unauthorized" }, 401);
	}

	// 2. Recipient shape.
	const toAddress = (c.req.header("X-Startup-To") ?? "").toLowerCase().trim();
	const slug = toAddress.split("@")[0];
	if (!slug || !toAddress.endsWith("@employers.internjobs.ai")) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_inbound_email_invalid_recipient",
				to: toAddress,
				from: c.req.header("X-Startup-From") ?? null,
			}),
		);
		return c.json({ error: "invalid_recipient" }, 400);
	}

	// 3. Shared core.
	const fromAddressHeader = c.req.header("X-Startup-From") ?? null;
	const rawBytes = await c.req.arrayBuffer();
	const result = await processInboundEmail({
		toAddress,
		fromAddressHeader,
		rawBytes,
		env: c.env,
	});

	if (result.ok) {
		return c.json({ ok: true, duplicate: result.duplicate, id: result.id }, 200);
	}
	return c.json({ ok: false, reason: result.reason }, STATUS_BY_REASON[result.reason]);
});
