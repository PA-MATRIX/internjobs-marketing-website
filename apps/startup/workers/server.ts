// apps/startup/workers/server.ts
// v1.4 Phase 28 STARTUP-MCP-01..06 — Startup MCP server factory.
//
// SECURITY CRITICAL: createStartupMcpServer() MUST be called inside the
// fetch handler (per request), never at module level. A shared McpServer
// instance causes cross-client data leaks (SDK 1.26.0+ security note).
// We re-instantiate per request via buildMcpHandler() below.
//
// Transport: Streamable HTTP (SSE deprecated March 2025; createMcpHandler
// uses the Streamable HTTP transport by default via WorkerTransport).
// Tools: me, discover_actions, search, execute (4 tools — catalog fixed).
//
// Auth: the Hono middleware in app.ts validates the Bearer token and
// passes StartupAuthProps via createMcpHandler({ authContext: { props } }).
// Inside each tool we read it via getMcpAuthContext().

import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Env, StartupAuthProps, StartupContext } from "./types";
import { handleMe } from "./tools/me";
import { handleDiscoverActions } from "./tools/discover-actions";
import { handleSearch } from "./tools/search";
import { handleExecute } from "./tools/execute";

/** Wrap a plain result as MCP tool output. */
export function mcpText(result: unknown) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(result, null, 2) },
		],
	};
}

/** Wrap an error as MCP tool output (isError signals tool-level failure, not protocol error). */
export function mcpError(message: string, code?: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ error: message, code }),
			},
		],
		isError: true as const,
	};
}

/**
 * Cast getMcpAuthContext() props to our typed StartupAuthProps.
 * Returns null if the context is missing (should only happen on a misrouted
 * direct invocation — the Hono auth middleware always sets it for /mcp routes).
 */
function readAuthProps(): StartupAuthProps | null {
	const ctx = getMcpAuthContext();
	if (!ctx?.props) return null;
	const p = ctx.props as Partial<StartupAuthProps>;
	if (!p.startup_id || !p.member_id || !p.env) return null;
	return p as StartupAuthProps;
}

/**
 * Create a fresh McpServer per request. NEVER call this at module scope.
 * Called by buildMcpHandler() below — which itself is called inside the
 * Hono /mcp route handler in app.ts (once per request).
 */
export function createStartupMcpServer() {
	const server = new McpServer({
		name: "internjobs-startup",
		version: "1.0.0",
	});

	// ── me ────────────────────────────────────────────────────────────────
	server.tool(
		"me",
		"Returns your startup identity: name, member info, active role count, and recent activity summary.",
		{},
		async () => {
			const props = readAuthProps();
			if (!props) return mcpError("not_authenticated");
			return mcpText(await handleMe(props));
		},
	);

	// ── discover_actions ──────────────────────────────────────────────────
	server.tool(
		"discover_actions",
		"Lists all available write actions with their JSON input schemas. Call this before execute() to see what actions are available and what parameters each requires.",
		{},
		async () => {
			return mcpText(handleDiscoverActions());
		},
	);

	// ── search ────────────────────────────────────────────────────────────
	server.tool(
		"search",
		"Semantic + structured search. scope must be one of: roles | candidates | threads | messages | members | startups. Returns {id, summary, score} list. Use IDs with execute() for actions.",
		{
			scope: z
				.enum([
					"roles",
					"candidates",
					"threads",
					"messages",
					"members",
					"startups",
				])
				.describe("What to search"),
			query: z.string().describe("Natural language search query"),
			filters: z
				.record(z.unknown())
				.optional()
				.describe(
					"Structured filters e.g. {role_id: 'uuid', status: 'active'}",
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.default(10)
				.describe("Max results (1–20, default 10)"),
		},
		async ({ scope, query, filters, limit }) => {
			const props = readAuthProps();
			if (!props) return mcpError("not_authenticated");
			return mcpText(
				await handleSearch({
					startup_id: props.startup_id,
					scope,
					query,
					filters,
					limit,
					env: props.env,
				}),
			);
		},
	);

	// ── execute ───────────────────────────────────────────────────────────
	server.tool(
		"execute",
		"Execute a write action. action must be one of: post_role | reply_to_candidate | update_role | archive_role | mark_candidate. Call discover_actions() first to see parameter schemas.",
		{
			action: z
				.enum([
					"post_role",
					"reply_to_candidate",
					"update_role",
					"archive_role",
					"mark_candidate",
				])
				.describe("Action to execute"),
			params: z
				.record(z.unknown())
				.describe(
					"Action-specific parameters (see discover_actions for schemas)",
				),
		},
		async ({ action, params }) => {
			const props = readAuthProps();
			if (!props) return mcpError("not_authenticated");
			return mcpText(
				await handleExecute({
					startup_id: props.startup_id,
					member_id: props.member_id,
					action,
					params,
					env: props.env,
				}),
			);
		},
	);

	return server;
}

/**
 * Build a fresh MCP handler for one request.
 * Called from the Hono /mcp route handler in app.ts after auth middleware
 * has populated startupCtx.
 */
export function buildMcpHandler(env: Env, startupCtx: StartupContext) {
	const props: StartupAuthProps = { ...startupCtx, env };
	return createMcpHandler(createStartupMcpServer(), {
		authContext: { props: props as unknown as Record<string, unknown> },
	});
}
