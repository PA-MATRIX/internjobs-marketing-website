// apps/startup/workers/tools/me.ts
// v1.4 Phase 28 STARTUP-MCP-03 — me() tool handler.
//
// Returns the authenticated startup's identity, active role count, and a
// one-line recent-activity summary. This is the founder's first call after
// install — confirms the token works AND prompts them to call
// discover_actions() next.
//
// As of 28-03: role_count + recent_activity are wired to the live proxy
// endpoint GET /v1/startups/:id/stats (added in 28-03). Fail-soft: if the
// proxy is unreachable we fall back to role_count=0 + a friendly empty-state
// recent_activity message rather than 500'ing the user.

import type { Env, StartupContext } from "../types";

export interface MeResult {
	startup: { id: string; name: string };
	member: { id: string };
	role_count: number;
	recent_activity: string;
}

interface StatsResult {
	active_role_count?: number;
	actions_last_7d?: number;
	last_action_at?: string | null;
}

async function fetchStats(
	startup_id: string,
	env: Env,
): Promise<StatsResult | null> {
	if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) return null;
	try {
		const base = env.STARTUP_API_URL.replace(/\/$/, "");
		const res = await fetch(
			`${base}/v1/startups/${encodeURIComponent(startup_id)}/stats`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
				signal: AbortSignal.timeout(5000),
			},
		);
		if (!res.ok) return null;
		return (await res.json()) as StatsResult;
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_me_stats_fetch_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return null;
	}
}

function summarizeActivity(stats: StatsResult | null): string {
	if (!stats || stats.actions_last_7d === undefined) {
		return "No recent activity yet. Call discover_actions() to see what you can do.";
	}
	if (stats.actions_last_7d === 0) {
		return "No recent activity in the last 7 days. Call discover_actions() to see what you can do.";
	}
	return `${stats.actions_last_7d} action${stats.actions_last_7d === 1 ? "" : "s"} in the last 7 days.`;
}

export async function handleMe(
	ctx: StartupContext & { env: Env },
): Promise<MeResult> {
	const stats = await fetchStats(ctx.startup_id, ctx.env);
	return {
		startup: { id: ctx.startup_id, name: ctx.startup_name },
		member: { id: ctx.member_id },
		role_count: stats?.active_role_count ?? 0,
		recent_activity: summarizeActivity(stats),
	};
}
