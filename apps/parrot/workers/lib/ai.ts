// v1.2 Phase 12 Wave 1: Parrot LLM helpers — Workers AI via Cloudflare AI Gateway.
//
// Parrot LLM calls route through Cloudflare AI Gateway (NOT direct Workers AI REST).
// Rationale: per-employee daily usage caps + prompt caching + per-user analytics.
//
// Contrast: the student app at apps/app/ still uses direct Workers AI REST as of
// 2026-05-19 (see apps/app/src/workflows/student-inbound.mjs and
// apps/app/src/embeddings.mjs). The student app has a single shared agent identity
// (Maya), so there's no per-user quota concept to enforce — direct REST is the
// simplest viable transport for that pattern.
//
// Parrot has one human employee per request (multiple humans, all sending real
// inbound traffic through their own DOs), so we WANT a per-user quota gate at the
// LLM layer. AI Gateway gives us that via `cf-aig-metadata.user_id` + a dashboard
// rule. If student-app rate limiting becomes a need, that's a separate v1.3 task —
// DO NOT migrate it as a side-effect of Phase 12.
//
// See memory: project-llm-via-ai-gateway.md (forthcoming)
//
// Gateway URL pattern:
//   POST https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{PARROT_AI_GATEWAY_ID}/workers-ai/{model}
//   Headers:
//     Authorization: Bearer {CLOUDFLARE_AI_API_TOKEN}
//     cf-aig-metadata: {"user_id": "<employee_clerk_user_id>"}   // per-employee quota enforcement + analytics
//     cf-aig-cache-ttl: 3600                                     // prompt cache (email) or 1800 (chat)
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
//   cloudflare/skills: agents-sdk — Agent state, scheduling, onMessage patterns
//   cloudflare/skills: durable-objects — DO alarm self-reschedule, idempotent inserts

import type { Env } from "../types";

export interface ExtractedTodo {
	title: string;
	preview?: string;
	urgency_score: number; // 0-100 LLM-assigned
	deadline_at?: string | null;
	mentioned_actors?: string[];
	is_mention: boolean;
}

/**
 * JSON schema fed to Workers AI `response_format` mode. kimi-k2.6 supports
 * `response_format: { type: "json_schema", json_schema: ... }` natively, so
 * the LLM emits valid JSON matching this shape directly — no regex parsing
 * needed downstream.
 *
 * Schema invariants:
 *   - title required, 120-char cap (matches a typical UI card line)
 *   - preview optional, 300-char cap (1-line snippet)
 *   - urgency_score integer 0–100 (LLM-assigned from language cues)
 *   - deadline_at nullable ISO-8601 or null
 *   - mentioned_actors array of strings (names parsed from message)
 *   - is_mention boolean — true if message @-mentions the recipient
 */
export const TODO_EXTRACTION_SCHEMA = {
	type: "object",
	properties: {
		todos: {
			type: "array",
			items: {
				type: "object",
				required: ["title", "urgency_score", "is_mention"],
				properties: {
					title: { type: "string", maxLength: 120 },
					preview: { type: "string", maxLength: 300 },
					urgency_score: { type: "integer", minimum: 0, maximum: 100 },
					deadline_at: { type: ["string", "null"] },
					mentioned_actors: { type: "array", items: { type: "string" } },
					is_mention: { type: "boolean" },
				},
			},
		},
	},
} as const;

/**
 * Low-level AI Gateway caller.
 *
 * Routes to: https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/workers-ai/{model}
 *
 * @param messages    - OpenAI-style chat messages (role + content).
 * @param clerkUserId - Employee's stable Clerk user_id (NOT email). Used for
 *                      cf-aig-metadata.user_id to enable per-employee daily caps
 *                      configured in the CF AI Gateway dashboard.
 * @param cacheTtl    - cf-aig-cache-ttl in seconds. Use 3600 for email, 1800 for chat.
 *                      Use 0 for any non-idempotent flow (none in Phase 12).
 * @param env         - Worker env (CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
 *                      PARROT_AI_GATEWAY_ID, KIMI_MODEL).
 *
 * Returns null on missing config, 429 quota, or any non-2xx response — the
 * caller MUST handle null gracefully (todos extraction is best-effort; failure
 * never blocks email storage or alarm rescheduling).
 */
export async function callAiGateway(
	messages: Array<{ role: string; content: string }>,
	clerkUserId: string,
	cacheTtl: number,
	env: Env,
): Promise<{ result?: { response?: string }; success?: boolean } | null> {
	const model = env.KIMI_MODEL ?? "@cf/moonshotai/kimi-k2.6";
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_AI_API_TOKEN;
	const gatewayId = env.PARROT_AI_GATEWAY_ID;

	if (!accountId || !apiToken || !gatewayId) {
		console.warn(
			"callAiGateway: missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN / PARROT_AI_GATEWAY_ID — skipping",
		);
		return null;
	}

	const resp = await fetch(
		// NB: do NOT encodeURIComponent the model — its slashes (`@cf/moonshotai/...`)
		// are routing segments the AI Gateway expects literally. Live-verified
		// 2026-05-19: encoding turns `@cf/moonshotai/kimi-k2.6` into
		// `%40cf%2fmoonshotai%2fkimi-k2.6` which the gateway 400s as
		// "Could not route to /accounts/{id}/ai/@cf/moonshotai/kimi-k2.6".
		`https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
				"cf-aig-metadata": JSON.stringify({ user_id: clerkUserId }),
				"cf-aig-cache-ttl": String(cacheTtl),
			},
			body: JSON.stringify({
				messages,
				response_format: {
					type: "json_schema",
					json_schema: TODO_EXTRACTION_SCHEMA,
				},
				// kimi-k2.6 is a reasoning model — its CoT lives in
			// choices[0].message.reasoning_content and burns through tokens
			// before message.content is written. 512 is too tight (live-tested
			// 2026-05-19: reasoning ate the budget, content came back null).
			// 2000 leaves ~1500 for reasoning + ~500 for the final JSON body.
			// Non-reasoning fallback models (e.g., llama-3.3-70b-instruct-fp8-fast)
			// would be fine with 512, but the budget is harmless for them.
			max_tokens: 2000,
			}),
		},
	);

	if (resp.status === 429) {
		// Employee has hit their daily AI Gateway quota.
		// Caller must: (1) log an audit_events row, (2) return [] — do NOT crash.
		// Audit logging is the DO caller's job (only it has access to this.ctx.storage.sql).
		console.warn(
			`callAiGateway: 429 quota exceeded for employee ${clerkUserId}`,
		);
		return null; // Signal back to extractTodosFromText() for audit logging
	}

	if (!resp.ok) {
		// Capture the response body so we can diagnose model-specific
		// validation failures (schema rejection, content filter, etc.)
		// without needing the AI Gateway dashboard's log-content feature
		// (which adds latency on every call when enabled globally).
		const errBody = await resp.text().catch(() => "<unreadable>");
		console.error(
			`callAiGateway: AI Gateway ${resp.status} for employee ${clerkUserId}: ${errBody.slice(0, 500)}`,
		);
		return null;
	}

	return (await resp.json()) as {
		// Workers AI native (older / non-reasoning models)
		result?: {
			response?: string;
			// OpenAI-compat shape (kimi-k2.6 + other reasoning models)
			choices?: Array<{
				message?: { content?: string | null; reasoning_content?: string };
				finish_reason?: string;
			}>;
		};
		success?: boolean;
	};
}

/**
 * Extract action items from an email body or chat message text.
 *
 * Wave 1 ships this function exported but NOT yet called. Wave 2 wires the
 * call sites in EmployeeMailboxDO.createEmail() (email path) and the DO
 * alarm (Mattermost chat path).
 *
 * @param text         - Email or chat content to extract todos from (trimmed to 8000 chars).
 * @param clerkUserId  - Employee's stable Clerk user_id — plumbed from EmployeeMailboxDO profile.
 * @param cacheTtl     - Seconds for AI Gateway prompt cache. 3600 for email, 1800 for chat.
 * @param env          - Worker env (needs CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID).
 *
 * Returns [] on any error, 429, or missing env — caller must NOT let extraction
 * failure block email storage or alarm rescheduling.
 *
 * On 429: returns []. The DO caller is responsible for writing an audit_events
 * row (ai_gateway_quota_exceeded) before continuing — source email/chat remains
 * readable in all cases.
 */
export async function extractTodosFromText(
	text: string,
	clerkUserId: string,
	cacheTtl: number,
	env: Env,
): Promise<ExtractedTodo[]> {
	try {
		const data = await callAiGateway(
			[
				{
					role: "system",
					content: `<role>
You extract action items from a workplace message on behalf of one specific recipient. Your job is to surface ANYTHING they need to follow up on, respond to, decide, or attend to. The downstream ranking layer handles prioritization — your job is recall, not filtering.
</role>

<extraction_rules>
Extract EVERY actionable item — questions awaiting an answer, requests, deadlines, scheduling asks, deliverables, decisions needed. Do NOT silently drop low-urgency items; emit them with a low urgency_score and let the UI rank them down.

Score urgency_score 0-100:
- 80-100: "urgent", "ASAP", "blocking", "critical", outage, customer-facing escalation, or explicit deadline within 24h
- 60-79: "by EOD", "by Friday", "please reply", soft deadlines, important stakeholder ask
- 40-59: questions or requests with no urgency markers (default for most asks)
- 10-39: FYI items that still warrant attention (background questions, future-reference asks)
- 0-9: pure acknowledgment, no real follow-up — these you DO skip

is_mention=true when the message opens with the recipient's name, addresses them directly ("Ridhi - ", "Hi Ridhi", "@ridhi"), or names them as the assignee inline ("Ridhi, can you..."). Otherwise false.

title: 6-12 word summary in imperative form starting with a verb ("Finalize Q4 deck", "Confirm Friday standup time"). No trailing punctuation.

mentioned_actors: OTHER people named in the action (not the recipient). Empty array if none.

deadline_at: ISO 8601 date if explicitly stated. null if vague ("soon", "ASAP" without a date, "by EOD" without weekday).

preview: 30-50 char snippet of the source sentence for context.
</extraction_rules>

<negative_examples>
Do NOT extract:
- Pure acknowledgments: "Thanks!", "Got it", "Sounds good", "👍"
- Marketing / newsletters / unsubscribe blocks
- Social pleasantries: "How was the weekend?"
- Items explicitly addressed to someone ELSE (not the recipient)
- Already-resolved items the writer is just informing about ("FYI, I shipped X")
</negative_examples>

<examples>
<example>
INPUT: "Hi Ridhi, urgent: please finalize the Q4 board deck by Thursday EOD. Also can you confirm Friday standup time? Thanks."
OUTPUT: {"todos":[{"title":"Finalize Q4 board deck","urgency_score":85,"is_mention":true,"deadline_at":null,"mentioned_actors":[],"preview":"urgent: please finalize the Q4 board deck by Thursday EOD"},{"title":"Confirm Friday standup time","urgency_score":50,"is_mention":true,"deadline_at":null,"mentioned_actors":[],"preview":"can you confirm Friday standup time"}]}
</example>

<example>
INPUT: "thanks for the update! looks great."
OUTPUT: {"todos":[]}
</example>

<example>
INPUT: "Team — quick question for whoever owns the marketing dashboard: can you double-check the bounce rate numbers? They look off in the Q3 report. Not urgent."
OUTPUT: {"todos":[{"title":"Double-check bounce rate numbers in Q3 report","urgency_score":35,"is_mention":false,"deadline_at":null,"mentioned_actors":[],"preview":"can you double-check the bounce rate numbers"}]}
</example>
</examples>

Return ONLY JSON matching the provided schema. Return {"todos":[]} when nothing is actionable.`,
				},
				{ role: "user", content: text.slice(0, 8000) },
			],
			clerkUserId,
			cacheTtl,
			env,
		);

		if (!data) {
			// null = 429 or other error — caller decides whether to audit-log.
			return [];
		}

		// kimi-k2.6 + other reasoning models return OpenAI-style
		// choices[0].message.content. Non-reasoning Workers AI models return
		// result.response. Accept either; live-verified 2026-05-19 that
		// kimi was hitting the OpenAI branch and the old code silently
		// returned [].
		const responseText =
			data?.result?.response ??
			data?.result?.choices?.[0]?.message?.content ??
			null;

		if (!responseText) {
			// Defensive: if the model hit max_tokens with content=null while
			// reasoning_content is non-empty, log so we can spot budget issues
			// fast. Don't crash.
			const finish = data?.result?.choices?.[0]?.finish_reason;
			if (finish === "length") {
				console.warn(
					`extractTodosFromText: reasoning model hit max_tokens before emitting JSON (employee ${clerkUserId}); bump max_tokens or switch model`,
				);
			}
			return [];
		}

		const parsed = JSON.parse(responseText) as {
			todos?: ExtractedTodo[];
		};
		return Array.isArray(parsed?.todos) ? parsed.todos : [];
	} catch (err) {
		console.error("extractTodosFromText: unexpected error", err);
		return [];
	}
}

// — Legacy export kept until Wave 2 lands the real draft-assist path.
// Phase 10 Wave 1 documented this stub; leaving it around for any caller
// that imports it. New code should use callAiGateway()/extractTodosFromText().
export class DraftAssistNotImplementedError extends Error {
	constructor() {
		super(
			"Parrot draft-assist is not implemented yet — scheduled for a future wave.",
		);
		this.name = "DraftAssistNotImplementedError";
	}
}

export async function suggestReply(_input: {
	subject: string;
	body: string;
}): Promise<string> {
	throw new DraftAssistNotImplementedError();
}
