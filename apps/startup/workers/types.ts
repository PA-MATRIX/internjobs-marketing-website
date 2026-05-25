// apps/startup/workers/types.ts
// v1.4 Phase 28 — Startup MCP Worker environment bindings.
//
// Env bindings are read from wrangler.jsonc `vars` (non-secret) and `wrangler secret put`
// (secret). STARTUP_API_URL is hardcoded in vars; the two secrets must be provisioned
// before deploy (see wrangler.jsonc inline comments for source paths).

export interface Env {
	// URL of the internjobs-startup-api Fly proxy (non-secret, set in wrangler.jsonc vars)
	STARTUP_API_URL: string;
	// Bearer token for the startup-api proxy (set via wrangler secret put)
	STARTUP_API_SECRET: string;
	// Admin endpoint protection (Ridhi-only; set via wrangler secret put). Used by Plan 28-04.
	STARTUP_MCP_ADMIN_SECRET: string;
	// v1.4 Phase 28.5 — Startups Clerk app #3 secrets (set via wrangler secret put;
	// values mirrored to Infisical /internjobs-ai env=prod). Both are OPTIONAL at
	// type level — the Worker runtime guards against absence so code paths that
	// don't require them keep functioning while DEFER-28.5-01-A / 28.5-04-A close.
	STARTUPS_CLERK_SECRET_KEY?: string;
	STARTUPS_CLERK_WEBHOOK_SECRET?: string;
	STARTUPS_CLERK_ISSUER?: string;
	STARTUPS_CLERK_JWKS_URL?: string;
	// v1.4 Phase 28.5 Plan 04 — outbound email (welcome email + reply send)
	// + inbound catch-all routing target. Optional at type level: when
	// undefined, routes/admin.ts logs the welcome email and continues (the
	// 28-04 marketing-CTA path already has the same fallback semantics).
	EMAIL?: SendEmail;

	// v1.4 Phase 29 — Telnyx SMS + Voice AI bindings (all OPTIONAL at type
	// level; runtime guards in routes/telnyx.ts and lib/telnyx.ts log + no-op
	// when absent so the Worker never 500s before Telnyx ops close.
	// See PHASE-29-DEFERRED-OPS.md for the secret-binding backlog.)
	TELNYX_API_KEY?: string;                // Bearer for POST /v2/messages
	TELNYX_FROM_NUMBER?: string;            // E.164 sender (toll-free)
	TELNYX_MESSAGING_PROFILE_ID?: string;   // Telnyx messaging profile UUID
	TELNYX_WEBHOOK_PUBLIC_KEY?: string;     // Ed25519 public key (base64) for SMS webhook sig verify
	TELNYX_VOICE_AGENT_TOKEN?: string;      // Bearer for Voice AI agent's MCP calls (Phase 29-02)
	TELNYX_USE_MCP_INTEGRATION?: string;    // 'true' | 'false'; gates MCP vs webhook-tool path
	// R2 bucket binding for voice call audit log (Phase 29-02 enables).
	VOICE_AUDIT?: R2Bucket;
	// KV namespace for touchbase cursors (Phase 29-03 enables).
	TOUCHBASE_CURSORS?: KVNamespace;
	// Workers AI binding — declared in wrangler.jsonc (`"ai": { "binding": "AI" }`)
	// and used by lib/embed.ts (Phase 28) and lib/intent.ts (Phase 29-01).
	AI?: {
		run: (
			model: string,
			input: Record<string, unknown>,
		) => Promise<unknown>;
	};
}

/** Identity context resolved from the per-startup Bearer token. */
export interface StartupContext {
	startup_id: string;
	member_id: string;
	startup_name: string;
	// v1.4 Phase 29-03 — populated by resolveChannelLink() when identity comes
	// from a startup_channel_links row (telnyx-sms / telnyx-voice / email / ...).
	// Used by the "yes" opt-in fast-path in routes/telnyx.ts to PATCH the link's
	// opt_in_flags. Not populated by /mcp Bearer auth (where startup_id comes
	// from mcp_token_hash), hence optional.
	channel_link_id?: string;
}

/** What the MCP tool handlers receive in `props` after auth — startup context + env. */
export interface StartupAuthProps extends StartupContext {
	env: Env;
}
