// v1.2 Phase 10 Wave 2b (revised 2026-05-18): Parrot worker env bindings.
//
// Architecture pivot: instead of a second Clerk instance, Parrot now reuses
// the existing student production Clerk app at clerk.internjobs.ai and
// gates access by membership in the "InternJobs Team" organization
// (PARROT_INTERNJOBS_TEAM_ORG_ID). Cookies set on .internjobs.ai during
// student sign-in propagate naturally to workspace.internjobs.ai —
// students never become employees because they're not org members.
//
// Env semantics:
//   - PARROT_CLERK_* point at the STUDENT production Clerk app (sk_live_…,
//     pk_live_…, JWKS at clerk.internjobs.ai). Same Clerk app powers
//     app.internjobs.ai for students.
//   - PARROT_INTERNJOBS_TEAM_ORG_ID — the org_id every Parrot session JWT
//     must carry in its `o.id` claim. Configured via Clerk Dashboard or
//     organizationSyncOptions to auto-activate on workspace.internjobs.ai.
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

	/** org_id of the "InternJobs Team" organization. Every Parrot request
	 *  must carry this in its session JWT's `o.id` claim. */
	PARROT_INTERNJOBS_TEAM_ORG_ID: string;
	/** Slug of the "InternJobs Team" org. Used by Clerk's
	 *  organizationSyncOptions to auto-activate the org on this subdomain. */
	PARROT_INTERNJOBS_TEAM_ORG_SLUG?: string;

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
	/** Clerk publicMetadata (when present on the JWT). Kept for legacy
	 *  callers; org membership is the primary gate now. */
	publicMetadata?: Record<string, unknown> | null;
	/** Active org_id from the session JWT's `o.id` claim. Set when Clerk's
	 *  organizationSyncOptions auto-activates the InternJobs Team org. */
	orgId?: string | null;
	/** Active org role (e.g. "org:admin", "org:member"). */
	orgRole?: string | null;
	/** Active org slug. */
	orgSlug?: string | null;
}
