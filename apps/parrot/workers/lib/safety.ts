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
// API schema (Lakera v2 — verify post-Cisco-acquisition before runtime use):
//   POST https://api.lakera.ai/v2/guard
//   Auth: Authorization: Bearer <LAKERA_GUARD_API_KEY>
//   Body: { messages: [{ role: "user", content: <text> }], project_id?: <id> }
//   Response: { flagged: bool, results: [{ categories: { prompt_injection: <0-1> }, ... }] }

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

		// Lakera v2 schema (assumed — adjust based on signup-time verification):
		//   { flagged: bool, results: [{ categories: { prompt_injection: <0-1> }, ... }] }
		// Pre-acquisition v1 schema was:
		//   { results: [{ categories: { prompt_injection: <0-1> }, flagged: bool }] }
		const topFlagged = raw?.flagged === true;
		const result = raw?.results?.[0];
		if (!result && topFlagged === false) {
			return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw };
		}

		const injectionScore = result?.categories?.prompt_injection ?? 0;
		const isFlagged = topFlagged || result?.flagged === true;

		let action = "passed";
		let reason: string | null = null;

		if (isFlagged) {
			const categories = result?.categories ?? {};
			const topCategory = Object.entries(categories)
				.filter(([, v]) => typeof v === "number" && v > 0)
				.sort(([, a], [, b]) => (b as number) - (a as number))[0];
			reason = topCategory?.[0] ?? "unknown";
			action = "flagged"; // caller applies hard-block rule (score >= 0.8 → blocked)
		}

		return { flagged: isFlagged, action, reason, score: injectionScore, raw };
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
