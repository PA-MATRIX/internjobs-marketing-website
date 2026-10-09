// v1.5 Phase 36 Plan 03: 30-day spam auto-purge (locked decision 2026-07-09).
//
// Scheduler: reuses the EXISTING CF Worker Cron Trigger (*/5 * * * *) declared in
// wrangler.jsonc for the Phase 19 auto-clear cron — no new trigger is added. Called
// from app.ts's scheduled() handler via ctx.waitUntil(), alongside runAutoClear(env).
//
// Throttle: the cron fires every 5 minutes, but a full sweep only needs to run about
// once a day. A KV-backed last-run timestamp (reusing the existing PARROT_FEATURE_FLAGS
// binding, key "spam_purge_last_run" — distinct from the "safety_skip_senders" key it
// already holds) gates the sweep so pilot-scale (~50 employee) fan-out isn't repeated
// 288x/day.
//
// Throttle fails SAFE — i.e. toward purging, never toward never-purging. Every way the
// gate can fail to produce a usable "ran recently" answer falls through to a sweep:
//   - KV binding absent           → sweep every tick
//   - KV get() rejects            → .catch(() => null) → sweep
//   - key missing / empty         → sweep
//   - stored value unparseable    → Date.parse → NaN → !Number.isFinite → sweep
//   - put() rejects after a sweep → logged, not thrown; next tick simply sweeps again
// An extra sweep costs a few idempotent DO RPCs that delete nothing. A missed sweep means
// quarantined mail accumulates forever, silently defeating the retention policy. Only the
// single case of a *successfully read, parseable, recent* timestamp skips the sweep.
//
// Fail-soft contract: NEVER throws. Mirrors auto-clear.ts's per-item try/catch — one
// employee's DO failing must not stop the sweep for the rest.
//
// Note: purgeExpiredSpam() deletes SQLite rows only; it does not reap the R2 attachment
// blobs, matching the pre-existing Trash hard-delete limitation (36-01 SUMMARY, note 6).

import type { Env } from "../types";

const RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // ~once/day
const LAST_RUN_KV_KEY = "spam_purge_last_run";

/**
 * Cron-triggered spam retention sweep.
 *
 * Step 0: Throttle gate — skip if a sweep completed within the last ~24h.
 * Step 1: List employees from the singleton WorkspaceDO.
 * Step 2: For each, call EmployeeMailboxDO.purgeExpiredSpam(cutoffIso) to hard-delete
 *         spam-foldered mail older than RETENTION_DAYS.
 * Step 3: Record the last-run timestamp so the next 287 ticks of the day no-op.
 *
 * Fail-soft throughout — see the contract above. Resolves with `void` regardless of
 * partial failures; per-employee errors are logged and the loop continues.
 */
export async function runSpamPurge(env: Env): Promise<void> {
	// Step 0: Throttle gate. Only a confirmed-recent timestamp skips the sweep.
	if (env.PARROT_FEATURE_FLAGS) {
		const lastRun = await env.PARROT_FEATURE_FLAGS.get(LAST_RUN_KV_KEY).catch(
			() => null,
		);
		if (lastRun) {
			const elapsed = Date.now() - Date.parse(lastRun);
			if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < PURGE_INTERVAL_MS) {
				return; // Ran recently — skip this tick.
			}
		}
	}

	if (!env.WORKSPACE || !env.EMPLOYEE_MAILBOX) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "spam_purge_skip",
				reason: "WORKSPACE or EMPLOYEE_MAILBOX binding missing",
			}),
		);
		return;
	}

	// Step 1: List employees.
	let employees: Array<{ clerk_user_id: string }>;
	try {
		const workspaceStub = env.WORKSPACE.get(env.WORKSPACE.idFromName("workspace"));
		employees = await workspaceStub.listEmployees();
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "spam_purge_list_employees_failed",
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return;
	}

	const cutoffIso = new Date(
		Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();

	// Step 2: Fan out one purge RPC per employee.
	let totalPurged = 0;
	for (const employee of employees) {
		try {
			const mailboxStub = env.EMPLOYEE_MAILBOX.get(
				env.EMPLOYEE_MAILBOX.idFromName(employee.clerk_user_id),
			);
			const result = await mailboxStub.purgeExpiredSpam(cutoffIso);
			if (result.purged > 0) {
				totalPurged += result.purged;
				console.log(
					JSON.stringify({
						level: "info",
						event: "spam_purge_employee",
						employee_id: employee.clerk_user_id,
						purged: result.purged,
					}),
				);
			}
		} catch (err) {
			// Fail-soft per-employee: log and continue, matching auto-clear.ts's contract.
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "spam_purge_employee_failed",
					employee_id: employee.clerk_user_id,
					error: (err as Error | null)?.message ?? String(err),
				}),
			);
		}
	}

	console.log(
		JSON.stringify({
			level: "info",
			event: "spam_purge_sweep_complete",
			employees: employees.length,
			purged: totalPurged,
			cutoff: cutoffIso,
		}),
	);

	// Step 3: Record the sweep so the throttle gate holds for ~24h. A failed write only
	// costs an extra sweep next tick — the safe direction.
	if (env.PARROT_FEATURE_FLAGS) {
		await env.PARROT_FEATURE_FLAGS.put(
			LAST_RUN_KV_KEY,
			new Date().toISOString(),
		).catch((err) => {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "spam_purge_last_run_write_failed",
					error: (err as Error | null)?.message ?? String(err),
				}),
			);
		});
	}
}
