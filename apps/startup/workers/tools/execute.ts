// apps/startup/workers/tools/execute.ts
// v1.4 Phase 28 STARTUP-MCP-06..10 — execute() tool handler.
//
// Full implementation: 5 action handlers + Zod validation + ownership authz +
// audit log on every call.
//
// SECURITY MODEL:
//   • startup_id ALWAYS comes from the auth token's resolved context
//     (args.startup_id). NEVER from user-supplied params.
//   • Per-action Zod schemas .strip() (default) silently drop unknown fields,
//     INCLUDING any rogue `startup_id` an LLM tries to inject. The proxy
//     receives startup_id ONLY from args.startup_id, and PATCH /v1/roles/:id
//     + PATCH /v1/threads/:id/mark enforce an ownership WHERE clause server-
//     side at the DB level. Cross-startup leaks are impossible without
//     deliberately bypassing this dispatch.
//   • Audit log fires in a finally block — written regardless of success or
//     handler error. params_hash is SHA-256 of the original args.params
//     (the bytes the user supplied, before Zod strip).

import { z } from "zod";
import type { Env } from "../types";
import { writeAuditLog, hashParams } from "../lib/audit";
import { embedText } from "../lib/embed";

// ── Action Zod schemas ─────────────────────────────────────────────────────────
//
// IMPORTANT: none of these schemas list `startup_id` as a field. Zod's default
// behavior on z.object() is .strip() — unknown fields are silently dropped.
// That gives us the cross-startup guarantee: even if an LLM hallucinates a
// `startup_id` param, it never reaches the proxy.

const POST_ROLE_SCHEMA = z.object({
	title: z.string().min(1).max(200),
	description: z.string().min(1).max(10000),
	requirements: z.string().max(5000).optional().default(""),
	location: z.string().max(200).optional(),
	comp_range: z.string().max(100).optional(),
});

const REPLY_TO_CANDIDATE_SCHEMA = z.object({
	thread_id: z.string().uuid(),
	message: z.string().min(1).max(2000),
});

const UPDATE_ROLE_SCHEMA = z.object({
	role_id: z.string().uuid(),
	patch: z.object({
		title: z.string().max(200).optional(),
		description: z.string().max(10000).optional(),
		status: z.enum(["active", "paused", "filled"]).optional(),
		location: z.string().max(200).optional(),
		comp_range: z.string().max(100).optional(),
	}),
});

const ARCHIVE_ROLE_SCHEMA = z.object({
	role_id: z.string().uuid(),
});

const MARK_CANDIDATE_SCHEMA = z.object({
	thread_id: z.string().uuid(),
	mark: z.enum([
		"interested",
		"not_interested",
		"shortlisted",
		"rejected",
	]),
});

// v1.4 Phase 29-01 — SMS + Voice AI actions.
//
// show_candidate({thread_id?, position}) — fetch the Nth most-recent candidate
// for the startup, formatted SMS-safe. `position` is 1-indexed (position=1 →
// most recent). `thread_id` is reserved for future per-thread continuation
// (e.g. "show me the next one" from an explicit thread cursor) but currently
// ignored by the proxy endpoint — the position parameter is the load-bearing
// selector for v1.4.
const SHOW_CANDIDATE_SCHEMA = z.object({
	thread_id: z.string().uuid().optional(),
	position: z.number().int().min(1).max(9),
});

// register_startup({company, founder_name, founder_email, what_hiring_for,
// channel_external_id, channel_type}) — onboarding action triggered by the
// Voice AI agent (Phase 29-02) at the end of an intake call. Routes through
// the loopback /admin/startups/new endpoint with STARTUP_MCP_ADMIN_SECRET as
// Bearer so the Voice AI agent never holds the admin secret directly.
//
// SECURITY NOTES:
//   • The work-email blocklist (see lib/workEmail.ts) rejects gmail/yahoo/etc.
//     BEFORE the admin endpoint is invoked. Voice AI hears "please use a work
//     email" and re-prompts.
//   • args.startup_id MUST be 'onboarding' (sentinel) because there is no
//     resolved startup context yet — the admin endpoint mints a fresh one.
//     handleExecute strips startup_id from args via Zod (.strip default), but
//     the audit-log row uses args.startup_id from the dispatch context, which
//     is set to 'onboarding' upstream by routes/telnyx.ts for this action.
const REGISTER_STARTUP_SCHEMA = z.object({
	company: z.string().min(1).max(200),
	founder_name: z.string().min(1).max(200),
	founder_email: z.string().email(),
	what_hiring_for: z.string().min(1).max(500),
	channel_external_id: z.string().min(1),
	channel_type: z.enum(["telnyx-voice", "telnyx-sms"]),
});

// ── Proxy fetch helpers ────────────────────────────────────────────────────────

interface ProxyError extends Error {
	status: number;
	data: unknown;
}

async function proxyPost(
	url: string,
	secret: string,
	body: unknown,
): Promise<unknown> {
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10000),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error("proxy_error") as ProxyError;
		err.status = res.status;
		err.data = data;
		throw err;
	}
	return data;
}

async function proxyPatch(
	url: string,
	secret: string,
	body: unknown,
): Promise<unknown> {
	const res = await fetch(url, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10000),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error("proxy_error") as ProxyError;
		err.status = res.status;
		err.data = data;
		throw err;
	}
	return data;
}

async function proxyGet(
	url: string,
	secret: string,
): Promise<unknown> {
	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${secret}`,
		},
		signal: AbortSignal.timeout(10000),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error("proxy_error") as ProxyError;
		err.status = res.status;
		err.data = data;
		throw err;
	}
	return data;
}

// ── Action handlers ────────────────────────────────────────────────────────────

async function handlePostRole(
	startup_id: string,
	params: z.infer<typeof POST_ROLE_SCHEMA>,
	env: Env,
) {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	// 1. Compute 768-dim embedding for semantic candidate matching. Fail-soft —
	//    null is acceptable; the proxy skips role_embeddings UPSERT gracefully.
	const embedding = await embedText(
		`${params.title} ${params.description} ${params.requirements ?? ""}`,
		env,
	);
	// 2. Insert role row through the Fly proxy. startup_id comes from auth ctx.
	const role = (await proxyPost(
		`${base}/v1/roles`,
		env.STARTUP_API_SECRET,
		{
			startup_id,
			title: params.title,
			description: params.description,
			requirements: params.requirements,
			location: params.location,
			comp_range: params.comp_range,
			embedding,
		},
	)) as { id: string };
	return {
		role_id: role.id,
		title: params.title,
		embedding_attached: embedding !== null,
	};
}

async function handleReplyToCandidate(
	startup_id: string,
	params: z.infer<typeof REPLY_TO_CANDIDATE_SCHEMA>,
	env: Env,
) {
	// Ownership invariant: the outbound_messages row carries startup_id from
	// auth context. The thread_id is taken at face value — for Phase 28 we
	// trust the founder's LLM to have resolved a thread they own (via search()
	// which already scopes results to the authenticated startup). Phase 29
	// can add an explicit /v1/threads/:id/verify endpoint if pilot data shows
	// cross-startup thread-id guessing is a real risk.
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const msg = (await proxyPost(
		`${base}/v1/messages`,
		env.STARTUP_API_SECRET,
		{
			thread_id: params.thread_id,
			startup_id,
			content: params.message,
			channel: "mcp",
			direction: "outbound",
		},
	)) as { id: string };
	return {
		message_id: msg.id,
		thread_id: params.thread_id,
		channel: "mcp",
	};
}

async function handleUpdateRole(
	startup_id: string,
	params: z.infer<typeof UPDATE_ROLE_SCHEMA>,
	env: Env,
) {
	// Ownership is enforced server-side: PATCH /v1/roles/:id WHERE id=$1 AND
	// startup_id=$2. A token-for-A trying to patch startup-B's role gets 404.
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	await proxyPatch(
		`${base}/v1/roles/${params.role_id}`,
		env.STARTUP_API_SECRET,
		{
			startup_id,
			patch: params.patch,
		},
	);
	return {
		role_id: params.role_id,
		updated: true,
		patch: params.patch,
	};
}

async function handleArchiveRole(
	startup_id: string,
	params: z.infer<typeof ARCHIVE_ROLE_SCHEMA>,
	env: Env,
) {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	await proxyPatch(
		`${base}/v1/roles/${params.role_id}`,
		env.STARTUP_API_SECRET,
		{
			startup_id,
			patch: { status: "filled" },
		},
	);
	return {
		role_id: params.role_id,
		archived: true,
		status: "filled",
	};
}

async function handleMarkCandidate(
	startup_id: string,
	params: z.infer<typeof MARK_CANDIDATE_SCHEMA>,
	env: Env,
) {
	// PATCH /v1/threads/:id/mark uses the 3-way OR match (see 28-01 SUMMARY)
	// and is ownership-scoped (WHERE startup_id = $2). rowCount=0 returns
	// `{ok: true, updated: 0}` — idempotent-friendly, no thread-existence leak.
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const result = (await proxyPatch(
		`${base}/v1/threads/${params.thread_id}/mark`,
		env.STARTUP_API_SECRET,
		{
			startup_id,
			mark: params.mark,
		},
	)) as { ok?: boolean; updated?: number };
	return {
		thread_id: params.thread_id,
		mark: params.mark,
		updated: result?.updated ?? 0,
	};
}

// ── Phase 29-01 handlers — show_candidate + register_startup ──────────────────

async function handleShowCandidate(
	startup_id: string,
	params: z.infer<typeof SHOW_CANDIDATE_SCHEMA>,
	env: Env,
) {
	// Fetch the Nth most-recent candidate thread for this startup. The Fly
	// proxy enforces startup_id ownership server-side (WHERE startup_id = $1).
	// position=1 means most recent; position=9 maps to OFFSET 8 LIMIT 1.
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const url = `${base}/v1/startups/${encodeURIComponent(startup_id)}/candidates?position=${params.position}`;
	const result = (await proxyGet(url, env.STARTUP_API_SECRET)) as {
		candidate_name?: string;
		role_title?: string;
		application_summary?: string;
		thread_id?: string;
	};
	return {
		candidate_name: result?.candidate_name ?? "unknown",
		role_title: result?.role_title ?? null,
		application_summary: result?.application_summary ?? null,
		thread_id: result?.thread_id ?? null,
		position: params.position,
	};
}

async function handleRegisterStartup(
	_startup_id: string, // sentinel 'onboarding' — not used; admin endpoint mints fresh
	params: z.infer<typeof REGISTER_STARTUP_SCHEMA>,
	env: Env,
) {
	// Work-email enforcement (mirrors apps/startup/workers/routes/webhooks.ts
	// blocklist; lib/workEmail.ts is the shared module added in Plan 29-01).
	const { isPersonalEmailDomain } = await import("../lib/workEmail");
	if (isPersonalEmailDomain(params.founder_email)) {
		return {
			ok: false,
			error: "personal_email_rejected",
			message:
				"work emails only please — gmail/yahoo/outlook/etc are not accepted. retry with your company email.",
		};
	}

	// Loopback to the local admin endpoint — Voice AI agent never holds the
	// admin secret directly; it lives only in the Worker's env. We use the
	// public hostname so the Worker self-routes through CF (no special internal
	// dispatch wiring needed; ~1-2ms in same-region edge).
	const adminSecret = env.STARTUP_MCP_ADMIN_SECRET;
	if (!adminSecret) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_register_startup_no_admin_secret",
				note: "STARTUP_MCP_ADMIN_SECRET not bound — cannot mint via /admin/startups/new",
			}),
		);
		return {
			ok: false,
			error: "registration_unavailable",
			message: "registration is temporarily offline — our team will follow up.",
		};
	}

	const adminUrl = "https://mcp.internjobs.ai/admin/startups/new";
	const res = await fetch(adminUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${adminSecret}`,
		},
		body: JSON.stringify({
			company: params.company,
			founder_email: params.founder_email,
			founder_phone: params.channel_external_id, // E.164 if telnyx-sms/voice
			founder_name: params.founder_name,
		}),
		signal: AbortSignal.timeout(15000),
	});
	const data = (await res.json().catch(() => ({}))) as {
		ok?: boolean;
		startup_id?: string;
		token?: string;
		install_snippet?: unknown;
		agent_email?: string | null;
		error?: string;
	};

	if (res.status === 409) {
		// Founder already registered — gracefully recover for Voice AI.
		return {
			ok: false,
			error: "already_registered",
			message:
				"looks like you're already in our system. check your inbox for the welcome email or reach out to ridhi@internjobs.ai for help.",
		};
	}
	if (!res.ok) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_register_startup_admin_failed",
				status: res.status,
				detail: data,
			}),
		);
		return {
			ok: false,
			error: "registration_failed",
			message:
				"we couldn't complete the registration just now. our team will follow up shortly.",
		};
	}

	// After successful mint, store the founder's stated role intent in the
	// startup_channel_links metadata for the channel that registered them.
	// Best-effort: a failure here doesn't undo the startup creation.
	try {
		const base = env.STARTUP_API_URL.replace(/\/$/, "");
		await fetch(`${base}/v1/channel-links`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			body: JSON.stringify({
				startup_id: data.startup_id,
				channel_type: params.channel_type,
				channel_external_id: params.channel_external_id,
				status: "active",
				opt_in_flags: { weekly_touchbase: true },
				metadata: {
					what_hiring_for: params.what_hiring_for,
					founder_name: params.founder_name,
					registered_via: params.channel_type,
				},
			}),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_register_channel_link_upsert_failed",
				error: (err as Error)?.message ?? String(err),
				startup_id: data.startup_id,
			}),
		);
	}

	return {
		ok: true,
		startup_id: data.startup_id ?? null,
		agent_email: data.agent_email ?? null,
		mcp_install_snippet: data.install_snippet ?? null,
		// Voice AI agent reads this to confirm to founder. Token NOT included
		// in the SMS-safe voice response — founder gets it via the welcome SMS
		// already fired by the admin endpoint.
	};
}

// ── Action dispatch table ──────────────────────────────────────────────────────

const ACTION_HANDLERS = {
	post_role: { schema: POST_ROLE_SCHEMA, handler: handlePostRole },
	reply_to_candidate: {
		schema: REPLY_TO_CANDIDATE_SCHEMA,
		handler: handleReplyToCandidate,
	},
	update_role: { schema: UPDATE_ROLE_SCHEMA, handler: handleUpdateRole },
	archive_role: { schema: ARCHIVE_ROLE_SCHEMA, handler: handleArchiveRole },
	mark_candidate: {
		schema: MARK_CANDIDATE_SCHEMA,
		handler: handleMarkCandidate,
	},
	// v1.4 Phase 29-01 additions:
	show_candidate: { schema: SHOW_CANDIDATE_SCHEMA, handler: handleShowCandidate },
	register_startup: {
		schema: REGISTER_STARTUP_SCHEMA,
		handler: handleRegisterStartup,
	},
} as const;

// ── Public types + entry point ─────────────────────────────────────────────────

export type ExecuteAction = keyof typeof ACTION_HANDLERS;

export interface ExecuteArgs {
	startup_id: string;
	member_id: string;
	action: ExecuteAction;
	params: Record<string, unknown>;
	env: Env;
}

export type ExecuteResult =
	| { ok: true; action: ExecuteAction; data: unknown; latency_ms: number }
	| {
			ok: false;
			action: ExecuteAction;
			error: string;
			detail?: unknown;
			latency_ms: number;
	  };

export async function handleExecute(args: ExecuteArgs): Promise<ExecuteResult> {
	const entry = ACTION_HANDLERS[args.action];
	if (!entry) {
		// Defensive: the server.ts Zod enum already rejects unknown actions
		// before reaching this function. This branch covers direct callers.
		return {
			ok: false,
			action: args.action,
			error: "invalid_action",
			detail: `action must be one of: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
			latency_ms: 0,
		};
	}

	// 1. Schema validation — Zod .safeParse strips unknown fields (including
	//    any rogue startup_id) and returns a structured error on failure.
	const parsed = entry.schema.safeParse(args.params);
	if (!parsed.success) {
		// Audit the rejected call too — it's signal for abuse / LLM drift.
		const paramsHash = await hashParams(args.params);
		await writeAuditLog(args.env, {
			member_id: args.member_id,
			startup_id: args.startup_id,
			channel: "mcp",
			action: args.action,
			params_hash: paramsHash,
			status: "error",
			error_code: "invalid_params",
			latency_ms: 0,
		});
		return {
			ok: false,
			action: args.action,
			error: "invalid_params",
			detail: parsed.error.flatten(),
			latency_ms: 0,
		};
	}

	const t0 = Date.now();
	let status: "ok" | "error" = "ok";
	let errorCode: string | undefined;
	let result: unknown;

	try {
		// 2. Dispatch — startup_id from auth context, NEVER from params.
		result = await (
			entry.handler as (
				startup_id: string,
				params: unknown,
				env: Env,
			) => Promise<unknown>
		)(args.startup_id, parsed.data, args.env);
		const latency_ms = Date.now() - t0;
		return { ok: true, action: args.action, data: result, latency_ms };
	} catch (err) {
		status = "error";
		const proxyErr = err as ProxyError;
		errorCode =
			(err as { code?: string })?.code ??
			(proxyErr?.status === 404 ? "not_found_or_not_owned" : "handler_error");
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_execute_handler_failed",
				action: args.action,
				startup_id: args.startup_id,
				error: (err as Error)?.message ?? String(err),
				status: proxyErr?.status,
				proxy_data: proxyErr?.data,
			}),
		);
		const latency_ms = Date.now() - t0;
		return {
			ok: false,
			action: args.action,
			error: errorCode,
			detail: (err as Error)?.message,
			latency_ms,
		};
	} finally {
		// 3. Audit — fires regardless of success or thrown error.
		const paramsHash = await hashParams(args.params);
		await writeAuditLog(args.env, {
			member_id: args.member_id,
			startup_id: args.startup_id,
			channel: "mcp",
			action: args.action,
			params_hash: paramsHash,
			status,
			error_code: errorCode,
			latency_ms: Date.now() - t0,
		});
	}
}
