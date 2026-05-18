// v1.2 Phase 10 Wave 1: Parrot worker env bindings.
//
// Differences vs apps/agentic-inbox/workers/types.ts:
//   - Replaces Cloudflare Access env (POLICY_AUD, TEAM_DOMAIN) with
//     Clerk-instance env (PARROT_CLERK_*). Parrot auths employees via
//     a SECOND Clerk instance — separate from the student/startup
//     Clerk that powers app.internjobs.ai.

export interface Env extends Cloudflare.Env {
	/** Clerk publishable key for the Parrot (internal-employee) Clerk instance. */
	PARROT_CLERK_PUBLISHABLE_KEY: string;
	/** Clerk secret key — used by @clerk/backend's authenticateRequest. */
	PARROT_CLERK_SECRET_KEY: string;
	/** JWKS URL for the Parrot Clerk instance. */
	PARROT_CLERK_JWKS_URL: string;
	/** Optional explicit issuer; if unset we derive it from the JWKS URL. */
	PARROT_CLERK_ISSUER?: string;
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
}
