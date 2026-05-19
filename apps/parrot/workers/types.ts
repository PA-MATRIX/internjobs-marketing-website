// v1.2 Phase 10 Wave 2b (revised 2026-05-19): Parrot worker env bindings.
//
// Architecture: Parrot uses a DEDICATED production Clerk app (the
// "InternJobs Employees" instance at clerk.workspace.internjobs.ai),
// separate from the student app at clerk.app.internjobs.ai. Auth is
// phone-OTP only. Because the Clerk instances are fully separate user
// pools, no Organization-membership gate is needed — any signed-in
// user IS an employee by construction. See
// memory/project-auth-architecture.md.
//
// Env semantics:
//   - PARROT_CLERK_* point at the EMPLOYEE Clerk app (sk_live_…,
//     pk_live_…, JWKS at clerk.workspace.internjobs.ai).
//   - CLOUDFLARE_* secrets let the Worker provision Email Routing rules
//     and send the welcome email via the Email Service REST API.
//   - OIDC_SIGNING_KEY (PEM-encoded RS256 private key) + OIDC_PUBLIC_JWK
//     (JSON-encoded RS256 public key as JWK) power the OIDC bridge that
//     Mattermost talks to.
//   - MATTERMOST_OIDC_CLIENT_ID / _SECRET pair authenticates the
//     Mattermost server when it POSTs to /oidc/token.
//   - WORKSPACE — DO namespace for the singleton WorkspaceDO that holds
//     the employee directory + OIDC code/token tables.

import type { EmployeeMailboxDO } from "./durableObject";
import type { WorkspaceDO } from "./durableObject/workspace";

/**
 * Worker-specific env. We `Omit` the binding/var slots we re-declare
 * so the literal types `wrangler types` emits (e.g.
 * `MATTERMOST_URL: "https://internjobs-mattermost.fly.dev"`) don't
 * collide with our wider string types.
 */
type CfEnvBase = Omit<
	Cloudflare.Env,
	| "MATTERMOST_URL"
	| "EMPLOYEE_MAILBOX"
	| "WORKSPACE"
	| "EMAIL"
	| "BUCKET"
	| "CLOUDFLARE_AI_API_TOKEN"
	| "CLOUDFLARE_ACCOUNT_ID"
	| "PARROT_AI_GATEWAY_ID"
	| "KIMI_MODEL"
	| "MATTERMOST_BOT_TOKEN"
	| "PARROT_DEV_MODE"
	| "PUSH_VAPID_PRIVATE_KEY"
	| "PUSH_VAPID_PUBLIC_KEY"
	| "PARROT_FEATURE_FLAGS"
	| "SENTRY_DSN"
>;

export interface Env extends CfEnvBase {
	/** Clerk publishable key for the student production Clerk instance
	 *  (clerk.internjobs.ai). Parrot reuses this app, gated by org membership. */
	PARROT_CLERK_PUBLISHABLE_KEY: string;
	/** Clerk secret key — used to verify JWTs AND to call Clerk Backend API
	 *  (org invitations, user lookups). */
	PARROT_CLERK_SECRET_KEY: string;
	/** JWKS URL for the student production Clerk instance. */
	PARROT_CLERK_JWKS_URL: string;
	/** Optional explicit issuer; if unset we derive it from the JWKS URL. */
	PARROT_CLERK_ISSUER?: string;

	// (Removed 2026-05-19) PARROT_INTERNJOBS_TEAM_ORG_ID /
	// PARROT_INTERNJOBS_TEAM_ORG_SLUG — the workspace and student
	// apps are now separate Clerk instances, so we don't gate by
	// org membership any more. Any signed-in user IS an employee.

	/** Public URL of the self-hosted Mattermost Team Edition instance. */
	MATTERMOST_URL: string;
	/** Fly app name for Mattermost (informational; not used at runtime). */
	MATTERMOST_FLY_APP?: string;

	// — Wave 2b: provisioning
	/** API token authorized to POST /zones/$ZONE/email/routing/rules. */
	CLOUDFLARE_EMAIL_ROUTING_API_TOKEN?: string;
	/** API token authorized to POST /accounts/$ACCT/email/routing/email. */
	CLOUDFLARE_EMAIL_API_TOKEN?: string;
	/** Cloudflare account ID (for the Email Service REST endpoint). */
	CLOUDFLARE_EMAIL_ACCOUNT_ID?: string;
	/** Cloudflare zone ID for internjobs.ai. */
	CLOUDFLARE_INTERNJOBS_ZONE_ID?: string;
	/** Deprecated bootstrap allowlist. Org membership is the real gate;
	 *  this only matters if someone needs emergency operator access while
	 *  the org config is broken. Remove once org gate is proven. */
	PARROT_OPERATOR_EMAILS?: string;

	// — Wave 2b: OIDC bridge
	/** PEM-encoded RS256 private key used to sign OIDC id_tokens. */
	OIDC_SIGNING_KEY?: string;
	/** JSON-encoded JWK (public key, RS256). Served at /oidc/jwks. */
	OIDC_PUBLIC_JWK?: string;
	/** Client ID Mattermost will present on /oidc/authorize + /oidc/token. */
	MATTERMOST_OIDC_CLIENT_ID?: string;
	/** Client secret Mattermost will present on /oidc/token. */
	MATTERMOST_OIDC_CLIENT_SECRET?: string;
	/** Expected Mattermost redirect URI (e.g. https://internjobs-mattermost.fly.dev/signup/gitlab/complete). */
	MATTERMOST_OIDC_REDIRECT_URI?: string;

	// — Phase 12 Wave 1: Dashboard Mothership Agent (Workers AI via AI Gateway)
	/** Workers AI API token (scoped to Workers AI). Set via `wrangler secret put`. */
	CLOUDFLARE_AI_API_TOKEN: string;
	/** Cloudflare account ID for AI Gateway routing. */
	CLOUDFLARE_ACCOUNT_ID: string;
	/** Cloudflare AI Gateway ID for the internjobs-parrot gateway. Set via `wrangler secret put`. */
	PARROT_AI_GATEWAY_ID: string;
	/** Workers AI model ID for todo extraction. Default: @cf/moonshotai/kimi-k2.6 */
	KIMI_MODEL: string;
	/** Mattermost bot personal access token for REST API polling. */
	MATTERMOST_BOT_TOKEN?: string;
	/** Set to "1" in wrangler dev to enable dev-only smoke endpoints. Never set in production. */
	PARROT_DEV_MODE?: string;

	// — Phase 13 Wave 1: Web Push VAPID keys.
	/** ECDSA P-256 private key PEM for VAPID signing. Set via `wrangler secret put PUSH_VAPID_PRIVATE_KEY`.
	 *  Optional at the type level so the Worker boots without it; sendPushToSubscriptions
	 *  no-ops with a warning when missing. */
	PUSH_VAPID_PRIVATE_KEY?: string;
	/** ECDSA P-256 public key (base64url) for VAPID. Baked into wrangler.jsonc vars
	 *  (safe to commit). Forwarded to the client so PushManager.subscribe() can
	 *  use it as `applicationServerKey`. */
	PUSH_VAPID_PUBLIC_KEY?: string;

	// — Phase 13 Wave 3: feature flags + error tracking.
	/** KV namespace for per-employee + global feature flag overrides.
	 *  Binding declared in wrangler.jsonc. Optional so the Worker boots without
	 *  the binding (getFeatureFlags() falls back to default-all-on). */
	PARROT_FEATURE_FLAGS?: KVNamespace;
	/** Sentry DSN for error tracking in the Parrot Worker. Set via
	 *  `wrangler secret put SENTRY_DSN`. Optional — reportToSentry() no-ops
	 *  when the env var is absent. */
	SENTRY_DSN?: string;

	// — Bindings (typed via the DO classes themselves so callers get
	//   intellisense for the RPC surface).
	EMPLOYEE_MAILBOX: DurableObjectNamespace<EmployeeMailboxDO>;
	WORKSPACE: DurableObjectNamespace<WorkspaceDO>;
	EMAIL: SendEmail;
	BUCKET: R2Bucket;
}

/**
 * Normalized employee identity attached to a Hono context after Clerk
 * auth succeeds. Mailbox routes read this off `c.var.employee`.
 */
export interface Employee {
	/** Stable Clerk user ID — keys the EmployeeMailboxDO instance. */
	employeeId: string;
	/** Internal email address (name@internjobs.ai). */
	email: string;
	/** Display name from the Clerk profile (best-effort). */
	displayName: string;
	/** Optional avatar URL from Clerk. */
	picture?: string | null;
	/** First name (best-effort split from displayName/Clerk claims). */
	givenName?: string;
	/** Last name (best-effort split from displayName/Clerk claims). */
	familyName?: string;
	/** Clerk publicMetadata (when present on the JWT). Drives the
	 *  operator gate via isOperator() — roles like "operator", "admin",
	 *  "ceo" gain access to /admin/*. */
	publicMetadata?: Record<string, unknown> | null;
}
