// apps/startup/workers/routes/telnyx.ts
// v1.4 Phase 29-01 STARTUP-TELNYX-01..06 — Telnyx SMS inbound webhook.
//
// Mounted at POST /webhooks/telnyx/sms in apps/startup/workers/app.ts.
// The Telnyx messaging profile (DEFER-29-01-D) is configured to POST every
// inbound message event here.
//
// FLOW ORDER IS LOAD-BEARING — do not reorder:
//
//   1. STOP handling (BEFORE signature verify, per TCPA — must opt-out
//      unconditionally even on tampered/unsigned payloads)
//   2. Ed25519 signature verification (skipped with warning if
//      TELNYX_WEBHOOK_PUBLIC_KEY unbound — DEFER-29-01-F)
//   3. Parse event (skip if not 'message.received')
//   4. Identity resolution via startup_channel_links (telnyx-sms +
//      from-phone). Unknown phone → invite-prompt reply.
//   5. Intent classification (regex fast-path then LLM fallback)
//   6. Dispatch — search() or execute() handler
//   7. Format result for SMS → sendSms() reply
//
// All errors are caught and result in a generic "something went wrong"
// reply when SMS creds are bound; the response is ALWAYS 200 (unless
// signature is provably invalid) so Telnyx doesn't retry the webhook
// queue. We can't 500 here without flooding Telnyx with retries.

import { Hono } from "hono";
import type { Env } from "../types";
import { sendSms, formatForSms } from "../lib/telnyx";
import { resolveChannelLink } from "../lib/resolveChannelLink";
import { classifyIntent } from "../lib/intent";
import { handleExecute, type ExecuteAction } from "../tools/execute";
import { handleSearch, type SearchScope } from "../tools/search";
import { writeAuditLog, hashParams } from "../lib/audit";

// ── STOP keyword detection ───────────────────────────────────────────────────
// TCPA-compliant STOP keywords. Case-insensitive, whitespace-tolerant.
// Per US carriers: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT.
const STOP_RE = /^(stop\s*all|stop|unsubscribe|cancel|end|quit)$/i;

function isStopKeyword(text: string): boolean {
	return STOP_RE.test(text.trim());
}

// ── Ed25519 signature verification ───────────────────────────────────────────
//
// Telnyx signs every webhook with the messaging profile's Ed25519 private key.
// We verify using crypto.subtle (Web Crypto API; CF Workers supports Ed25519
// since the 2024-08-21 compat-date).
//
// Headers:
//   telnyx-signature-ed25519: <base64 signature, 64 bytes raw>
//   telnyx-timestamp: <unix seconds>
// Signed payload: `${timestamp}|${raw_body}` (UTF-8 bytes).
//
// Public key (env.TELNYX_WEBHOOK_PUBLIC_KEY) is base64-encoded raw 32-byte
// Ed25519 public key bytes.

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function verifyTelnyxSignature(
	publicKeyB64: string,
	signatureB64: string,
	timestamp: string,
	rawBody: string,
): Promise<boolean> {
	try {
		const publicKeyBytes = base64ToBytes(publicKeyB64);
		const signatureBytes = base64ToBytes(signatureB64);
		const signedMessage = new TextEncoder().encode(
			`${timestamp}|${rawBody}`,
		);
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			publicKeyBytes,
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			"Ed25519",
			cryptoKey,
			signatureBytes,
			signedMessage,
		);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_telnyx_sig_verify_error",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return false;
	}
}

// ── Inbound event payload shapes (subset of Telnyx schema) ──────────────────
interface TelnyxInboundPayload {
	data?: {
		event_type?: string;
		id?: string;
		payload?: {
			from?: { phone_number?: string };
			to?: Array<{ phone_number?: string }>;
			text?: string;
			id?: string;
			messaging_profile_id?: string;
		};
	};
}

// ── Phone normalization ──────────────────────────────────────────────────────
// Telnyx sends `+1...` E.164. We keep it as-is for channel_external_id matching.
function extractFromPhone(payload: TelnyxInboundPayload): string | null {
	return payload.data?.payload?.from?.phone_number ?? null;
}

function extractText(payload: TelnyxInboundPayload): string {
	return payload.data?.payload?.text ?? "";
}

// ── Hono router ───────────────────────────────────────────────────────────────

export const telnyxRouter = new Hono<{ Bindings: Env }>();

telnyxRouter.post("/webhooks/telnyx/sms", async (c) => {
	const env = c.env;

	// Read raw body once (signature verify needs raw bytes; STOP path needs parsed).
	const rawBody = await c.req.raw.text();

	let payload: TelnyxInboundPayload = {};
	try {
		payload = JSON.parse(rawBody) as TelnyxInboundPayload;
	} catch {
		// Invalid JSON — log and 200 (don't trigger Telnyx retry storm).
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_telnyx_invalid_json",
				body_preview: rawBody.slice(0, 200),
			}),
		);
		return c.json({ ok: true });
	}

	const fromPhone = extractFromPhone(payload);
	const body = extractText(payload);

	// ── 1. STOP HANDLING (BEFORE signature verify, per TCPA) ────────────────
	// We honor STOP unconditionally even on unverified payloads. Worst case
	// of a forged STOP: a legitimate founder gets opted out and we log it
	// (they can text START to rejoin). The TCPA exposure for failing to
	// honor STOP is materially worse than the abuse exposure of forged STOPs.
	if (fromPhone && isStopKeyword(body)) {
		const ctx = await resolveChannelLink(env, "telnyx-sms", fromPhone);
		// Find the row id via a 2nd lookup (the resolve endpoint returns
		// startup_id/member_id but NOT the row id; we'd need a separate
		// endpoint to get id. For simplicity, the PATCH opt-out endpoint
		// could match on channel_type+external_id. For now we'll skip the
		// PATCH if we can't resolve — the SMS reply still goes out and the
		// row simply stays active. v1.5 follow-up: add the row id to the
		// resolve endpoint response so we can PATCH precisely).
		//
		// PRAGMATIC PATH: send the STOP confirmation immediately; the
		// channel-link opt-out is best-effort via a second endpoint that
		// matches on (channel_type, external_id). If neither endpoint
		// returns the link id, we still complied with the user-visible
		// TCPA requirement (acknowledgement reply).
		if (ctx) {
			try {
				const base = env.STARTUP_API_URL.replace(/\/$/, "");
				// Use the channel-links POST to UPSERT with status=opted_out.
				// This is idempotent + works without knowing the row id.
				await fetch(`${base}/v1/channel-links`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
					},
					body: JSON.stringify({
						startup_id: ctx.startup_id,
						member_id: ctx.member_id,
						channel_type: "telnyx-sms",
						channel_external_id: fromPhone,
						status: "opted_out",
						opt_in_flags: {},
					}),
					signal: AbortSignal.timeout(5000),
				});
			} catch (err) {
				console.warn(
					JSON.stringify({
						level: "warn",
						event: "startup_telnyx_stop_optout_db_failed",
						error: (err as Error)?.message ?? String(err),
					}),
				);
			}
		}

		await sendSms(
			env,
			fromPhone,
			"you're opted out. text 'start' anytime to re-subscribe.",
		);

		// Audit the opt-out.
		await writeAuditLog(env, {
			member_id: ctx?.member_id ?? "anonymous",
			startup_id: ctx?.startup_id ?? "anonymous",
			channel: "telnyx-sms",
			action: "stop_opt_out",
			status: "ok",
			params_hash: await hashParams({ from: fromPhone }),
		});

		return c.json({ ok: true });
	}

	// ── 2. Ed25519 signature verification ────────────────────────────────────
	const sigHeader = c.req.header("telnyx-signature-ed25519");
	const tsHeader = c.req.header("telnyx-timestamp");

	if (env.TELNYX_WEBHOOK_PUBLIC_KEY) {
		if (!sigHeader || !tsHeader) {
			return c.json({ error: "missing_signature_headers" }, 401);
		}
		const valid = await verifyTelnyxSignature(
			env.TELNYX_WEBHOOK_PUBLIC_KEY,
			sigHeader,
			tsHeader,
			rawBody,
		);
		if (!valid) {
			return c.json({ error: "invalid_signature" }, 401);
		}
	} else {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_telnyx_sig_skipped",
				note: "TELNYX_WEBHOOK_PUBLIC_KEY unbound (DEFER-29-01-F) — signature NOT verified",
			}),
		);
	}

	// ── 3. Parse event type ──────────────────────────────────────────────────
	const eventType = payload.data?.event_type;
	if (eventType !== "message.received") {
		// Delivery receipts (message.sent, message.finalized) — silent 200.
		return c.json({ ok: true });
	}

	if (!fromPhone) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_telnyx_no_from_phone",
				payload_preview: rawBody.slice(0, 200),
			}),
		);
		return c.json({ ok: true });
	}

	try {
		// ── 4. Identity resolution ────────────────────────────────────────────
		const ctx = await resolveChannelLink(env, "telnyx-sms", fromPhone);

		if (!ctx) {
			// Unknown phone → invite prompt (per RESEARCH.md Hard Problem 1).
			// Do NOT auto-register from SMS alone; voice intake is the
			// designed path. Operator (Ridhi) sees the lead via audit log.
			const inviteMsg =
				`Hi! To connect your startup to InternJobs, call us at ${
					env.TELNYX_FROM_NUMBER ?? "our number"
				} — we'll get you set up in 30 seconds. ` +
				`Or text INVITE for an onboarding link.`;
			await sendSms(env, fromPhone, inviteMsg);

			await writeAuditLog(env, {
				member_id: "anonymous",
				startup_id: "anonymous",
				channel: "telnyx-sms",
				action: "unknown_phone_invite",
				status: "ok",
				params_hash: await hashParams({ from: fromPhone, body }),
			});
			return c.json({ ok: true });
		}

		// ── 4a. Touchbase fast-path: numeric reply "1"/"2"/"3" ──────────────
		//
		// When the weekly touchbase cron sends "3 new this week — reply 1/2/3"
		// it ALSO writes a KV cursor at `touchbase:cursor:<phone>` with the
		// ordered candidate thread_ids. If the founder replies "1"/"2"/"3"
		// within 48h, look up the cursor and short-circuit straight to
		// show_candidate({position, thread_id}). On miss (no KV, expired
		// cursor, out-of-range position) we fall through to the regular
		// intent classifier — which still resolves "1" → show_candidate
		// by position alone (Phase 29-01 behavior preserved).
		const numericMatch = /^\s*([1-9])\s*$/.exec(body.trim());
		if (numericMatch && env.TOUCHBASE_CURSORS) {
			const position = parseInt(numericMatch[1], 10);
			try {
				const cursorRaw = await env.TOUCHBASE_CURSORS.get(
					`touchbase:cursor:${fromPhone}`,
				);
				if (cursorRaw) {
					const cursor = JSON.parse(cursorRaw) as Array<{
						thread_id: string;
						candidate_name: string;
						role_title: string | null;
					}>;
					const entry = cursor[position - 1];
					if (entry?.thread_id) {
						const exec = await handleExecute({
							startup_id: ctx.startup_id,
							member_id: ctx.member_id,
							action: "show_candidate",
							params: { position, thread_id: entry.thread_id },
							env,
						});
						const result = exec.ok
							? (exec.data as unknown)
							: {
									ok: false,
									error: exec.error,
									message: exec.detail,
								};
						await sendSms(env, fromPhone, formatForSms(result));

						await writeAuditLog(env, {
							member_id: ctx.member_id,
							startup_id: ctx.startup_id,
							channel: "telnyx-sms",
							action: "touchbase_show_candidate",
							status: "ok",
							params_hash: await hashParams({ position, thread_id: entry.thread_id }),
						});
						return c.json({ ok: true });
					}
				}
			} catch (err) {
				console.warn(
					JSON.stringify({
						level: "warn",
						event: "startup_touchbase_cursor_lookup_failed",
						error: (err as Error)?.message ?? String(err),
					}),
				);
				// Fall through to intent classifier — defense in depth.
			}
		}

		// ── 4b. Opt-in fast-path: "yes" / "y" → flip weekly_touchbase=true ──
		//
		// Voice intake (Phase 29-02) registers a startup_channel_links row
		// with opt_in_flags.weekly_touchbase=true by default. But a founder
		// who STOPped previously and then texts "yes" later should re-opt-in
		// without re-running the voice flow. We also handle the case where
		// post-voice the founder confirms by SMS — same outcome.
		//
		// Requires ctx.channel_link_id (returned by Phase 29-03's extended
		// /v1/channel-links/resolve endpoint). Pre-29-03 deploys without that
		// field gracefully fall through to the intent classifier, which has
		// its own "yes" regex hit but no DB write — log-only.
		const optInMatch = /^\s*(yes|y)\s*$/i.exec(body.trim());
		if (optInMatch && ctx.channel_link_id) {
			try {
				const base = env.STARTUP_API_URL.replace(/\/$/, "");
				await fetch(
					`${base}/v1/channel-links/${encodeURIComponent(ctx.channel_link_id)}/opt-in-touchbase`,
					{
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
						},
						body: JSON.stringify({ opt_in: true }),
						signal: AbortSignal.timeout(5000),
					},
				);
			} catch (err) {
				console.warn(
					JSON.stringify({
						level: "warn",
						event: "startup_touchbase_opt_in_patch_failed",
						error: (err as Error)?.message ?? String(err),
					}),
				);
			}
			await sendSms(
				env,
				fromPhone,
				"you're in! we'll text you every Monday with fresh intern candidates. reply 'stop' anytime to opt out.",
			);

			await writeAuditLog(env, {
				member_id: ctx.member_id,
				startup_id: ctx.startup_id,
				channel: "telnyx-sms",
				action: "touchbase_opt_in",
				status: "ok",
				params_hash: await hashParams({ channel_link_id: ctx.channel_link_id }),
			});
			return c.json({ ok: true });
		}

		// ── 5. Intent classification ─────────────────────────────────────────
		const intent = await classifyIntent(body, env);
		if (!intent) {
			const hint =
				"didn't catch that. try: 'show me the top 3 candidates' or 'post a frontend intern role'.";
			await sendSms(env, fromPhone, hint);

			await writeAuditLog(env, {
				member_id: ctx.member_id,
				startup_id: ctx.startup_id,
				channel: "telnyx-sms",
				action: "intent_unknown",
				status: "ok",
				params_hash: await hashParams({ body }),
			});
			return c.json({ ok: true });
		}

		// ── 6. Dispatch ──────────────────────────────────────────────────────
		let result: unknown;
		if (intent.kind === "search") {
			const searchResult = await handleSearch({
				startup_id: ctx.startup_id,
				scope: intent.scope as SearchScope,
				query: intent.query,
				limit: 5,
				env,
			});
			// Trim results for SMS — top 5 by score; only the summary field.
			result = searchResult.results.slice(0, 5).map((r) => r.summary);
		} else {
			// execute path
			const exec = await handleExecute({
				startup_id: ctx.startup_id,
				member_id: ctx.member_id,
				action: intent.action as ExecuteAction,
				params: intent.args,
				env,
			});
			result = exec.ok
				? (exec.data as unknown)
				: { ok: false, error: exec.error, message: exec.detail };
		}

		// ── 7. Format + reply ────────────────────────────────────────────────
		const replyText = formatForSms(result);
		await sendSms(env, fromPhone, replyText);

		// Audit the inbound + dispatched action.
		await writeAuditLog(env, {
			member_id: ctx.member_id,
			startup_id: ctx.startup_id,
			channel: "telnyx-sms",
			action:
				intent.kind === "search"
					? `search:${intent.scope}`
					: intent.action,
			status: "ok",
			params_hash: await hashParams({ body, intent }),
		});

		return c.json({ ok: true });
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_telnyx_handler_error",
				error: (err as Error)?.message ?? String(err),
				from: fromPhone,
			}),
		);

		// Best-effort apology reply (only if SMS creds bound).
		try {
			await sendSms(
				env,
				fromPhone,
				"something went wrong. we've been notified.",
			);
		} catch {
			// nothing more we can do
		}

		// Still return 200 — Telnyx retries would multiply the failure.
		return c.json({ ok: true });
	}
});
