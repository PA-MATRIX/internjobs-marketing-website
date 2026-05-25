// apps/startup/workers/tools/execute.ts
// v1.4 Phase 28 STARTUP-MCP-06..09 — execute() tool handler (PLACEHOLDER STUB).
//
// Plan 28-03 fills this with per-action Zod validation, authorization, audit log,
// and 5 dispatched handlers (post_role / reply_to_candidate / update_role /
// archive_role / mark_candidate). Each handler calls a corresponding endpoint
// on the 28-01 Fly proxy (POST /v1/roles, POST /v1/messages, PATCH /v1/roles/:id,
// PATCH /v1/threads/:id/mark, plus POST /v1/action-log for every call).
//
// Contract (returned shape is stable):
//   { ok: true, placeholder: true, action, _note }

import type { Env } from "../types";

export type ExecuteAction =
	| "post_role"
	| "reply_to_candidate"
	| "update_role"
	| "archive_role"
	| "mark_candidate";

export interface ExecuteArgs {
	startup_id: string;
	member_id: string;
	action: ExecuteAction;
	params: Record<string, unknown>;
	env: Env;
}

export interface ExecuteResult {
	ok: true;
	placeholder: true;
	action: ExecuteAction;
	_note: string;
}

export async function handleExecute(args: ExecuteArgs): Promise<ExecuteResult> {
	return {
		ok: true,
		placeholder: true,
		action: args.action,
		_note: "action handlers land in Plan 28-03 (per-action Zod + authz + audit log + proxy call)",
	};
}
