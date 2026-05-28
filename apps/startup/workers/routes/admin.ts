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
import { mintSlug, reserveUniqueSlug } from "../lib/slug";

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

// ── Phase 28.5 Plan 04 helpers — per-startup agent email + Clerk invite ──────

/**
 * Reserve a unique slug, write `<slug>@startups.internjobs.ai` to the
 * startup's `agent_email` column, and insert a `startup_channel_links`
 * row with channel_type='email' so the catch-all email handler in
 * routes/email.ts can resolve inbound mail back to the startup.
 *
 * Returns the chosen `agent_email` on success. Throws on Fly proxy
 * failure or slug-collision exhaustion — caller wraps in try/catch and
 * surfaces best-effort to the response (the core startup row is already
 * created at this point; agent email is an additive enrichment).
 */
async function provisionAgentEmail(
	args: { startup_id: string; member_id: string; company: string },
	env: Env,
): Promise<string> {
	const base = mintSlug(args.company);
	if (!base) {
		throw new Error("provisionAgentEmail: company name reduced to empty slug");
	}
	const slug = await reserveUniqueSlug(base, env.STARTUP_API_URL, env.STARTUP_API_SECRET);
	const agentEmail = `${slug}@startups.internjobs.ai`;
	const baseUrl = env.STARTUP_API_URL.replace(/\/$/, "");

	// 1. Patch the startup row with the chosen agent_email.
	const patchRes = await fetch(`${baseUrl}/v1/startups/${args.startup_id}/agent-email`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
		},
		body: JSON.stringify({ agent_email: agentEmail }),
		signal: AbortSignal.timeout(8000),
	});
	if (!patchRes.ok) {
		const detail = await patchRes.text().catch(() => "");
		throw new Error(
			`provisionAgentEmail: PATCH agent-email failed (${patchRes.status}): ${detail.slice(0, 200)}`,
		);
	}

	// 2. Insert the email channel link (UPSERT — re-runs are idempotent).
	const linkRes = await fetch(`${baseUrl}/v1/channel-links`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
		},
		body: JSON.stringify({
			startup_id: args.startup_id,
			member_id: args.member_id,
			channel_type: "email",
			channel_external_id: agentEmail,
			status: "active",
		}),
		signal: AbortSignal.timeout(8000),
	});
	if (!linkRes.ok) {
		const detail = await linkRes.text().catch(() => "");
		throw new Error(
			`provisionAgentEmail: POST channel-links failed (${linkRes.status}): ${detail.slice(0, 200)}`,
		);
	}

	return agentEmail;
}

/**
 * POST a Clerk Backend API invitation for the founder's email. Idempotent
 * at the Clerk-side: if the email already has a pending invitation the
 * Clerk API returns 422 with a clear error code, which we treat as
 * not-an-error for the admin endpoint (operator can re-run the onboarding
 * to retry the welcome email without crashing on a duplicate invite).
 *
 * Throws on transport/auth errors. Caller should wrap in waitUntil() —
 * the founder shouldn't have to wait on the Clerk roundtrip to get their
 * MCP install snippet.
 */
async function sendClerkInvite(
	args: { founder_email: string; startup_id: string },
	env: Env,
): Promise<{ ok: boolean; clerk_invitation_id: string | null }> {
	if (!env.STARTUPS_CLERK_SECRET_KEY) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_admin_clerk_invite_skipped",
				reason: "STARTUPS_CLERK_SECRET_KEY not bound — see DEFER-28.5-04-A",
				founder_email: args.founder_email,
			}),
		);
		return { ok: false, clerk_invitation_id: null };
	}

	const res = await fetch("https://api.clerk.com/v1/invitations", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.STARTUPS_CLERK_SECRET_KEY}`,
		},
		body: JSON.stringify({
			email_address: args.founder_email,
			public_metadata: { startup_id: args.startup_id, role: "admin" },
			redirect_url: "https://startups.internjobs.ai/dashboard",
		}),
		signal: AbortSignal.timeout(10000),
	});

	if (res.ok) {
		const body = (await res.json().catch(() => ({}))) as { id?: string };
		console.log(
			JSON.stringify({
				level: "info",
				event: "startup_admin_clerk_invite_sent",
				founder_email: args.founder_email,
				invitation_id: body.id ?? null,
			}),
		);
		return { ok: true, clerk_invitation_id: body.id ?? null };
	}

	// 422 with `form_identifier_exists` (or similar) means the user is
	// already invited or already exists — surface as ok=false but don't
	// throw, so the admin endpoint can still return success for the
	// startup-creation step.
	const detail = await res.text().catch(() => "");
	console.warn(
		JSON.stringify({
			level: "warn",
			event: "startup_admin_clerk_invite_failed",
			status: res.status,
			founder_email: args.founder_email,
			detail: detail.slice(0, 200),
		}),
	);
	return { ok: false, clerk_invitation_id: null };
}

/**
 * Send the welcome email from `welcome@startups.internjobs.ai` via the
 * `send_email` binding. Falls back to log-only if the binding is missing
 * OR if the send throws (CF rejects sends from un-verified domains —
 * the binding will throw until DEFER-28.5-01-D closes).
 *
 * Brand voice: lowercase subject + body, cobalt-only signature. Mirror
 * of apps/parrot/workers/lib/email.ts's "noreply@internjobs.ai" welcome
 * pattern but with the per-startup agent email surfaced as the value the
 * founder gets.
 */
async function sendWelcomeStartupEmail(
	args: { founder_email: string; company: string; agent_email: string },
	env: Env,
): Promise<{ sent: boolean; transport: "binding" | "none" }> {
	const subject = `welcome to internjobs.ai, ${args.company.toLowerCase()}`;
	const text = [
		`hey ${args.company} team,`,
		``,
		`welcome to internjobs.ai. your startup portal is live at https://startups.internjobs.ai`,
		``,
		`your agent email is ${args.agent_email} — when you reach out to candidates, they'll hear from this address. replies route straight back to your portal.`,
		``,
		`sign in to post your first role: https://startups.internjobs.ai/roles/new`,
		``,
		`— internjobs.ai`,
	].join("\n");

	const emailBinding = env.EMAIL;
	if (!emailBinding || typeof emailBinding.send !== "function") {
		console.log(
			JSON.stringify({
				level: "info",
				event: "startup_admin_welcome_email_log_only",
				reason: "EMAIL binding not bound — fallback to log",
				founder_email: args.founder_email,
				company: args.company,
				agent_email: args.agent_email,
				body_preview: text.slice(0, 120),
			}),
		);
		return { sent: false, transport: "none" };
	}

	try {
		await emailBinding.send({
			from: {
				email: "welcome@startups.internjobs.ai",
				name: "internjobs.ai",
			},
			to: [{ email: args.founder_email }],
			subject,
			text,
		} as Parameters<SendEmail["send"]>[0]);
		console.log(
			JSON.stringify({
				level: "info",
				event: "startup_admin_welcome_email_sent",
				founder_email: args.founder_email,
				agent_email: args.agent_email,
			}),
		);
		return { sent: true, transport: "binding" };
	} catch (err) {
		// CF Email Routing throws when the `from` domain isn't verified
		// (DEFER-28.5-01-D). Log the full body so Ridhi can manually
		// re-send post-verification if needed.
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_admin_welcome_email_send_failed",
				error: (err as Error)?.message ?? String(err),
				founder_email: args.founder_email,
				agent_email: args.agent_email,
				body_preview: text.slice(0, 120),
			}),
		);
		return { sent: false, transport: "binding" };
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

	// 3b. Phase 28.5: provision the per-startup agent email + Clerk invite +
	//     welcome email. The startup row + MCP token already exist at this
	//     point; if any of the 28.5 enrichment steps fail we return the core
	//     onboarding response (Ridhi can re-run /admin/startups/new on a
	//     known-failed-enrichment startup to retry agent-email provisioning).
	//
	//     Slug reservation + agent_email PATCH + channel-link INSERT are
	//     synchronous (we surface agent_email in the response body so Ridhi
	//     can hand it to the founder immediately).
	//
	//     Clerk invite + welcome email are fire-and-forget via waitUntil —
	//     they shouldn't gate the response, and either can fail soft (Clerk
	//     422 = duplicate invite; EMAIL binding throws if domain unverified).
	let agentEmail: string | null = null;
	let agentEmailError: string | null = null;
	try {
		agentEmail = await provisionAgentEmail(
			{ startup_id, member_id, company },
			c.env,
		);
	} catch (err) {
		// Non-fatal — the startup row already exists. Log and proceed.
		agentEmailError = (err as Error)?.message ?? String(err);
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_admin_agent_email_failed",
				startup_id,
				company,
				error: agentEmailError,
			}),
		);
	}

	if (agentEmail) {
		// Clerk invite — fire-and-forget. STARTUPS_CLERK_SECRET_KEY may be
		// unbound (DEFER-28.5-04-A) — sendClerkInvite handles that case
		// internally with a log line, no exception bubbles up here.
		c.executionCtx.waitUntil(
			sendClerkInvite({ founder_email, startup_id }, c.env).catch((err) => {
				console.error(
					JSON.stringify({
						level: "error",
						event: "startup_admin_clerk_invite_error",
						error: (err as Error)?.message ?? String(err),
						founder_email,
					}),
				);
			}),
		);

		// Welcome email — fire-and-forget. EMAIL binding may throw if the
		// startups.internjobs.ai domain isn't verified yet (DEFER-28.5-01-D);
		// sendWelcomeStartupEmail catches that and logs the body for manual
		// resend, so this waitUntil is purely for non-blocking dispatch.
		c.executionCtx.waitUntil(
			sendWelcomeStartupEmail(
				{ founder_email, company, agent_email: agentEmail },
				c.env,
			),
		);
	}

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
			agent_email: agentEmail,
			agent_email_provisioned: agentEmail != null,
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
		agent_email: agentEmail,
		agent_email_error: agentEmailError,
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
