// v1.3 Phase 19 Plan 01: Cron reconciliation — closes todos in EmployeeMailboxDO
// when their underlying :Todo node's valid_to has been set in FalkorDB.
//
// Requirements: AUTO-CLEAR-01..05
//
// Scheduler: CF Worker Cron Trigger (*/5 * * * *) — see wrangler.jsonc
// `triggers.crons`. Called from app.ts scheduled() handler via ctx.waitUntil.
//
// Fail-soft contract: NEVER throws. On any error, logs a structured warning
// and returns. The dashboard continues to show active todos even if the
// graph proxy is down — the cron just won't auto-clear until the proxy
// recovers. UX trumps consistency here (REQUIREMENTS.md PARROT-AUTO-CLEAR).
//
// Cross-namespace isolation (AUTO-CLEAR-04):
//   The Cypher queries `:Todo` nodes (Parrot label namespace, written by
//   recordTodoFact in graph.ts). It does NOT touch the student app's
//   `:Fact` label namespace. The reconciliation is single-namespace.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers cron Trigger handler, fetch() with Bearer auth
//   cloudflare/skills: durable-objects — DO stub RPC (resolveTodo) called from cron

import type { Env } from "../types";

interface ClosedTodoRow {
	source_id: string;
	employee_id: string;
	valid_to: string;
}

/**
 * Cypher: find :Todo nodes where valid_to IS NOT NULL AND the close-out
 * happened more than 5 minutes ago (minimum-open-window guard).
 *
 * The 5-minute grace period is non-negotiable (PITFALL-AC-01): without it,
 * newly-created todos could flash into the dashboard and disappear before
 * Ridhi reads them, because recordTodoFact() may set valid_to almost
 * immediately on a subsequent message in the same thread.
 *
 * Cross-namespace note (AUTO-CLEAR-04): we query `:Todo` directly because
 * recordTodoFact mirrors valid_to onto :Todo nodes via the PARROT-AUTO-CLEAR
 * write path in graph.ts. :Fact nodes (student namespace) also carry
 * valid_to but are NOT the subject of this query — the reconciliation
 * does not cross into the student app's label namespace.
 *
 * LIMIT 100 caps a single cron tick — at 5-employee pilot scale we expect
 * ~0-5 hits per tick; the cap exists so a runaway graph state (e.g., a bulk
 * close-out script) doesn't fan out into hundreds of DO RPCs per cron run.
 */
const FIND_CLOSED_TODOS_CYPHER = `
	MATCH (t:Todo)
	WHERE t.valid_to IS NOT NULL
		AND t.valid_to < datetime() - duration({minutes: 5})
	RETURN t.source_id AS source_id,
				 t.employee_id AS employee_id,
				 t.valid_to AS valid_to
	LIMIT 100
`;

/**
 * Cron-triggered reconciliation entrypoint.
 *
 * Step 1: Query the graph proxy for :Todo nodes past the grace window.
 * Step 2: For each match, call EmployeeMailboxDO.resolveTodo(sourceId) on
 *         the owning employee's DO instance to flip the SQLite row.
 *
 * Both steps are fail-soft — see fail-soft contract above. The function
 * resolves with `void` regardless of partial failures; per-item errors
 * are logged and the loop continues.
 */
export async function runAutoClear(env: Env): Promise<void> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "auto_clear_skip",
				reason: "GRAPH_API_URL or GRAPH_API_SECRET not configured",
			}),
		);
		return;
	}

	// Step 1: Query FalkorDB via graph proxy for closed :Todo nodes.
	let closedTodos: ClosedTodoRow[];
	try {
		const res = await fetch(`${env.GRAPH_API_URL}/query`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.GRAPH_API_SECRET}`,
			},
			body: JSON.stringify({
				cypher: FIND_CLOSED_TODOS_CYPHER,
				params: {},
			}),
		});
		if (!res.ok) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "auto_clear_graph_error",
					status: res.status,
				}),
			);
			return;
		}
		const json = (await res.json()) as { data?: unknown[] };
		const rows = json.data ?? [];
		closedTodos = rows
			.map((r) => {
				// FalkorDB can return rows as positional arrays OR named-column
				// objects depending on driver version. Handle both shapes (same
				// defensive pattern used in graph.ts read helpers).
				const row = Array.isArray(r)
					? { source_id: r[0], employee_id: r[1], valid_to: r[2] }
					: (r as ClosedTodoRow);
				return {
					source_id: String(row.source_id ?? ""),
					employee_id: String(row.employee_id ?? ""),
					valid_to: String(row.valid_to ?? ""),
				};
			})
			.filter((r) => r.source_id && r.employee_id);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "auto_clear_graph_fetch_failed",
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return;
	}

	if (closedTodos.length === 0) return;

	console.log(
		JSON.stringify({
			level: "info",
			event: "auto_clear_candidates",
			count: closedTodos.length,
		}),
	);

	// Step 2: For each closed :Todo, call resolveTodo on the employee's DO.
	for (const todo of closedTodos) {
		try {
			const doId = env.EMPLOYEE_MAILBOX.idFromName(todo.employee_id);
			const stub = env.EMPLOYEE_MAILBOX.get(doId);
			const result = await stub.resolveTodo(todo.source_id);
			if (result.resolved) {
				console.log(
					JSON.stringify({
						level: "info",
						event: "auto_clear_resolved",
						employee_id: todo.employee_id,
						source_id: todo.source_id,
					}),
				);
			}
		} catch (err) {
			// Fail-soft per-item: log and continue the loop. A single employee's
			// DO failure must not stop reconciliation for other employees.
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "auto_clear_resolve_failed",
					employee_id: todo.employee_id,
					source_id: todo.source_id,
					error: (err as Error | null)?.message ?? String(err),
				}),
			);
		}
	}
}
