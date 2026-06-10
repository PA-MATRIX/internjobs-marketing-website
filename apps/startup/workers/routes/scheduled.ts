// apps/startup/workers/routes/scheduled.ts
// v1.4 Phase 29-03 STARTUP-TOUCHBASE-01..02 — Weekly touchbase cron.
//
// The CF Workers `scheduled` export is dispatched on the schedule in
// wrangler.jsonc `triggers.crons` — for Phase 29-03 that's "0 14 * * 1"
// (Monday 14:00 UTC ≈ 9:00am EST / 10:00am EDT — 1h drift accepted for v1.4;
// per-startup timezones are a v1.5 polish).
//
// Flow:
//   1. GET /v1/touchbase/due-startups  (up to 100 startups eligible this week)
//   2. For each startup:
//        a. GET /v1/startups/<id>/fresh-candidates  (up to 3 most recent)
//        b. Compose SMS body — "hey <founder> — N new this week ... reply 1/2/3"
//        c. If TOUCHBASE_CURSORS KV is bound + N>=1: write cursor at
//           `touchbase:cursor:<phone>` with 48h TTL so reply "1"/"2"/"3" can
//           resolve to the right candidate thread.
//        d. sendSms(env, phone, body)
//        e. On success: PATCH /v1/channel-links/<id>/touchbase-sent so
//           last_touchbase_at advances (otherwise next week we'd retry).
//   3. Log completion summary.
//
// Ops-deferred guards:
//   - If env.TELNYX_API_KEY is unbound: log + return (no cron fires before
//     DEFER-29-01-E closes; cron is otherwise idempotent so it's safe to
//     skip until secrets land).
//   - If env.TOUCHBASE_CURSORS KV is unbound: continue WITHOUT writing
//     cursors — the SMS still goes out, the "reply 1/2/3" path in telnyx.ts
//     falls through to the LLM intent classifier gracefully.
//   - If env.STARTUP_API_URL is unbound (basically impossible — set in vars):
//     log + return.
//
// Errors are caught at each per-startup boundary so one bad startup doesn't
// halt the whole batch. The function itself never throws — CF Workers cron
// swallows thrown exceptions silently, so we'd lose the diagnostic.

import type { Env } from "../types";
import { sendSms } from "../lib/telnyx";

interface DueStartup {
	channel_link_id: string;
	startup_id: string;
	phone: string;
	member_id: string | null;
	startup_name: string;
	founder_name: string | null;
}

interface FreshCandidate {
	thread_id: string;
	candidate_name: string;
	role_title: string | null;
	summary: string | null;
}

const KV_CURSOR_TTL_SECONDS = 60 * 60 * 48; // 48h — touchbase replies stay actionable for two days.

/**
 * Compose the touchbase SMS body for a startup with N candidates (N may be 0).
 *
 * Format (with candidates):
 *   hey <founder_name> — 3 new intern candidates this week for <startup_name>.
 *   reply 1/2/3 to see a candidate, or 'stop' to opt out.
 *   1. Jane Doe (Frontend Intern)
 *   2. Alex Lee (Backend Intern)
 *   3. Sam Patel
 *
 * Format (no candidates):
 *   hey <founder_name> — no new candidates this week, but we're actively
 *   sourcing. we'll text when someone great applies. reply 'stop' to opt out.
 */
export function composeTouchbaseSms(
	founderName: string | null,
	startupName: string,
	candidates: FreshCandidate[],
): string {
	const who = founderName?.trim() || "there";
	if (candidates.length === 0) {
		return (
			`hey ${who} — no new candidates this week, but we're actively ` +
			`sourcing. we'll text when someone great applies. ` +
			`reply 'stop' to opt out.`
		);
	}
	const header =
		`hey ${who} — ${candidates.length} new intern candidate${candidates.length === 1 ? "" : "s"} ` +
		`this week for ${startupName}.\n` +
		`reply 1/2/3 to see a candidate, or 'stop' to opt out.`;
	const list = candidates
		.map((c, i) => {
			const role = c.role_title ? ` (${c.role_title})` : "";
			return `${i + 1}. ${c.candidate_name}${role}`;
		})
		.join("\n");
	return `${header}\n${list}`;
}

async function fetchDueStartups(env: Env): Promise<DueStartup[]> {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const res = await fetch(`${base}/v1/touchbase/due-startups`, {
		method: "GET",
		headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_due_fetch_failed",
				status: res.status,
			}),
		);
		return [];
	}
	const body = (await res.json().catch(() => ({}))) as { due?: DueStartup[] };
	return Array.isArray(body?.due) ? body.due : [];
}

async function fetchFreshCandidates(
	env: Env,
	startupId: string,
): Promise<FreshCandidate[]> {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const url = `${base}/v1/startups/${encodeURIComponent(startupId)}/fresh-candidates`;
	const res = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_fresh_fetch_failed",
				startup_id: startupId,
				status: res.status,
			}),
		);
		return [];
	}
	const body = (await res.json().catch(() => ({}))) as {
		candidates?: FreshCandidate[];
	};
	return Array.isArray(body?.candidates) ? body.candidates : [];
}

async function markTouchbaseSent(
	env: Env,
	channelLinkId: string,
): Promise<void> {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	try {
		await fetch(
			`${base}/v1/channel-links/${encodeURIComponent(channelLinkId)}/touchbase-sent`,
			{
				method: "PATCH",
				headers: { Authorization: `Bearer ${env.STARTUP_API_SECRET}` },
				signal: AbortSignal.timeout(5000),
			},
		);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_mark_sent_failed",
				channel_link_id: channelLinkId,
				error: (err as Error)?.message ?? String(err),
			}),
		);
	}
}

async function writeCursor(
	env: Env,
	phone: string,
	candidates: FreshCandidate[],
): Promise<void> {
	if (!env.TOUCHBASE_CURSORS) return;
	if (candidates.length === 0) return;
	const key = `touchbase:cursor:${phone}`;
	// Strip `summary` from KV payload — only thread_id + candidate_name + role_title
	// are needed for the "reply 1/2/3" lookup. Keeps KV value small.
	const value = JSON.stringify(
		candidates.map((c) => ({
			thread_id: c.thread_id,
			candidate_name: c.candidate_name,
			role_title: c.role_title,
		})),
	);
	try {
		await env.TOUCHBASE_CURSORS.put(key, value, {
			expirationTtl: KV_CURSOR_TTL_SECONDS,
		});
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_kv_put_failed",
				phone_preview: phone.slice(-4),
				error: (err as Error)?.message ?? String(err),
			}),
		);
	}
}

/**
 * The actual cron body — exported separately so it can be unit-tested by
 * mocking env (KV, fetch) without invoking the CF runtime's scheduled()
 * dispatcher.
 */
export async function runWeeklyTouchbase(env: Env): Promise<void> {
	if (!env.TELNYX_API_KEY) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_cron_skipped",
				reason: "TELNYX_API_KEY unbound (DEFER-29-01-E)",
			}),
		);
		return;
	}
	if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_touchbase_cron_skipped",
				reason: "STARTUP_API_URL or STARTUP_API_SECRET unbound",
			}),
		);
		return;
	}

	const due = await fetchDueStartups(env);
	let dispatched = 0;
	let failed = 0;

	for (const startup of due) {
		try {
			const candidates = await fetchFreshCandidates(env, startup.startup_id);
			const body = composeTouchbaseSms(
				startup.founder_name,
				startup.startup_name,
				candidates,
			);

			// Write cursor BEFORE sending SMS — otherwise a fast "reply 1" could
			// race the KV write and lose. (CF KV is eventually-consistent but
			// reads within the same colo are typically <100ms.)
			await writeCursor(env, startup.phone, candidates);

			await sendSms(env, startup.phone, body);
			await markTouchbaseSent(env, startup.channel_link_id);
			dispatched++;

			console.log(
				JSON.stringify({
					level: "info",
					event: "startup_touchbase_cron_sent",
					startup_id: startup.startup_id,
					phone_preview: startup.phone.slice(-4),
					candidate_count: candidates.length,
				}),
			);
		} catch (err) {
			failed++;
			console.error(
				JSON.stringify({
					level: "error",
					event: "startup_touchbase_cron_per_startup_failed",
					startup_id: startup.startup_id,
					error: (err as Error)?.message ?? String(err),
				}),
			);
			// Continue to next startup — one bad row mustn't halt the batch.
		}
	}

	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_touchbase_cron_complete",
			processed: due.length,
			dispatched,
			failed,
		}),
	);
}

/**
 * CF Workers scheduled() entry point. Registered in apps/startup/workers/app.ts
 * via the default export's `scheduled` field.
 */
export async function scheduled(
	_event: ScheduledController,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	ctx.waitUntil(runWeeklyTouchbase(env));
}
