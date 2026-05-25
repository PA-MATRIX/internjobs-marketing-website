// apps/startup/workers/routes/admin.ts
// v1.4 Phase 28 STARTUP-ADMIN-01 + STARTUP-ADMIN-02
//
// POST /admin/startups/new — Ridhi's concierge onboarding endpoint.
//
// Auth: Authorization: Bearer <STARTUP_MCP_ADMIN_SECRET> (pre-shared secret,
// separate from the per-startup install tokens that gate /mcp). Ridhi-only.
//
// Flow:
//   1. Validate admin secret (constant-time via crypto.subtle.timingSafeEqual).
//   2. Call startup-api POST /v1/startups -> { startup_id, member_id, token }.
//      (The Fly proxy creates the startup row, the founder startup_members row,
//      and the 'mcp' startup_channel_links row in one transaction — also
//      hashes the token and stores hash in startups.mcp_token_hash.)
//   3. Fire SMS to founder_phone with install snippet (ctx.waitUntil — non-blocking).
//   4. Return { ok, startup_id, member_id, token, install_snippet } in response body.
//      Token shown ONCE (plaintext); not stored in plaintext anywhere.
//
// Install snippet format (per 28-RESEARCH locked decision #6):
//   claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp \
//     --header "Authorization: Bearer {TOKEN}"
//
// The response body also includes Cursor .mcp.json format and a ChatGPT note —
// so Ridhi can copy them by hand if SMS delivery fails.
//
// Extension point for Phase 28.5: the createStartup() helper is factored
// separately so a future Clerk-invite step can call it without duplicating
// the proxy fetch + error handling.

import { Hono } from "hono";
import type { Env } from "../types";

// ── Admin secret verification ─────────────────────────────────────────────────

/**
 * Constant-time compare of the provided Bearer secret against the env secret.
 * Returns false on length mismatch without leaking the real length (compares
 * provided against itself to keep both code paths cost-equivalent).
 */
async function verifyAdminSecret(
	provided: string,
	env: Env,
): Promise<boolean> {
	const secret = env.STARTUP_MCP_ADMIN_SECRET;
	if (!secret || !provided) return false;
	const enc = new TextEncoder();
	const a = enc.encode(provided);
	const b = enc.encode(secret);
	if (a.byteLength !== b.byteLength) {
		// Length mismatch is definitive miss. We still do a same-length compare
		// against `a` itself so the early-return branch costs roughly the same
		// as a successful compare (defence-in-depth — Cloudflare's edge cancels
		// most useful timing oracles, but the pattern is cheap).
		return !crypto.subtle.timingSafeEqual(a, a);
	}
	return crypto.subtle.timingSafeEqual(a, b);
}

// ── Install snippet builder ────────────────────────────────────────────────────

/**
 * Builds the multi-line SMS body. Includes:
 *   - Claude Code / Claude Desktop install command
 *   - Cursor / Cline .mcp.json snippet
 *   - ChatGPT MCP connector note
 *   - "save this token" reminder + STOP keyword
 *
 * Stays under the typical 1600-char concatenated SMS limit (Telnyx will split
 * automatically across SMS segments if needed).
 */
function buildInstallSnippet(token: string): string {
	return [
		`hi — you're set up on internjobs! here's how to connect:`,
		``,
		`claude desktop / claude code:`,
		`claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer ${token}"`,
		``,
		`cursor / cline (add to .mcp.json):`,
		`{"mcpServers":{"internjobs":{"type":"http","url":"https://mcp.internjobs.ai/mcp","headers":{"Authorization":"Bearer ${token}"}}}}`,
		``,
		`chatgpt: connect via MCP connector — url: https://mcp.internjobs.ai/mcp, header: Authorization: Bearer ${token}`,
		``,
		`start with: me() to confirm your identity, then discover_actions() to see what you can do.`,
		``,
		`save this token — it won't be shown again. reply STOP to opt out.`,
	].join("\n");
}

// ── SMS send helper ───────────────────────────────────────────────────────────

/**
 * Send the install snippet via Telnyx if TELNYX_API_KEY + TELNYX_FROM_NUMBER
 * are bound on the Worker env; otherwise no-op (the token is also returned in
 * the response body for Ridhi to manually copy).
 *
 * Never throws — meant to be wrapped in ctx.waitUntil() so the response is
 * not blocked. Failures are JSON-logged for observability dashboards.
 *
 * Return shape: { provider, sent } so the caller can record what happened in
 * the response body (e.g. manual_sms_required=true when provider=none).
 */
async function sendInstallSms(
	to: string,
	body: string,
	env: Env,
): Promise<{ provider: "telnyx" | "none"; sent: boolean }> {
	// Optional secrets — not declared on Env interface yet (Phase 29 will).
	const e = env as unknown as Record<string, string | undefined>;
	const telnyxKey = e.TELNYX_API_KEY;
	const telnyxFrom = e.TELNYX_FROM_NUMBER;
	const telnyxProfile = e.TELNYX_MESSAGING_PROFILE_ID;

	if (telnyxKey && telnyxFrom) {
		try {
			const payload: Record<string, unknown> = {
				from: telnyxFrom,
				to,
				text: body,
			};
			if (telnyxProfile) payload.messaging_profile_id = telnyxProfile;

			const res = await fetch("https://api.telnyx.com/v2/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${telnyxKey}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(10000),
			});
			if (res.ok) {
				console.log(
					JSON.stringify({
						level: "info",
						event: "startup_admin_sms_sent",
						provider: "telnyx",
						to,
					}),
				);
				return { provider: "telnyx", sent: true };
			}
			const err = await res.text();
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_admin_sms_telnyx_failed",
					status: res.status,
					error: err.slice(0, 200),
					to,
				}),
			);
			return { provider: "telnyx", sent: false };
		} catch (err) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_admin_sms_telnyx_error",
					error: (err as Error)?.message ?? String(err),
					to,
				}),
			);
			return { provider: "telnyx", sent: false };
		}
	}

	// No SMS provider bound — token is also in response body for manual delivery.
	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_admin_sms_fallback_log",
			provider: "none",
			to,
			note: "Telnyx not configured — token returned in response body for manual SMS",
		}),
	);
	return { provider: "none", sent: false };
}

// ── createStartup() — extracted for Phase 28.5 reuse ──────────────────────────

interface CreateStartupInput {
	company: string;
	founder_email: string;
	founder_phone: string;
}

interface CreateStartupResult {
	startup_id: string;
	member_id: string;
	token: string; // 64 hex chars, plaintext (shown once)
}

interface CreateStartupError {
	status: number;
	body: { error: string };
}

/**
 * Calls the 28-01 Fly proxy POST /v1/startups to mint a startup + founder
 * member + MCP channel link + per-startup install token in one transaction.
 *
 * Phase 28.5 will reuse this helper before invoking Clerk #3 invite +
 * reserving a per-startup agent email slug — so don't inline this back into
 * the route handler.
 *
 * Returns either { ok: true, result } or { ok: false, error }. Never throws.
 */
async function createStartup(
	input: CreateStartupInput,
	env: Env,
): Promise<
	{ ok: true; result: CreateStartupResult } | { ok: false; error: CreateStartupError }
> {
	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	try {
		const res = await fetch(`${base}/v1/startups`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(10000),
		});

		if (res.status === 409) {
			return {
				ok: false,
				error: { status: 409, body: { error: "startup_already_registered" } },
			};
		}
		if (!res.ok) {
			const errText = await res.text();
			console.error(
				JSON.stringify({
					level: "error",
					event: "startup_admin_create_failed",
					status: res.status,
					error: errText.slice(0, 200),
				}),
			);
			return {
				ok: false,
				error: { status: 502, body: { error: "create_failed" } },
			};
		}

		const result = (await res.json()) as CreateStartupResult;
		return { ok: true, result };
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_admin_proxy_error",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return {
			ok: false,
			error: { status: 503, body: { error: "proxy_unavailable" } },
		};
	}
}

// ── Hono router ───────────────────────────────────────────────────────────────

export const adminRouter = new Hono<{ Bindings: Env }>();

// POST /admin/startups/new — concierge onboarding endpoint.
adminRouter.post("/startups/new", async (c) => {
	// 1. Admin auth
	const raw = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!raw || !(await verifyAdminSecret(raw, c.env))) {
		return c.json({ error: "unauthorized" }, 401);
	}

	// 2. Parse body
	let body: { company?: string; founder_email?: string; founder_phone?: string };
	try {
		body = (await c.req.json()) as {
			company?: string;
			founder_email?: string;
			founder_phone?: string;
		};
	} catch {
		return c.json({ error: "invalid_json" }, 400);
	}

	const { company, founder_email, founder_phone } = body;
	if (!company || !founder_email || !founder_phone) {
		return c.json(
			{ error: "company_founder_email_founder_phone_required" },
			400,
		);
	}

	// 3. Create startup + member + channel link + token via Fly proxy
	const created = await createStartup(
		{ company, founder_email, founder_phone },
		c.env,
	);
	if (!created.ok) {
		return c.json(
			created.error.body,
			created.error.status as 400 | 401 | 409 | 502 | 503,
		);
	}
	const { startup_id, member_id, token } = created.result;

	// 4. Build install snippet
	const installSnippetBody = buildInstallSnippet(token);

	// 5. Fire SMS (non-blocking via waitUntil — must not delay the response)
	const e = c.env as unknown as Record<string, string | undefined>;
	const smsProvider: "telnyx" | "none" =
		e.TELNYX_API_KEY && e.TELNYX_FROM_NUMBER ? "telnyx" : "none";
	c.executionCtx.waitUntil(
		sendInstallSms(founder_phone, installSnippetBody, c.env),
	);

	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_admin_onboarded",
			startup_id,
			company,
			sms_provider: smsProvider,
		}),
	);

	// 6. Return token in response body so Ridhi can copy it for manual follow-up
	//    if SMS delivery fails. Token is shown ONCE — startup-api already stored
	//    only the SHA-256 hash; we don't have it after this response.
	return c.json({
		ok: true,
		startup_id,
		member_id,
		token,
		install_snippet: {
			claude_code: `claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer ${token}"`,
			cursor_mcp_json: {
				mcpServers: {
					internjobs: {
						type: "http",
						url: "https://mcp.internjobs.ai/mcp",
						headers: { Authorization: `Bearer ${token}` },
					},
				},
			},
			chatgpt: `Connect via MCP connector — url: https://mcp.internjobs.ai/mcp, header: Authorization: Bearer ${token}`,
			sms_body: installSnippetBody,
		},
		sms_sent_to: founder_phone,
		sms_provider: smsProvider,
		manual_sms_required: smsProvider === "none",
		note: "Token shown here once. Not stored in plaintext. Save it.",
	});
});
