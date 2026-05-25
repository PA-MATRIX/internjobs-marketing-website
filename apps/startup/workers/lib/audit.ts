// apps/startup/workers/lib/audit.ts
// v1.4 Phase 28 STARTUP-MCP-10 — Audit log writer.
//
// Called by every execute() handler via finally block — writes regardless of
// success/error. The Fly startup-api endpoint POST /v1/action-log inserts one
// row into startup_action_log per call.
//
// Failure mode: fire-and-forget safe. If the proxy is unreachable we log a
// warning but never throw — the user-facing execute() response is not blocked
// on audit-log success. This is the right trade for a pilot: better to ship
// the user's role than 500 because audit was momentarily down.

import type { Env } from "../types";

export interface AuditLogArgs {
	member_id: string;
	startup_id: string;
	channel: string; // 'mcp' for Phase 28; 'telnyx-sms' for Phase 29
	action: string;
	params_hash?: string; // SHA-256 of JSON.stringify(params) — audit trail, not replay
	status: "ok" | "error";
	error_code?: string;
	latency_ms?: number;
	ip_hash?: string;
	user_agent?: string;
}

async function sha256Hex(input: string): Promise<string> {
	const enc = new TextEncoder();
	const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * Hash an arbitrary params object for the audit trail. Best-effort — if JSON
 * stringification fails (e.g. circular ref), we record "hash_failed" rather
 * than throwing.
 */
export async function hashParams(params: unknown): Promise<string> {
	try {
		return await sha256Hex(JSON.stringify(params));
	} catch {
		return "hash_failed";
	}
}

/**
 * Write one audit log row to startup_action_log via the startup-api proxy.
 * Fire-and-forget safe: logs a warning on failure but never throws.
 */
export async function writeAuditLog(env: Env, args: AuditLogArgs): Promise<void> {
	if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) return;
	try {
		await fetch(`${env.STARTUP_API_URL.replace(/\/$/, "")}/v1/action-log`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			body: JSON.stringify(args),
			signal: AbortSignal.timeout(3000),
		});
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_audit_log_write_failed",
				action: args.action,
				error: (err as Error)?.message ?? String(err),
			}),
		);
	}
}
