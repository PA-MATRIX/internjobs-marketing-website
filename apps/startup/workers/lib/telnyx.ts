// apps/startup/workers/lib/telnyx.ts
// v1.4 Phase 29-01 — Outbound SMS via Telnyx REST.
//
// Public API:
//   sendSms(env, to, text)             — fire-and-forget POST /v2/messages
//   formatForSms(result, options?)     — convert MCP handler results to SMS-safe plain text
//
// Ops-deferred guards: if env.TELNYX_API_KEY or env.TELNYX_FROM_NUMBER are
// unbound (DEFER-29-01-E / G), sendSms() logs a warning and returns without
// throwing. This matches the routes/admin.ts sendInstallSms() pattern from
// Phase 28-04.
//
// SMS length: Telnyx auto-segments at 160 chars (single SMS) and 153 chars
// per segment for multi-part. We allow up to 1580 chars (well under the
// hard 1600-char concatenated limit) before truncating + appending an ellipsis.

import type { Env } from "../types";

const MAX_SMS_LENGTH = 1580;

/**
 * Send an outbound SMS via Telnyx. Fire-and-forget — never throws.
 *
 * Behavior matrix:
 *   - !env.TELNYX_API_KEY     → log warning, return (ops-deferred guard)
 *   - !env.TELNYX_FROM_NUMBER → log warning, return (ops-deferred guard)
 *   - 2xx response             → log success, return
 *   - 429 (rate limit)         → log retry-after header, return (no retry for pilot)
 *   - other non-2xx            → log status + body, return
 *   - network/timeout error    → log + return
 *
 * The caller (routes/telnyx.ts inbound handler) MUST NOT block on this —
 * the webhook response should be ≤200ms.
 */
export async function sendSms(
	env: Env,
	to: string,
	text: string,
): Promise<void> {
	if (!env.TELNYX_API_KEY) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_sendsms_no_api_key",
				note: "TELNYX_API_KEY unbound (DEFER-29-01-E) — sms not sent",
				to_preview: to.slice(0, 6),
			}),
		);
		return;
	}
	if (!env.TELNYX_FROM_NUMBER) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_sendsms_no_from_number",
				note: "TELNYX_FROM_NUMBER unbound (DEFER-29-01-G) — sms not sent",
				to_preview: to.slice(0, 6),
			}),
		);
		return;
	}

	// Truncate over-long messages. Truncation marker uses ASCII ellipsis
	// for SMS-segment-safety (single-byte UTF-8).
	const body =
		text.length > MAX_SMS_LENGTH
			? text.slice(0, MAX_SMS_LENGTH - 14) + "... [truncated]"
			: text;

	const payload: Record<string, unknown> = {
		from: env.TELNYX_FROM_NUMBER,
		to,
		text: body,
	};
	if (env.TELNYX_MESSAGING_PROFILE_ID) {
		payload.messaging_profile_id = env.TELNYX_MESSAGING_PROFILE_ID;
	}

	try {
		const res = await fetch("https://api.telnyx.com/v2/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.TELNYX_API_KEY}`,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10000),
		});

		if (res.ok) {
			console.log(
				JSON.stringify({
					level: "info",
					event: "startup_sendsms_sent",
					to_preview: to.slice(0, 6),
					body_chars: body.length,
				}),
			);
			return;
		}

		if (res.status === 429) {
			const retryAfter = res.headers.get("retry-after");
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_sendsms_rate_limited",
					retry_after: retryAfter,
					to_preview: to.slice(0, 6),
				}),
			);
			return;
		}

		const errBody = await res.text().catch(() => "");
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_sendsms_non_ok",
				status: res.status,
				body_preview: errBody.slice(0, 200),
				to_preview: to.slice(0, 6),
			}),
		);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_sendsms_error",
				error: (err as Error)?.message ?? String(err),
				to_preview: to.slice(0, 6),
			}),
		);
	}
}

/**
 * Convert an MCP handler result to a plain-text SMS-safe string.
 *
 * Strategy:
 *   - string  → return as-is (truncate)
 *   - array   → join with "\n" as a 1-indexed numbered list
 *   - object  → flatten primitive fields as "key: value" lines
 *   - other   → JSON.stringify fallback
 *
 * URLs are preserved verbatim (no markdown stripping); the caller is expected
 * to construct strings that don't contain markdown bold/italic/link syntax.
 * Output is hard-capped at MAX_SMS_LENGTH to match sendSms() truncation.
 */
export function formatForSms(result: unknown): string {
	if (result == null) return "(no result)";
	if (typeof result === "string") return cap(result);

	if (Array.isArray(result)) {
		const lines = result
			.map((item, i) => `${i + 1}. ${stringifyItem(item)}`)
			.join("\n");
		return cap(lines);
	}

	if (typeof result === "object") {
		const obj = result as Record<string, unknown>;
		// Special-case known shapes for better SMS readability.
		// register_startup: { ok, startup_id, agent_email, mcp_install_snippet }
		if (typeof obj.ok === "boolean" && "agent_email" in obj) {
			if (obj.ok) {
				return cap(
					`registered! check your work email for the welcome link + mcp setup snippet. your agent email: ${obj.agent_email ?? "(pending)"}`,
				);
			}
			const msg = (obj.message as string | undefined) ?? "registration failed";
			return cap(msg);
		}
		// show_candidate: { candidate_name, role_title, application_summary, thread_id, position }
		if ("candidate_name" in obj && "position" in obj) {
			const parts: string[] = [
				`#${obj.position}: ${obj.candidate_name}`,
			];
			if (obj.role_title) parts.push(`role: ${obj.role_title}`);
			if (obj.application_summary) parts.push(`${obj.application_summary}`);
			return cap(parts.join("\n"));
		}
		// Generic object — flatten primitives only (skip nested objects/arrays).
		const lines: string[] = [];
		for (const [k, v] of Object.entries(obj)) {
			if (
				typeof v === "string" ||
				typeof v === "number" ||
				typeof v === "boolean"
			) {
				lines.push(`${k}: ${v}`);
			}
		}
		return cap(lines.length > 0 ? lines.join("\n") : JSON.stringify(obj));
	}

	return cap(String(result));
}

function stringifyItem(item: unknown): string {
	if (item == null) return "(empty)";
	if (typeof item === "string") return item;
	if (typeof item === "object") {
		const obj = item as Record<string, unknown>;
		// Common search-result shape: { id, summary, score }
		if (typeof obj.summary === "string") return obj.summary;
		if (typeof obj.title === "string") return obj.title as string;
		if (typeof obj.name === "string") return obj.name as string;
		return JSON.stringify(obj).slice(0, 120);
	}
	return String(item);
}

function cap(s: string): string {
	if (s.length <= MAX_SMS_LENGTH) return s;
	return s.slice(0, MAX_SMS_LENGTH - 14) + "... [truncated]";
}
