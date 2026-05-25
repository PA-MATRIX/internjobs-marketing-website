// apps/startup/workers/app.ts
// v1.4 Phase 28 STARTUP-MCP-01..02 — Startup MCP Worker root.
//
// Routes:
//   /mcp        — MCP server (Streamable HTTP, per-startup Bearer auth)
//   /mcp/*      — MCP subpaths (some clients POST to /mcp/messages)
//   /admin/*    — Admin endpoint (Plan 28-04 — currently 503 stub)
//   /api/*      — Marketing CTA receiver (Plan 28-05 — currently 503 stub)
//   /.well-known/oauth-authorization-server — ChatGPT OAuth probe → 404 JSON
//   /healthz    — Liveness probe
//
// Auth model:
//   - /mcp + /mcp/*    use `Authorization: Bearer <per-startup-token>` validated
//                      via the 28-01 Fly proxy (POST /v1/startups/token with the
//                      SHA-256 hash of the raw token).
//   - /admin/*         use a separate STARTUP_MCP_ADMIN_SECRET (Plan 28-04 wires).
//
// MCP per-request server: buildMcpHandler() returns a freshly-instantiated
// McpServer for every request. Never share a McpServer across requests
// (cross-client data leak — SDK 1.26.0 security note).

import { Hono } from "hono";
import { cors } from "hono/cors";

import { buildMcpHandler } from "./server";
import { validateBearerToken } from "./lib/auth";
import { adminRouter } from "./routes/admin";
import { apiRouter } from "./routes/api";
import { handleInboundEmail } from "./routes/email";
import { handleClerkWebhook } from "./routes/webhooks";
import { telnyxRouter } from "./routes/telnyx";
import type { Env, StartupContext } from "./types";

const app = new Hono<{
	Bindings: Env;
	Variables: { startupCtx: StartupContext };
}>();

// ── CORS ──────────────────────────────────────────────────────────────────────
// MCP desktop clients aren't browsers, but Cursor's webview AND ChatGPT's MCP
// connector both send preflight, so open CORS on the MCP routes only.
app.use(
	"/mcp",
	cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }),
);
app.use(
	"/mcp/*",
	cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }),
);

// ── Bearer auth middleware for /mcp and /mcp/* ────────────────────────────────
async function bearerAuth(
	c: import("hono").Context<{
		Bindings: Env;
		Variables: { startupCtx: StartupContext };
	}>,
	next: () => Promise<void>,
) {
	const raw = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!raw) return c.json({ error: "missing_bearer_token" }, 401);
	const ctx = await validateBearerToken(raw, c.env);
	if (!ctx) return c.json({ error: "invalid_token" }, 401);
	c.set("startupCtx", ctx);
	await next();
}

app.use("/mcp", bearerAuth);
app.use("/mcp/*", bearerAuth);

// ── MCP handler — new server per request (SDK 1.26.0+ security requirement) ──
app.all("/mcp", async (c) => {
	const startupCtx = c.get("startupCtx");
	const handler = buildMcpHandler(c.env, startupCtx);
	return handler(
		c.req.raw,
		c.env,
		c.executionCtx as ExecutionContext,
	);
});

app.all("/mcp/*", async (c) => {
	const startupCtx = c.get("startupCtx");
	const handler = buildMcpHandler(c.env, startupCtx);
	return handler(
		c.req.raw,
		c.env,
		c.executionCtx as ExecutionContext,
	);
});

// ── ChatGPT OAuth probe ──────────────────────────────────────────────────────
// ChatGPT's MCP connector probes /.well-known/oauth-authorization-server before
// using Bearer auth. Returning 404 JSON (instead of 500) lets it fall back
// cleanly to the `Authorization: Bearer` header path. Do NOT return 200 here —
// that signals OAuth is supported, and ChatGPT will then expect a full RFC 8414
// metadata document.
app.get("/.well-known/oauth-authorization-server", (c) =>
	c.json({ error: "no_oauth", issuer: "https://mcp.internjobs.ai" }, 404),
);

// ── Healthz ─────────────────────────────────────────────────────────────────
app.get("/healthz", (c) =>
	c.json({ ok: true, service: "internjobs-startup-mcp" }),
);

// ── Admin router (Plan 28-04 — concierge onboarding endpoint) ────────────────
// POST /admin/startups/new — auth: Authorization: Bearer STARTUP_MCP_ADMIN_SECRET
// (separate from per-startup install tokens that gate /mcp).
app.route("/admin", adminRouter);

// ── API router (Plan 28-05 — marketing CTA receiver) ─────────────────────────
// POST /api/request-access — receives the /startups form (name, email, phone,
// what_hiring_for) and emails Ridhi / logs the lead. CORS-restricted to
// internjobs.ai. NO auth — public marketing endpoint.
app.route("/api", apiRouter);

// ── Clerk webhook (Plan 28.5-05 — work-email enforcement) ────────────────────
// POST /webhooks/clerk — receives user.created events from Clerk app #3 with
// Svix signature verification. Deletes any newly-created user whose primary
// email is on the personal-domain blocklist (gmail/yahoo/etc.) via the Clerk
// Backend API (DELETE /v1/users/:id). Work emails proceed unaffected.
// Webhook registration in Clerk Dashboard is DEFER-28.5-05-A; the Svix signing
// secret extraction + `wrangler secret put STARTUPS_CLERK_WEBHOOK_SECRET` is
// DEFER-28.5-05-B. Until both close, this endpoint returns 503.
app.post("/webhooks/clerk", (c) => handleClerkWebhook(c.req.raw, c.env));

// ── Telnyx SMS inbound webhook (Phase 29-01 STARTUP-TELNYX-01..06) ───────────
// POST /webhooks/telnyx/sms — Telnyx messaging profile (DEFER-29-01-D)
// delivers inbound message events here. Handler ordering (load-bearing):
//   1) STOP keyword check (BEFORE sig verify, per TCPA)
//   2) Ed25519 signature verify (skipped with warning if
//      TELNYX_WEBHOOK_PUBLIC_KEY unbound — DEFER-29-01-F)
//   3) Parse 'message.received' event
//   4) resolveChannelLink(env, 'telnyx-sms', from_phone) → invite if unknown
//   5) classifyIntent(body, env) → regex fast-path or LLM fallback
//   6) Dispatch to handleSearch() or handleExecute()
//   7) formatForSms(result) + sendSms() reply
// All branches write a startup_action_log row with channel='telnyx-sms'.
app.route("/", telnyxRouter);

// ── Root ─────────────────────────────────────────────────────────────────────
app.get("/", (c) =>
	c.json({
		service: "internjobs-startup-mcp",
		version: "1.0.0",
		mcp_endpoint: "https://mcp.internjobs.ai/mcp",
		docs: "https://internjobs.ai/startups",
	}),
);

// v1.4 Phase 28.5 Plan 04 STARTUP-AGENT-EMAIL-02 — add `email()` export so
// Cloudflare Email Routing (catch-all on startups.internjobs.ai) delivers
// inbound mail into the Worker. The catch-all rule is configured in the
// CF dashboard separately (see DEFER-28.5-01-E). Routing is independent
// of the Worker's `fetch` HTTP surface, so the existing /mcp + /admin +
// /api routes are unaffected.
export default {
	fetch: app.fetch,
	async email(
		message: ForwardableEmailMessage,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		return handleInboundEmail(message, env, ctx);
	},
};
