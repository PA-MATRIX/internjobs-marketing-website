// KGRAPH-05 A/B comparison harness (qualitative).
// Usage:
//   GRAPH_API_URL=... GRAPH_API_SECRET=... \
//   CF_AI_GATEWAY_URL=... CF_AI_GATEWAY_TOKEN=... \
//   EMPLOYEE_ID=<clerkUserId> \
//   node scripts/26-kgraph-ab.mjs [emails.json]
//
// emails.json: JSON array of email body strings (10 recommended).
// Output: side-by-side todo counts. Pipe to file for human review.
// This is a one-shot dev tool — not production code, no test coverage needed.
//
// Qualitative review only — pipe to a file and inspect. No automated quality judgment.
//
// CF_AI_GATEWAY_URL format (matches ai.ts callAiGateway):
//   https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/workers-ai/{model}
//   The model segment is appended literally — DO NOT encode the slashes.
// CF_AI_GATEWAY_TOKEN: the CLOUDFLARE_AI_API_TOKEN bearer used by the Worker.

import { readFile } from "node:fs/promises";

const GRAPH_API_URL = process.env.GRAPH_API_URL;
const GRAPH_API_SECRET = process.env.GRAPH_API_SECRET;
const CF_AI_GATEWAY_URL = process.env.CF_AI_GATEWAY_URL;
const CF_AI_GATEWAY_TOKEN = process.env.CF_AI_GATEWAY_TOKEN;
const EMPLOYEE_ID = process.env.EMPLOYEE_ID;

const missing = [];
if (!GRAPH_API_URL) missing.push("GRAPH_API_URL");
if (!GRAPH_API_SECRET) missing.push("GRAPH_API_SECRET");
if (!CF_AI_GATEWAY_URL) missing.push("CF_AI_GATEWAY_URL");
if (!CF_AI_GATEWAY_TOKEN) missing.push("CF_AI_GATEWAY_TOKEN");
if (!EMPLOYEE_ID) missing.push("EMPLOYEE_ID");

if (missing.length > 0) {
	console.error(
		`ERROR: missing required env vars: ${missing.join(", ")}\n\n` +
			"Usage:\n" +
			"  GRAPH_API_URL=... GRAPH_API_SECRET=... \\\n" +
			"  CF_AI_GATEWAY_URL=... CF_AI_GATEWAY_TOKEN=... \\\n" +
			"  EMPLOYEE_ID=<clerkUserId> \\\n" +
			"  node scripts/26-kgraph-ab.mjs [emails.json]\n",
	);
	process.exit(2);
}

const QUERY_URL = GRAPH_API_URL.replace(/\/$/, "") + "/query";

// Mirror of the kimi extraction system prompt from apps/parrot/workers/lib/ai.ts.
// Keep in sync if that prompt changes — this is the A/B harness's whole reason
// for existing, so we want it to produce the same shape as production.
const EXTRACTION_SYSTEM = `<role>
You extract action items from a workplace message on behalf of one specific recipient. Your job is to surface ANYTHING they need to follow up on, respond to, decide, or attend to. The downstream ranking layer handles prioritization — your job is recall, not filtering.
</role>

<extraction_rules>
Extract EVERY actionable item — questions awaiting an answer, requests, deadlines, scheduling asks, deliverables, decisions needed. Do NOT silently drop low-urgency items; emit them with a low urgency_score and let the UI rank them down.

Score urgency_score 0-100:
- 80-100: urgent, ASAP, blocking, critical, outage, customer-facing escalation, or explicit deadline within 24h
- 60-79: by EOD, by Friday, please reply, soft deadlines, important stakeholder ask
- 40-59: questions or requests with no urgency markers (default for most asks)
- 10-39: FYI items that still warrant attention
- 0-9: pure acknowledgment, no real follow-up

is_mention=true when the message opens with the recipient's name or addresses them directly.

title: 6-12 word imperative starting with a verb. No trailing punctuation.

mentioned_actors: OTHER people named in the action. Empty array if none.

blocked_by_ids: free-text descriptions of anything this todo is explicitly blocked by or waiting on. Empty array if none.

deadline_at: ISO 8601 date if explicitly stated. null if vague.

preview: 30-50 char snippet of the source sentence.
</extraction_rules>

Return ONLY JSON matching the provided schema. Return {"todos":[]} when nothing is actionable.`;

const EXTRACTION_SCHEMA = {
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
					blocked_by_ids: { type: "array", items: { type: "string" } },
				},
			},
		},
	},
};

/**
 * Run a Cypher query against the live graph-api proxy.
 */
async function graphQuery(cypher, params = {}) {
	const res = await fetch(QUERY_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${GRAPH_API_SECRET}`,
		},
		body: JSON.stringify({ cypher, params }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "<unreadable>");
		throw new Error(`graph-api ${res.status}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

/**
 * Build an <employee_context> block from the live graph for the given employee.
 * Mirrors the format produced by graph.ts getEmployeeContext.
 */
async function getContext(employeeId) {
	const res = await graphQuery(
		`MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
		 WHERE t.valid_to IS NULL
		 RETURN t.title, t.urgency_score, t.deadline_at
		 ORDER BY t.urgency_score DESC
		 LIMIT 10`,
		{ eid: employeeId },
	);
	const rows = res?.data ?? [];
	if (rows.length === 0) return "";

	const lines = ["<employee_context>", "Open todos (most urgent first):"];
	for (const row of rows) {
		const arr = Array.isArray(row)
			? row
			: [
					row["t.title"],
					row["t.urgency_score"],
					row["t.deadline_at"],
				];
		const title = String(arr[0] ?? "");
		const urgency = Number(arr[1]) || 0;
		const deadline = arr[2] ?? null;
		const parts = [`[urgency ${urgency}] ${title}`];
		if (deadline) parts.push(`deadline: ${String(deadline).slice(0, 10)}`);
		lines.push(`- ${parts.join(" • ")}`);
	}
	lines.push("</employee_context>");
	return lines.join("\n");
}

/**
 * Call the Cloudflare AI Gateway with the kimi extraction prompt.
 * When contextBlock is non-empty, prepends it to the system prompt
 * (matches ai.ts:252 pattern). Always cf-aig-cache-ttl=0 — A/B must
 * be live inference, not cached results.
 */
async function extractTodos(text, contextBlock = "") {
	const systemPrefix = contextBlock ? `${contextBlock}\n\n` : "";
	const body = {
		messages: [
			{ role: "system", content: `${systemPrefix}${EXTRACTION_SYSTEM}` },
			{ role: "user", content: text.slice(0, 8000) },
		],
		response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
		max_tokens: 4000,
	};
	const res = await fetch(CF_AI_GATEWAY_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${CF_AI_GATEWAY_TOKEN}`,
			"Content-Type": "application/json",
			"cf-aig-metadata": JSON.stringify({ user_id: EMPLOYEE_ID }),
			"cf-aig-cache-ttl": "0",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const err = await res.text().catch(() => "<unreadable>");
		throw new Error(`AI Gateway ${res.status}: ${err.slice(0, 200)}`);
	}
	const data = await res.json();
	const content =
		data?.result?.response ??
		data?.result?.choices?.[0]?.message?.content ??
		null;
	if (!content) return [];
	try {
		const parsed = JSON.parse(content);
		return Array.isArray(parsed?.todos) ? parsed.todos : [];
	} catch {
		return [];
	}
}

const FALLBACK_EMAILS = [
	"Hi Ridhi, urgent: please finalize the Q4 board deck by Thursday EOD. Also can you confirm Friday standup time?",
	"thanks for the update! looks great.",
	"Team — quick question for whoever owns the marketing dashboard: can you double-check the bounce rate numbers? They look off in the Q3 report. Not urgent.",
];

async function loadEmails(path) {
	if (!path) {
		console.log(
			`(no emails.json provided — using ${FALLBACK_EMAILS.length} hard-coded stub texts for local testing)\n`,
		);
		return FALLBACK_EMAILS;
	}
	const raw = await readFile(path, "utf8");
	const arr = JSON.parse(raw);
	if (!Array.isArray(arr) || arr.some((s) => typeof s !== "string")) {
		throw new Error(`${path}: must be a JSON array of strings`);
	}
	return arr;
}

function fmtTodos(todos) {
	if (todos.length === 0) return "0 todos";
	return (
		`${todos.length} todos: ` +
		todos.map((t) => `"${t.title}" (${t.urgency_score})`).join(", ")
	);
}

async function main() {
	const emailsPath = process.argv[2];
	const emails = await loadEmails(emailsPath);

	console.log(`KGRAPH-05 A/B comparison harness`);
	console.log(`Employee: ${EMPLOYEE_ID}`);
	console.log(`Emails: ${emails.length}\n`);

	// Fetch the context block ONCE — it represents the state of the graph at
	// the start of the run, identical for every email's with-context call.
	let contextBlock = "";
	try {
		contextBlock = await getContext(EMPLOYEE_ID);
	} catch (err) {
		console.error(
			`WARNING: getContext failed (${err.message}); proceeding with empty context block.`,
		);
	}
	if (!contextBlock) {
		console.log(
			"(employee has no open todos in graph — with-context path will get empty context)\n",
		);
	} else {
		console.log(`Context block (${contextBlock.length} chars):`);
		console.log(contextBlock);
		console.log("");
	}

	let totalNoCtx = 0;
	let totalWithCtx = 0;

	for (let i = 0; i < emails.length; i++) {
		const text = emails[i];
		console.log(`=== Email ${i + 1}/${emails.length} ===`);
		let noCtx = [];
		let withCtx = [];
		try {
			noCtx = await extractTodos(text, "");
		} catch (err) {
			console.error(`  [NO CONTEXT]  ERROR: ${err.message}`);
		}
		try {
			withCtx = await extractTodos(text, contextBlock);
		} catch (err) {
			console.error(`  [WITH CONTEXT] ERROR: ${err.message}`);
		}
		console.log(`  [NO CONTEXT]   ${fmtTodos(noCtx)}`);
		console.log(`  [WITH CONTEXT] ${fmtTodos(withCtx)}`);
		const delta = withCtx.length - noCtx.length;
		console.log(`  DELTA: ${delta >= 0 ? "+" : ""}${delta} todos\n`);
		totalNoCtx += noCtx.length;
		totalWithCtx += withCtx.length;
	}

	console.log(`=== Summary ===`);
	console.log(`Total todos (no context):   ${totalNoCtx}`);
	console.log(`Total todos (with context): ${totalWithCtx}`);
	console.log(
		`Net delta: ${totalWithCtx - totalNoCtx} (negative = duplicates suppressed by context)`,
	);
	console.log(`\nQualitative review only — inspect the per-email diffs above.`);
}

main().catch((err) => {
	console.error("Unexpected error:", err?.message ?? err);
	process.exit(2);
});
