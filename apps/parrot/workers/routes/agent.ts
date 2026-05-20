// v1.3.1 Agent Lift: Parrot Agent HTTP routes.
//
// Lifted in spirit from apps/agentic-inbox/workers/agent/index.ts. The
// agentic-inbox version is a stateful AIChatAgent DO (via @cloudflare/ai-chat
// + the `agents` package). Parrot doesn't have those deps and doesn't need
// per-conversation persistent state for v1.3.1 — the inbox agent is a
// per-request helper invoked from the email viewer (Summarize / Draft Reply
// / Translate / Extract Actions / freeform Ask).
//
// So this file exposes plain HTTP endpoints that:
//   1. Pull the email/thread body via the authenticated employee's DO
//   2. Run a prompt-injection screen (workers/lib/ai.ts::isPromptInjection)
//   3. Build a per-task prompt
//   4. Call Cloudflare AI Gateway via chatCompletion()
//   5. Optionally apply verifyDraft to clean agent commentary out of drafts
//   6. Return JSON for the AgentPanel React component to render
//
// All endpoints are mounted under /api/inbox/agent/* and require
// requireEmployeeMailbox (parrot already runs Clerk auth before route
// handlers; the middleware sets c.var.employee + c.var.mailboxStub).
//
// White-label posture: every prompt and every response talks about "the
// agent" / "Parrot Agent". No mention of agentic-inbox, Maya, or the
// student app's omnichannel persona.
//
// Tool exposure: a list-only `GET /tools` endpoint returns the canonical
// PARROT_AGENT_TOOLS catalog (see workers/lib/agent-tools.ts) so the
// MCPPanel UI can render without a hardcoded list duplicated in the
// frontend.

import { type Context, Hono } from "hono";
import {
	chatCompletion,
	isPromptInjection,
	verifyDraft,
} from "../lib/ai";
import {
	getFullEmail,
	getFullThread,
	stripHtmlToText,
} from "../lib/email-helpers";
import {
	PARROT_AGENT_TOOLS,
	toolDraftReply,
} from "../lib/agent-tools";
import type { EmailFull } from "../lib/schemas";
import type { ParrotContext } from "../lib/mailbox";

type AppContext = Context<ParrotContext>;

const agent = new Hono<ParrotContext>();

// ── GET /api/inbox/agent/tools ─────────────────────────────────────
//
// Returns the canonical PARROT_AGENT_TOOLS catalog. The MCPPanel UI
// renders from this so the list lives in one place.
agent.get("/tools", (c: AppContext) => {
	return c.json({ tools: PARROT_AGENT_TOOLS });
});

// ── Helpers ────────────────────────────────────────────────────────

async function loadEmailContext(
	c: AppContext,
	emailId: string,
): Promise<
	| { ok: true; email: EmailFull & { body_text: string }; threadText: string }
	| { ok: false; status: number; error: string }
> {
	const stub = c.var.mailboxStub;
	const email = await getFullEmail(stub, emailId);
	if (!email) {
		return { ok: false, status: 404, error: "Email not found" };
	}

	// Build a thread context block if the email has a thread_id.
	let threadText = "";
	if (email.thread_id) {
		const thread = await getFullThread(stub, email.thread_id);
		if (thread.message_count > 1) {
			threadText = thread.messages
				.map(
					(m) =>
						`[${m.date}] ${m.sender ?? "?"} → ${m.recipient ?? "?"} (${m.folder_id ?? "?"}): ${m.body_text.substring(0, 800)}`,
				)
				.join("\n\n");
		}
	}

	return {
		ok: true,
		email: { ...email, body_text: email.body_text ?? "" },
		threadText,
	};
}

async function screenForInjection(
	c: AppContext,
	bodyText: string,
): Promise<{ blocked: boolean }> {
	const employee = c.var.employee;
	const isInjection = await isPromptInjection(
		employee.employeeId,
		c.env,
		bodyText,
	);
	return { blocked: isInjection };
}

// ── POST /api/inbox/agent/summarize ────────────────────────────────
//
// Body: { email_id: string }
// Returns: { summary: string } or { error: string, blocked?: boolean }

agent.post("/summarize", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| { email_id?: string }
		| null;
	if (!body?.email_id) {
		return c.json({ error: "Missing email_id" }, 400);
	}

	const ctx = await loadEmailContext(c, body.email_id);
	if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status as 400 | 404);

	const { email, threadText } = ctx;
	const screen = await screenForInjection(c, email.body_text);
	if (screen.blocked) {
		return c.json(
			{
				error:
					"Refused: this email appears to contain prompt injection or untrusted instructions.",
				blocked: true,
			},
			422,
		);
	}

	const employee = c.var.employee;
	const summary = await chatCompletion(
		[
			{
				role: "system",
				content:
					"You are Parrot Agent, an inbox assistant. Summarize an email thread for a busy operator in 3-5 short sentences. Lead with the most important point. Mention deadlines and specific requests verbatim. No filler.",
			},
			{
				role: "user",
				content: [
					`From: ${email.sender ?? "?"}`,
					`To: ${email.recipient ?? "?"}`,
					`Subject: ${email.subject ?? "(no subject)"}`,
					`Date: ${email.date ?? "?"}`,
					"",
					"Body:",
					email.body_text.slice(0, 6000),
					...(threadText
						? ["", "Prior thread context:", threadText.slice(0, 8000)]
						: []),
				].join("\n"),
			},
		],
		employee.employeeId,
		c.env,
		{ cacheTtl: 1800, maxTokens: 800 },
	);

	if (!summary) {
		return c.json(
			{
				error:
					"Agent is unavailable right now (AI quota or transport error). Try again in a minute.",
			},
			503,
		);
	}

	return c.json({ summary });
});

// ── POST /api/inbox/agent/extract-actions ──────────────────────────
//
// Body: { email_id: string }
// Returns: { actions: string[] }
//
// Lighter than Phase 12's extractTodosFromText — this is a free-text
// bulleted list the operator sees inline in the AgentPanel. It does NOT
// write to the todos table (the Phase 12 path already does that on
// inbound email arrival).

agent.post("/extract-actions", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| { email_id?: string }
		| null;
	if (!body?.email_id) {
		return c.json({ error: "Missing email_id" }, 400);
	}

	const ctx = await loadEmailContext(c, body.email_id);
	if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status as 400 | 404);
	const { email } = ctx;

	const screen = await screenForInjection(c, email.body_text);
	if (screen.blocked) {
		return c.json(
			{ error: "Refused: email contains untrusted instructions.", blocked: true },
			422,
		);
	}

	const employee = c.var.employee;
	const response = await chatCompletion(
		[
			{
				role: "system",
				content:
					"You are Parrot Agent. Extract every concrete action item the recipient must do based on this email — questions to answer, deadlines, tasks, decisions. Output a markdown bulleted list. Each bullet is short (6-12 words), starts with a verb, and ends with no punctuation. If there are zero action items, output exactly: NONE",
			},
			{
				role: "user",
				content: [
					`Subject: ${email.subject ?? "(no subject)"}`,
					`From: ${email.sender ?? "?"}`,
					"",
					email.body_text.slice(0, 6000),
				].join("\n"),
			},
		],
		employee.employeeId,
		c.env,
		{ cacheTtl: 1800, maxTokens: 600 },
	);

	if (!response) {
		return c.json(
			{ error: "Agent unavailable. Try again in a minute." },
			503,
		);
	}

	if (response.trim().toUpperCase() === "NONE") {
		return c.json({ actions: [] });
	}

	const actions = response
		.split("\n")
		.map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
		.filter((line) => line.length > 0);
	return c.json({ actions });
});

// ── POST /api/inbox/agent/translate ────────────────────────────────
//
// Body: { email_id: string, target_language?: string }
// Returns: { translation: string }

agent.post("/translate", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| { email_id?: string; target_language?: string }
		| null;
	if (!body?.email_id) {
		return c.json({ error: "Missing email_id" }, 400);
	}
	const targetLanguage = body.target_language?.trim() || "English";

	const ctx = await loadEmailContext(c, body.email_id);
	if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status as 400 | 404);
	const { email } = ctx;

	// We intentionally do NOT screen translation requests for injection —
	// translation must work on adversarial / multilingual content too,
	// and the response is rendered as text, not executed. The verifyDraft
	// path that scrubs agent commentary still applies before send.

	const employee = c.var.employee;
	const translation = await chatCompletion(
		[
			{
				role: "system",
				content: `You are Parrot Agent. Translate the user-provided email body into ${targetLanguage}. Preserve meaning, tone, and structure. Output ONLY the translation — no preface, no notes, no quotes.`,
			},
			{
				role: "user",
				content: email.body_text.slice(0, 6000),
			},
		],
		employee.employeeId,
		c.env,
		// Cache disabled — same source can be requested in different languages
		// from the same user; key collisions would yield the wrong translation.
		{ cacheTtl: 0, maxTokens: 2000 },
	);

	if (!translation) {
		return c.json(
			{ error: "Agent unavailable. Try again in a minute." },
			503,
		);
	}

	return c.json({ translation });
});

// ── POST /api/inbox/agent/draft-reply ──────────────────────────────
//
// Body: { email_id: string, instructions?: string, save?: boolean }
// Returns: { draft_text: string, draft_id?: string }
//
// When save=true the draft is written into the Drafts folder via
// toolDraftReply (which runs verifyDraft + appends a quoted-original
// block). The agent panel uses save=false to preview, save=true on
// "Save to Drafts".

agent.post("/draft-reply", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| {
				email_id?: string;
				instructions?: string;
				save?: boolean;
		  }
		| null;
	if (!body?.email_id) {
		return c.json({ error: "Missing email_id" }, 400);
	}

	const ctx = await loadEmailContext(c, body.email_id);
	if (!ctx.ok) return c.json({ error: ctx.error }, ctx.status as 400 | 404);
	const { email, threadText } = ctx;

	const screen = await screenForInjection(c, email.body_text);
	if (screen.blocked) {
		return c.json(
			{
				error:
					"Refused to draft a reply — the email contains untrusted instructions.",
				blocked: true,
			},
			422,
		);
	}

	const employee = c.var.employee;
	const userInstructions = body.instructions?.trim();

	const draftText = await chatCompletion(
		[
			{
				role: "system",
				content: [
					"You are Parrot Agent, drafting an email reply on behalf of the operator.",
					"",
					"Writing rules:",
					"- Plain text. No HTML tags. No markdown. No bullet points unless the user explicitly asks for a list.",
					"- Natural sentences. Short paragraphs. Get to the point.",
					"- Never narrate what you are doing. Output ONLY the reply body — no 'Here is a draft:', no 'I have written:', no commentary at all.",
					"- Match the tone of the prior thread. Polite but direct.",
					"- Greet the sender by their first name from the email body or signature.",
					`- Sign off as ${employee.displayName || "the recipient"}.`,
					"- Never repeat content that already appeared earlier in the thread.",
				].join("\n"),
			},
			{
				role: "user",
				content: [
					`Reply to this email on behalf of ${employee.displayName} (${employee.email}).`,
					...(userInstructions
						? ["", `Operator instructions: ${userInstructions}`]
						: []),
					"",
					`From: ${email.sender ?? "?"}`,
					`Subject: ${email.subject ?? "(no subject)"}`,
					"",
					"Body:",
					email.body_text.slice(0, 6000),
					...(threadText
						? ["", "Prior thread (oldest → newest):", threadText.slice(0, 8000)]
						: []),
				].join("\n"),
			},
		],
		employee.employeeId,
		c.env,
		{ cacheTtl: 0, maxTokens: 1500 },
	);

	if (!draftText) {
		return c.json(
			{ error: "Agent unavailable. Try again in a minute." },
			503,
		);
	}

	// Run verifyDraft to scrub any agent commentary that slipped in.
	const cleaned = await verifyDraft(employee.employeeId, c.env, draftText);
	const finalText = cleaned || draftText;

	// Optionally persist to Drafts folder.
	let draftId: string | undefined;
	if (body.save) {
		const result = await toolDraftReply(
			c.var.mailboxStub,
			c.env,
			employee.employeeId,
			employee.email,
			{
				originalEmailId: body.email_id,
				to: email.sender ?? "",
				subject: email.subject?.startsWith("Re:")
					? email.subject
					: `Re: ${email.subject ?? ""}`,
				body: finalText,
				isPlainText: true,
				// We already ran verifyDraft above; don't run it twice.
				runVerifyDraft: false,
			},
		);
		if ("error" in result) {
			return c.json({ draft_text: finalText, error: result.error }, 500);
		}
		draftId = result.draftId;
	}

	return c.json({ draft_text: finalText, ...(draftId ? { draft_id: draftId } : {}) });
});

// ── POST /api/inbox/agent/chat ─────────────────────────────────────
//
// Body: {
//   email_id?: string,   // Optional — if present, email body is added to context
//   messages: Array<{ role: 'user' | 'assistant', content: string }>
// }
// Returns: { reply: string }
//
// Freeform chat against the agent, scoped to the authenticated employee.
// Stateless: the caller (AgentPanel.tsx) keeps the conversation history
// in React state and replays it with each call. This avoids needing a
// new DO migration for agent_conversations in v1.3.1 — that table can
// come later if conversation persistence becomes a feature need.

agent.post("/chat", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => null)) as
		| {
				email_id?: string;
				messages?: Array<{ role: "user" | "assistant"; content: string }>;
		  }
		| null;
	if (!Array.isArray(body?.messages) || body.messages.length === 0) {
		return c.json({ error: "Missing messages" }, 400);
	}

	let contextBlock = "";
	if (body.email_id) {
		const ctx = await loadEmailContext(c, body.email_id);
		if (ctx.ok) {
			const { email, threadText } = ctx;
			const screen = await screenForInjection(c, email.body_text);
			if (!screen.blocked) {
				contextBlock = [
					"<current_email>",
					`From: ${email.sender ?? "?"}`,
					`Subject: ${email.subject ?? "(no subject)"}`,
					"",
					email.body_text.slice(0, 4000),
					"</current_email>",
					...(threadText
						? [
								"",
								"<thread_history>",
								threadText.slice(0, 6000),
								"</thread_history>",
							]
						: []),
				].join("\n");
			} else {
				contextBlock =
					"<warning>The selected email contains untrusted instructions and has been redacted from the agent's view.</warning>";
			}
		}
	}

	const employee = c.var.employee;
	const messages: Array<{ role: string; content: string }> = [
		{
			role: "system",
			content: [
				"You are Parrot Agent, the inbox assistant for an InternJobs.ai employee.",
				`The operator is ${employee.displayName} (${employee.email}).`,
				"",
				"You can help summarize threads, draft replies, extract action items, and translate text.",
				"You CANNOT send emails directly — only draft them. The operator reviews and sends drafts from the UI.",
				"",
				"Writing rules:",
				"- Be concise. Short paragraphs. Plain prose.",
				"- Never narrate what you are doing.",
				"- If asked to draft something, output the draft text directly — no preamble.",
				...(contextBlock
					? ["", "Email context (read-only):", contextBlock]
					: []),
			].join("\n"),
		},
		...body.messages.slice(-20).map((m) => ({
			role: m.role,
			content: m.content.slice(0, 4000),
		})),
	];

	const reply = await chatCompletion(messages, employee.employeeId, c.env, {
		cacheTtl: 0,
		maxTokens: 2000,
	});

	if (!reply) {
		return c.json(
			{ error: "Agent unavailable. Try again in a minute." },
			503,
		);
	}

	return c.json({ reply });
});

// ── GET /api/inbox/agent/conversation/:emailId ─────────────────────
//
// Returns a seed conversation skeleton the AgentPanel can use on open.
// Today this is just { suggested_prompts: string[] } — keeps the panel
// from having to hardcode the suggestions. If we ever add server-side
// persistence (agent_conversations table on the DO), this endpoint
// grows to return the saved history.

agent.get("/conversation/:emailId", async (c: AppContext) => {
	const emailId = c.req.param("emailId");
	if (!emailId) return c.json({ error: "Missing emailId" }, 400);

	// Verify the email exists in the employee's mailbox before exposing
	// hints — prevents probing for arbitrary IDs.
	const email = await c.var.mailboxStub.getEmail(emailId);
	if (!email) return c.json({ error: "Email not found" }, 404);

	return c.json({
		suggested_prompts: [
			"Summarize this thread",
			"What does this email want me to do?",
			"Draft a polite reply",
			"Translate this to Spanish",
		],
	});
});

export { agent as agentRoutes };
