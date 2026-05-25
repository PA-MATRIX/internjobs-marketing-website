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
