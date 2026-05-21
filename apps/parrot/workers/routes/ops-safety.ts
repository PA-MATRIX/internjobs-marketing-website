// v1.3 Phase 20 SAFETY-VIEW-01 — /api/ops/safety API routes.
//
//   GET  /api/ops/safety                    — paginated flag log (operator-only)
//   GET  /api/ops/safety/unreviewed-count   — badge count (any authed employee)
//   POST /api/ops/safety/mark-reviewed      — mark event(s) reviewed (operator-only)
//
// Neon-exit (2026-05-21): safety_events lives in the student app's Postgres
// (see apps/app migration 0009_v1_3_safety_events.sql). That DB moved off
// Neon to a Fly-internal host the Worker can't reach, so these routes now
// proxy to the student app's /internal/safety-events API (Bearer
// STUDENT_API_SECRET). When STUDENT_API_URL/SECRET are unset or the call
// fails, every route degrades fail-soft and returns empty results.

import { Hono } from "hono";
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

// Call the student app's internal safety-events API. Returns null when the
// API is not configured or the request throws — callers degrade fail-soft.
async function callStudentApi(
	env: { STUDENT_API_URL?: string; STUDENT_API_SECRET?: string },
	path: string,
	init?: RequestInit,
): Promise<Response | null> {
	if (!env.STUDENT_API_URL || !env.STUDENT_API_SECRET) return null;
	try {
		return await fetch(`${env.STUDENT_API_URL}${path}`, {
			...init,
			headers: {
				...(init?.headers ?? {}),
				authorization: `Bearer ${env.STUDENT_API_SECRET}`,
				"content-type": "application/json",
			},
		});
	} catch {
		return null;
	}
}

export const opsSafety = new Hono<ParrotContext>();

// GET /api/ops/safety — paginated flag log (last 100 events, last 7 days).
// Operator-only.
opsSafety.get("/", requireOperator, async (c) => {
	const res = await callStudentApi(c.env, "/internal/safety-events");
	if (!res || !res.ok) {
		return c.json({ events: [], total: 0, error: "safety_events_not_configured" });
	}
	try {
		const data = (await res.json()) as { events?: SafetyEventRow[] };
		const events = (data.events ?? []).map((row) => ({
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
// shows for all workspace members when there's a safety flag.
opsSafety.get("/unreviewed-count", async (c) => {
	const res = await callStudentApi(c.env, "/internal/safety-events/unreviewed-count");
	if (!res || !res.ok) {
		return c.json({ count: 0 });
	}
	try {
		const data = (await res.json()) as { count?: number };
		return c.json({ count: data.count ?? 0 });
	} catch {
		return c.json({ count: 0 });
	}
});

// POST /api/ops/safety/mark-reviewed — operator marks event(s) reviewed.
opsSafety.post("/mark-reviewed", requireOperator, async (c) => {
	const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
	const employee = c.var.employee;
	const reviewedBy = employee?.email ?? "operator";
	const res = await callStudentApi(c.env, "/internal/safety-events/mark-reviewed", {
		method: "POST",
		body: JSON.stringify({ ids: body?.ids, reviewed_by: reviewedBy }),
	});
	if (!res || !res.ok) {
		return c.json({ ok: false, error: "not_configured" }, 503);
	}
	return c.json({ ok: true });
});
