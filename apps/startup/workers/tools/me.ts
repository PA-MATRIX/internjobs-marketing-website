// apps/startup/workers/tools/me.ts
// v1.4 Phase 28 STARTUP-MCP-03 — me() tool handler.
//
// Returns the authenticated startup's identity, role count, and a one-line
// recent-activity summary. This is the founder's first call after install —
// confirms the token works AND prompts them to call discover_actions() next.
//
// role_count placeholder: 0 in this plan. Plan 28-03 will add a
// `GET /v1/startups/:id/stats` endpoint to the Fly proxy and wire it here.

import type { Env, StartupContext } from "../types";

export interface MeResult {
	startup: { id: string; name: string };
	member: { id: string };
	role_count: number;
	recent_activity: string;
}

export async function handleMe(
	ctx: StartupContext & { env: Env },
): Promise<MeResult> {
	// role_count is a stub in 28-02. 28-03 will wire to /v1/startups/:id/stats.
	// We fail-soft (stays 0) rather than calling an endpoint that doesn't exist yet —
	// the proxy contract is locked at 28-01 and adding GET /v1/startups/:id/stats
	// is scoped to 28-03.
	const role_count = 0;

	return {
		startup: { id: ctx.startup_id, name: ctx.startup_name },
		member: { id: ctx.member_id },
		role_count,
		recent_activity:
			"No recent activity yet. Call discover_actions() to see what you can do.",
	};
}
