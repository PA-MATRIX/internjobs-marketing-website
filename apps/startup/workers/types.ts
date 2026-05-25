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
}

/** Identity context resolved from the per-startup Bearer token. */
export interface StartupContext {
	startup_id: string;
	member_id: string;
	startup_name: string;
}

/** What the MCP tool handlers receive in `props` after auth — startup context + env. */
export interface StartupAuthProps extends StartupContext {
	env: Env;
}
