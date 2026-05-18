// v1.2 Phase 10 Wave 1 + Wave 2b: Parrot worker env bindings.
//
// Wave 1 baseline: Clerk session JWT verification (PARROT_CLERK_*),
// MATTERMOST_URL var.
//
// Wave 2b additions (employee onboarding + OIDC SSO bridge):
//   - PARROT_CLERK_SECRET_KEY now also used to call the Clerk Backend API
//     (POST /v1/users) when an operator invites a new employee.
//   - CLOUDFLARE_* secrets let the Worker provision Email Routing rules
//     and send the welcome email via the Email Service REST API.
//   - OIDC_SIGNING_KEY (PEM-encoded RS256 private key) + OIDC_PUBLIC_JWK
//     (JSON-encoded RS256 public key as JWK) power the OIDC bridge that
//     Mattermost talks to.
//   - MATTERMOST_OIDC_CLIENT_ID / _SECRET pair authenticates the
//     Mattermost server when it POSTs to /oidc/token.
//   - PARROT_OPERATOR_EMAILS — comma-separated list of @internjobs.ai
//     addresses that are allowed to invite employees. First-run
//     bootstrap: the operator is whoever signs in first with a
//     publicMetadata.role === "operator" Clerk claim, OR an email in
//     this allowlist.
//   - WORKSPACE — DO namespace for the singleton WorkspaceDO that holds
//     the employee directory + OIDC code/token tables.

import type { EmployeeMailboxDO } from "./durableObject";
import type { WorkspaceDO } from "./durableObject/workspace";

export interface Env extends Cloudflare.Env {
	/** Clerk publishable key for the Parrot (internal-employee) Clerk instance. */
	PARROT_CLERK_PUBLISHABLE_KEY: string;
	/** Clerk secret key — used by @clerk/backend's authenticateRequest AND
	 *  by /api/admin/employees to create new Clerk users. */
	PARROT_CLERK_SECRET_KEY: string;
	/** JWKS URL for the Parrot Clerk instance. */
	PARROT_CLERK_JWKS_URL: string;
	/** Optional explicit issuer; if unset we derive it from the JWKS URL. */
	PARROT_CLERK_ISSUER?: string;

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
	/** Comma-separated allowlist of operator emails. */
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
}
