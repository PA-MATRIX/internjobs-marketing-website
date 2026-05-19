// v1.3 Phase 20 SAFETY-VIEW-01: /api/ops/safety API routes.
//
//   GET  /api/ops/safety                    — paginated flag log (operator-only)
//   GET  /api/ops/safety/unreviewed-count   — badge count (any authed employee)
//   POST /api/ops/safety/mark-reviewed      — mark event(s) reviewed (operator-only)
//
// Data lives in Neon Postgres (cross-employee aggregate view — see migration
// 0009_v1_3_safety_events.sql). Worker reaches Neon via @neondatabase/serverless
// (HTTP-based driver, CF Workers compatible). When NEON_DATABASE_URL is unset,
// every route degrades fail-soft and returns empty results.

import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import type { ParrotContext } from "../lib/mailbox";
import { requireOperator } from "../lib/operator";

// Human-readable labels for Lakera reason codes (FEATURES.md UX gotcha:
// raw codes are confusing in the table — operators want plain English).
const REASON_LABELS: Record<string, string> = {
	prompt_injection: "Injection attempt",
	jailbreak: "Jailbreak attempt",
	pii_detection: "Personal info detected",
	unknown: "Policy violation",
	passed_lakera_unavailable: "Lakera unavailable (passed through)",
};

interface SafetyEventRow {
	id: string;
	channel: string;
	action: string;
	reason: string | null;
	score: number | null;
	sender_last4: string | null;
	preview: string | null;
	employee_id: string | null;
	reviewed: boolean;
	reviewed_at: string | null;
	created_at: string;
}

export const opsSafety = new Hono<ParrotContext>();

// GET /api/ops/safety — paginated flag log (last 100 events, last 7 days).
// Operator-only.
opsSafety.get("/", requireOperator, async (c) => {
	const env = c.env;
	if (!env.NEON_DATABASE_URL) {
		return c.json({ events: [], total: 0, error: "safety_events_not_configured" });
	}
	try {
		const sql = neon(env.NEON_DATABASE_URL);
		const rows = (await sql`
			select
				id,
				channel,
				action,
				reason,
				score,
				sender_last4,
				preview,
				employee_id,
				reviewed,
				reviewed_at,
				created_at
			from safety_events
			where created_at > now() - interval '7 days'
			order by created_at desc
			limit 100
		`) as unknown as SafetyEventRow[];

		const events = rows.map((row) => ({
			...row,
			reason_label: REASON_LABELS[row.reason ?? ""] ?? String(row.reason ?? "unknown"),
			preview: String(row.preview ?? "").slice(0, 80),
		}));

		return c.json({ events, total: events.length });
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "ops_safety_query_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return c.json({ events: [], total: 0, error: "query_failed" });
	}
});

// GET /api/ops/safety/unreviewed-count — red-dot badge data.
// Returns count of unreviewed flagged events within last 24h.
// Accessible to ANY authenticated employee (not operator-only) so the badge
// shows for all workspace members when there's a safety flag. Operators
// handle the review; all employees see the signal.
opsSafety.get("/unreviewed-count", async (c) => {
	const env = c.env;
	if (!env.NEON_DATABASE_URL) {
		return c.json({ count: 0 });
	}
	try {
		const sql = neon(env.NEON_DATABASE_URL);
		const rows = (await sql`
			select count(*)::int as n
			from safety_events
			where reviewed = false
			  and action in ('flagged', 'blocked')
			  and created_at > now() - interval '24 hours'
		`) as unknown as Array<{ n: number }>;

		const count = rows[0]?.n ?? 0;
		return c.json({ count });
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "ops_safety_unreviewed_count_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return c.json({ count: 0 });
	}
});

// POST /api/ops/safety/mark-reviewed — operator marks event(s) reviewed.
opsSafety.post("/mark-reviewed", requireOperator, async (c) => {
	const env = c.env;
	if (!env.NEON_DATABASE_URL) {
		return c.json({ ok: false, error: "not_configured" }, 503);
	}
	const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
	const ids = body?.ids;
	const employee = c.var.employee;
	const reviewedBy = employee?.email ?? "operator";
	try {
		const sql = neon(env.NEON_DATABASE_URL);
		if (ids && ids.length > 0) {
			await sql`
				update safety_events
				set reviewed = true, reviewed_at = now(), reviewed_by = ${reviewedBy}
				where id = any(${ids}::uuid[])
			`;
		} else {
			// Mark all unreviewed from last 24h reviewed
			await sql`
				update safety_events
				set reviewed = true, reviewed_at = now(), reviewed_by = ${reviewedBy}
				where reviewed = false
				  and created_at > now() - interval '24 hours'
			`;
		}
		return c.json({ ok: true });
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "ops_safety_mark_reviewed_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return c.json({ ok: false, error: "update_failed" }, 500);
	}
});
