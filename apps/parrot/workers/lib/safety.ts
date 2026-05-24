// v1.3 Phase 20 SAFETY-01: Lakera Guard pre-LLM screening helper (Cloudflare Worker).
//
// NOT shared with the Node student app — different runtimes, different env
// injection. Node version: apps/app/src/safety/screen.mjs
//
// Fail-open contract: this function NEVER throws. On Lakera timeout (>1s),
// 5xx, or network error, returns { flagged: false, action: 'passed_lakera_unavailable', ... }
// and the caller proceeds normally. Lakera downtime must never block student SMS or email ingest.
//
// Scope discipline (SAFETY-SCOPE-01):
//   Mattermost inbound does NOT pass through this helper. Mattermost is polled
//   via EmployeeMailboxDO alarm (not through inbound-email.ts), and is
//   intentionally excluded from Lakera screening — internal channel, wrong risk
//   profile, wastes quota. This exclusion is architectural, enforced by the
//   call sites that import screenMessage.
//
// API schema (Lakera v2 — VERIFIED 2026-05-24 via live probe from the
// internjobs-ai-student-app Fly machine against the production key):
//   POST https://api.lakera.ai/v2/guard
//   Auth: Authorization: Bearer <LAKERA_GUARD_API_KEY>
//   Body: { messages: [{ role: "user", content: <text> }] }
//   Response is binary — no per-category scores in v2:
//     benign:    { "flagged": false, "metadata": { "request_uuid": "..." } }
//     injection: { "flagged": true,  "metadata": { "request_uuid": "..." } }
//   That is the entire payload. There is no `results[]`, no `categories`,
//   no numeric confidence. The previous v1 shape
//     { results: [{ categories: { prompt_injection: <0-1> }, flagged: bool }] }
//   was deprecated by Lakera in the Cisco AI Defense rebrand and is gone.
//   We map `flagged: true` → score=1 / reason="lakera_flagged" so the
//   downstream `safety_events` row + hard-block gate stays meaningful;
//   `flagged: false` → score=0 / reason=null. Tier: pending dashboard
//   sign-in confirmation (see infra/LAKERA-PRICING.md).

import type { Env } from "../types";

const LAKERA_ENDPOINT = "https://api.lakera.ai/v2/guard"; // adjust at runtime if Cisco moved the endpoint
const TIMEOUT_MS = 1000; // hard 1s timeout — fail-open on breach

export interface ScreenResult {
	flagged: boolean;
	/** 'blocked' | 'flagged' | 'passed' | 'passed_lakera_unavailable' */
	action: string;
	/** Top Lakera category label, e.g. "prompt_injection" */
	reason: string | null;
	/** Confidence score 0-1 */
	score: number | null;
	/** Full Lakera response body (for logging) */
	raw: unknown;
}

interface LakeraResultRow {
	categories?: Record<string, number>;
	flagged?: boolean;
}
interface LakeraResponse {
	flagged?: boolean;
	metadata?: { request_uuid?: string };
	// `results` is gone from v2 — kept here as forward-compat shim only.
	results?: LakeraResultRow[];
}

/**
 * Screen a message body for prompt injection and policy violations.
 *
 * @param text    Raw message text to screen (email body or other inbound text).
 * @param env     Parrot Worker Env binding — reads env.LAKERA_GUARD_API_KEY.
 */
export async function screenMessage(text: string, env: Env): Promise<ScreenResult> {
	const apiKey = env.LAKERA_GUARD_API_KEY;
	if (!apiKey) {
		// No key configured — fail-open silently.
		return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch(LAKERA_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: String(text || "").slice(0, 4000) }],
			}),
			signal: controller.signal,
		});

		if (!res.ok) {
			console.warn(JSON.stringify({ level: "warn", event: "lakera_screen_non2xx", status: res.status }));
			return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
		}

		const raw = (await res.json().catch(() => null)) as LakeraResponse | null;

		// Parse the v2 response — see schema block at top of file.
		// v2 is binary: { flagged: bool, metadata: { request_uuid: string } }.
		// There is no per-category score, so we map flagged → score=1/0 to
		// preserve the ScreenResult contract (callers + safety_events.score
		// column expect a number). Forward-compat: if Lakera ever re-introduces
		// a per-category numeric score under results[0].categories, we honor it.
		if (raw === null || typeof raw !== "object") {
			return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw };
		}

		const topFlagged = raw?.flagged === true;
		const legacyResult = Array.isArray(raw?.results) ? raw.results[0] : null;
		const legacyScore = legacyResult?.categories?.prompt_injection;
		const isFlagged = topFlagged || legacyResult?.flagged === true;

		let score: number;
		let reason: string | null = null;
		let action = "passed";

		if (typeof legacyScore === "number") {
			// Legacy v1 shape (unexpected in v2 — kept for resilience)
			score = legacyScore;
			const categories = legacyResult?.categories ?? {};
			const topCategory = Object.entries(categories)
				.filter(([, v]) => typeof v === "number" && v > 0)
				.sort(([, a], [, b]) => (b as number) - (a as number))[0];
			if (isFlagged) {
				reason = topCategory?.[0] ?? "lakera_flagged";
				action = "flagged";
			}
		} else {
			// v2 binary path — what production actually returns
			score = isFlagged ? 1 : 0;
			if (isFlagged) {
				reason = "lakera_flagged";
				action = "flagged";
			}
		}

		return { flagged: isFlagged, action, reason, score, raw };
	} catch (err: unknown) {
		const isTimeout = (err as { name?: string })?.name === "AbortError";
		console.warn(
			JSON.stringify({
				level: "warn",
				event: isTimeout ? "lakera_timeout" : "lakera_network_error",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
	} finally {
		clearTimeout(timeoutId);
	}
}
