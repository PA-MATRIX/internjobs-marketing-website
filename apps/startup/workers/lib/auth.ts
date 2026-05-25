// apps/startup/workers/lib/auth.ts
// v1.4 Phase 28 STARTUP-MCP-02 — Per-startup Bearer token validation.
//
// Auth flow:
//   1. Extract raw token from `Authorization: Bearer <token>` header.
//   2. SHA-256 hash the raw token (crypto.subtle — CF Workers WebCrypto).
//   3. POST to internjobs-startup-api /v1/startups/token with { token_hash }.
//   4. Proxy returns { startup_id, member_id, startup_name } or 404.
//
// SECURITY NOTES:
//   - Token is ALWAYS in `Authorization: Bearer` header, never in URL path
//     (URL paths leak in logs, HTTP referrers, and intermediate proxies).
//   - Rate limit by startup_id (stable across token rotation), not by token hash.
//   - We rely on the upstream proxy's hashed lookup for the actual auth decision.
//     The proxy already runs a constant-time compare server-side (node:crypto
//     timingSafeEqual on the bearer header to STARTUP_API_SECRET). The Worker's
//     responsibility is to (a) hash the user-supplied token before sending,
//     (b) never log the raw token, and (c) treat any non-2xx as auth failure.

import type { Env, StartupContext } from "../types";

/** SHA-256 the raw token → 64-char lowercase hex string. */
async function hashToken(rawToken: string): Promise<string> {
	const enc = new TextEncoder();
	const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * Validates the incoming `Authorization: Bearer` token against the startup DB.
 *
 * Returns:
 *   - StartupContext on success ({ startup_id, member_id, startup_name }).
 *   - null on any failure (missing env, network error, 4xx from proxy, malformed response).
 *
 * Never throws — callers can rely on null-on-failure for the 401 path.
 */
export async function validateBearerToken(
	rawToken: string,
	env: Env,
): Promise<StartupContext | null> {
	if (!rawToken || !env.STARTUP_API_URL || !env.STARTUP_API_SECRET) return null;

	let tokenHash: string;
	try {
		tokenHash = await hashToken(rawToken);
	} catch {
		return null;
	}

	let row: StartupContext | null = null;
	try {
		const res = await fetch(
			`${env.STARTUP_API_URL.replace(/\/$/, "")}/v1/startups/token`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
				},
				body: JSON.stringify({ token_hash: tokenHash }),
				signal: AbortSignal.timeout(5000),
			},
		);
		if (!res.ok) return null;
		row = (await res.json()) as StartupContext;
	} catch {
		return null;
	}

	if (!row?.startup_id || !row?.member_id) return null;

	return {
		startup_id: row.startup_id,
		member_id: row.member_id,
		startup_name: row.startup_name,
	};
}
