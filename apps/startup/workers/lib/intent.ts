// apps/startup/workers/lib/intent.ts
// v1.4 Phase 29-01 — Intent classifier for inbound SMS.
//
// Two-layer strategy:
//   1. Regex fast-path (sync) — STOP/START, numeric reply ("1", "2", "3"),
//      yes/no, and explicit keyword commands. Returns immediately with no LLM call.
//   2. LLM fallback (async) — natural-language SMS like
//      "show me the top 3 candidates" or "post a frontend intern role".
//      Uses Workers AI binding (env.AI.run('@cf/meta/llama-3.1-8b-instruct', ...))
//      with a structured prompt + JSON output. Falls back to null on
//      parse/binding failure (caller replies with usage hint).
//
// Return contract:
//   IntentResult | null
//   - kind='execute' → action + args for handleExecute()
//   - kind='search'  → scope + query for handleSearch()
//   - null           → couldn't classify; caller sends usage hint

import type { Env } from "../types";

export type IntentResult =
	| { kind: "execute"; action: string; args: Record<string, unknown> }
	| { kind: "search"; scope: string; query: string };

const SUPPORTED_ACTIONS = new Set([
	"search_candidates",
	"show_candidate",
	"post_role",
	"reply_to_candidate",
	"update_role",
	"archive_role",
	"mark_candidate",
	"register_startup",
	"opt_in_touchbase",
]);

/**
 * Regex pre-pass. Returns an IntentResult on definite hit, null on miss
 * (caller falls through to LLM). Pure / sync — safe to unit-test.
 *
 * NOTE: STOP handling is NOT here — that lives in routes/telnyx.ts and
 * runs BEFORE intent classification per TCPA compliance ordering.
 */
export function classifyIntentRegex(text: string): IntentResult | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const lc = trimmed.toLowerCase();

	// Numeric reply: "1", "2", ..., "9" → show_candidate at position
	const numMatch = trimmed.match(/^([1-9])$/);
	if (numMatch) {
		return {
			kind: "execute",
			action: "show_candidate",
			args: { position: parseInt(numMatch[1], 10) },
		};
	}

	// START → re-opt-in to weekly touchbase
	if (lc === "start") {
		return {
			kind: "execute",
			action: "opt_in_touchbase",
			args: { weekly_touchbase: true },
		};
	}

	// YES / Y → opt_in confirmation after Voice AI onboarding asks
	if (lc === "yes" || lc === "y") {
		return {
			kind: "execute",
			action: "opt_in_touchbase",
			args: { weekly_touchbase: true },
		};
	}
	// NO / N → opt_out of weekly touchbase but stay opted-in for transactional
	if (lc === "no" || lc === "n") {
		return {
			kind: "execute",
			action: "opt_in_touchbase",
			args: { weekly_touchbase: false },
		};
	}

	return null;
}

/**
 * LLM fallback classifier. Sends a structured prompt to Workers AI and parses
 * the JSON response. Returns null on any failure (no AI binding, network
 * error, parse error, or LLM returns "unknown"). Caller treats null as "send
 * usage hint reply".
 *
 * Cost: bge-base-en is free per neuron; llama-3.1-8b-instruct billed per
 * neuron. Single 200-token prompt + 100-token response = ~negligible at pilot
 * volume.
 */
export async function classifyIntent(
	text: string,
	env: Env,
): Promise<IntentResult | null> {
	// 1. Regex fast-path
	const regexHit = classifyIntentRegex(text);
	if (regexHit) return regexHit;

	// 2. LLM fallback
	if (!env.AI) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_intent_no_ai_binding",
				text_preview: text.slice(0, 60),
			}),
		);
		return null;
	}

	const systemPrompt = [
		"You are an intent classifier for an SMS-based startup founder assistant.",
		"Classify the user's text into ONE action from this list (or 'unknown'):",
		"  - search_candidates: founder wants to find candidates matching a query",
		"  - show_candidate: founder wants details on a specific candidate by position (e.g., '1', '2')",
		"  - post_role: founder wants to post a new role/job opening",
		"  - reply_to_candidate: founder wants to send a reply to a candidate",
		"  - update_role: founder wants to edit an existing role",
		"  - archive_role: founder wants to close/fill a role",
		"  - mark_candidate: founder wants to mark a candidate (interested/shortlisted/rejected/etc.)",
		"  - register_startup: founder wants to sign up / register their startup",
		"  - opt_in_touchbase: founder wants to opt in/out of weekly updates",
		"  - unknown: text is unclear, off-topic, or you can't determine intent",
		"",
		"Respond ONLY with valid JSON in this shape:",
		'  {"action": "<one of the above>", "args": {<action-specific arguments>}}',
		"",
		"Examples:",
		'Input: "show me the top 3 candidates" → {"action":"search_candidates","args":{"query":"top candidates","limit":3}}',
		'Input: "post a frontend intern role" → {"action":"post_role","args":{"title":"frontend intern","description":"frontend intern role"}}',
		'Input: "shortlist the second one" → {"action":"mark_candidate","args":{"position":2,"mark":"shortlisted"}}',
		'Input: "what is the weather" → {"action":"unknown","args":{}}',
	].join("\n");

	try {
		const raw = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: text },
			],
			max_tokens: 200,
		});

		// Workers AI response shape: { response: "..." } for chat completion.
		const responseText =
			(raw as { response?: string }).response ??
			(raw as { result?: { response?: string } }).result?.response ??
			"";
		if (!responseText) return null;

		// Extract JSON from response (the model sometimes wraps in prose).
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;
		const parsed = JSON.parse(jsonMatch[0]) as {
			action?: string;
			args?: Record<string, unknown>;
		};

		const action = parsed.action ?? "unknown";
		const args = parsed.args ?? {};
		if (!SUPPORTED_ACTIONS.has(action) || action === "unknown") return null;

		if (action === "search_candidates") {
			return {
				kind: "search",
				scope: "candidates",
				query: (args.query as string | undefined) ?? text,
			};
		}
		return { kind: "execute", action, args };
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_intent_llm_failed",
				error: (err as Error)?.message ?? String(err),
				text_preview: text.slice(0, 60),
			}),
		);
		return null;
	}
}
