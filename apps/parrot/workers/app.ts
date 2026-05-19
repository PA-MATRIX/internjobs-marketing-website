// v1.2 Phase 10 Wave 2b (revised 2026-05-19): Parrot Hono root — Clerk
// session JWT verification.
//
// Auth model: Parrot uses a DEDICATED production Clerk app
// (clerk.workspace.internjobs.ai) with phone-OTP as the sole sign-in
// strategy. The student app (clerk.app.internjobs.ai) is a separate
// Clerk instance with LinkedIn-only auth — there's NO shared user pool
// and NO Organization-based gating. Any signed-in Clerk session
// against the employee instance is, by definition, an employee.
//
// Token transport:
//   - Bearer header (Authorization: Bearer <token>) for API requests
//     from the SPA, or
//   - `__session` cookie (Clerk's default) for direct navigations.
//     Clerk is configured at clerk.workspace.internjobs.ai → cookie
//     scoped to .workspace.internjobs.ai → reaches the worker directly.
//
// Verification uses `jose.createRemoteJWKSet` against
// PARROT_CLERK_JWKS_URL (the employee Clerk app's JWKS).
//
// On unauth:
//   - API requests (/api/*) → 401 JSON
//   - All other requests → redirect to /sign-in (the embedded Clerk
//     SignIn form in apps/parrot/app/routes/login.tsx).

import { Hono } from "hono";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { createRequestHandler } from "react-router";
import { app as apiApp } from "./index";
import type { Employee, Env } from "./types";
import type { ParrotContext } from "./lib/mailbox";

export { EmployeeMailboxDO } from "./durableObject";
export { WorkspaceDO } from "./durableObject/workspace";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// Cache the JWKS resolver between requests — `createRemoteJWKSet` returns
// a function that internally caches the fetched key set with sane TTLs.
let cachedJwksFn: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUrl: string | null = null;
function getJWKS(jwksUrl: string) {
	if (cachedJwksFn && cachedJwksUrl === jwksUrl) return cachedJwksFn;
	cachedJwksFn = createRemoteJWKSet(new URL(jwksUrl));
	cachedJwksUrl = jwksUrl;
	return cachedJwksFn;
}

function deriveIssuer(env: Env): string | undefined {
	if (env.PARROT_CLERK_ISSUER) return env.PARROT_CLERK_ISSUER;
	if (env.PARROT_CLERK_JWKS_URL) {
		try {
			const url = new URL(env.PARROT_CLERK_JWKS_URL);
			return url.origin;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function extractToken(req: Request): string | null {
	const auth = req.headers.get("authorization");
	if (auth && auth.toLowerCase().startsWith("bearer ")) {
		return auth.slice(7).trim();
	}
	const cookieHeader = req.headers.get("cookie") || "";
	for (const part of cookieHeader.split(";")) {
		const [rawName, ...rest] = part.split("=");
		const name = rawName?.trim();
		if (name === "__session") {
			return decodeURIComponent(rest.join("=").trim());
		}
	}
	return null;
}

function deriveEmployeeFromClaims(claims: JWTPayload): Employee | null {
	const c = claims as Record<string, unknown>;
	const employeeId = typeof claims.sub === "string" ? claims.sub : null;
	// Only employeeId is strictly required. Clerk's default session JWT
	// template doesn't include phone_number/email unless explicitly added —
	// so phone-OTP users have valid sessions with no identifier claims.
	// We accept that: anything signed-in to the employee Clerk app IS
	// an employee. The Clerk user ID (sub) keys the EmployeeMailboxDO.
	if (!employeeId) return null;
	const email =
		(typeof claims.email === "string" && claims.email) ||
		(typeof c.primary_email_address === "string" &&
			(c.primary_email_address as string)) ||
		(typeof c.email_address === "string" && (c.email_address as string)) ||
		"";
	const phoneNumber =
		(typeof c.phone_number === "string" && (c.phone_number as string)) ||
		(typeof c.primary_phone_number === "string" &&
			(c.primary_phone_number as string)) ||
		"";

	const givenName =
		typeof c.given_name === "string" ? (c.given_name as string) : undefined;
	const familyName =
		typeof c.family_name === "string" ? (c.family_name as string) : undefined;
	const displayName =
		(typeof c.name === "string" && (c.name as string)) ||
		[givenName ?? "", familyName ?? ""].filter(Boolean).join(" ") ||
		(email ? email.split("@")[0] : phoneNumber);
	const picture =
		typeof c.picture === "string"
			? (c.picture as string)
			: typeof c.image_url === "string"
				? (c.image_url as string)
				: null;
	const publicMetadata =
		c.public_metadata && typeof c.public_metadata === "object"
			? (c.public_metadata as Record<string, unknown>)
			: c.publicMetadata && typeof c.publicMetadata === "object"
				? (c.publicMetadata as Record<string, unknown>)
				: null;

	return {
		employeeId,
		email: email || phoneNumber || employeeId, // never empty — callers key on this
		displayName,
		givenName,
		familyName,
		picture,
		publicMetadata,
	};
}

/** Send unauth users to Parrot's own embedded sign-in form (a
 *  <SignIn> from @clerk/react-router restricted to email OTP).
 *  app/routes/login.tsx renders the form; we pass `redirect_url` as
 *  ?after_sign_in_url so Clerk routes back to the original path. */
function buildSignInRedirect(path: string): string {
	if (path === "/sign-in" || path.startsWith("/sign-in/")) return "/sign-in";
	const after = path === "/" ? "/" : path;
	return `/sign-in?redirect_url=${encodeURIComponent(after)}`;
}

const app = new Hono<ParrotContext>();

// Clerk session JWT validation middleware.
app.use("*", async (c, next) => {
	const path = new URL(c.req.url).pathname;

	// Always allow /api/health (used by uptime checks and CI).
	if (path === "/api/health") return next();

	// 2026-05-19: allow /api/dev/* through ONLY when PARROT_DEV_MODE is
	// set as a Worker env. Each dev route still has its own PARROT_DEV_MODE
	// gate (defense in depth), so a stale Worker var here doesn't leak
	// production data. The Clerk middleware skip is necessary because dev
	// endpoints can't always carry an employee JWT (e.g., one-off operator
	// provisioning via `curl`).
	if (path.startsWith("/api/dev/") && c.env.PARROT_DEV_MODE) return next();

	// Always allow the sign-in route — Clerk's Account Portal redirects
	// land here when an unauth user hits a protected page.
	if (
		path === "/sign-in" ||
		path.startsWith("/sign-in/") ||
		path.startsWith("/sign-up") ||
		path.startsWith("/_clerk")
	) {
		return next();
	}

	// Wave 2b OIDC bridge — these endpoints are part of the OAuth 2.0
	// spec and Mattermost calls them WITHOUT a Clerk session. The
	// /oidc/authorize route handles its own redirect-to-Clerk if the
	// user isn't signed in; /oidc/token + /oidc/userinfo enforce their
	// own auth (client_secret + Bearer access_token respectively).
	//
	// `/oidc/authorize` is also let through, but its handler will check
	// for a Clerk session itself (and if absent, build a sign-in URL
	// that preserves the OAuth params via `redirect_url`).
	if (
		path === "/oidc/.well-known/openid-configuration" ||
		path === "/oidc/jwks" ||
		path === "/oidc/authorize" ||
		path === "/oidc/token" ||
		path === "/oidc/userinfo"
	) {
		return next();
	}

	const isApi = path.startsWith("/api/");

	// Dev short-circuit (read X-Parrot-Dev-Employee/Email/Name headers).
	// This is the only path that doesn't require Clerk; it exists so
	// `npm run dev` + smoke tests work without a real Clerk JWT. Production
	// builds set import.meta.env.DEV to false so this branch is dead code.
	if (import.meta.env.DEV) {
		const devEmployeeId = c.req.header("x-parrot-dev-employee");
		if (devEmployeeId) {
			c.set("employee", {
				employeeId: devEmployeeId,
				email:
					c.req.header("x-parrot-dev-email") || `${devEmployeeId}@internjobs.ai`,
				displayName: c.req.header("x-parrot-dev-name") || devEmployeeId,
			});
			return next();
		}
	}

	const { PARROT_CLERK_JWKS_URL } = c.env;

	// Fail closed if the Clerk config isn't populated.
	if (!PARROT_CLERK_JWKS_URL) {
		if (isApi) {
			return c.json({ error: "parrot_clerk_jwks_url_missing" }, 503);
		}
		return c.text(
			"Parrot Clerk instance is not configured. Set PARROT_CLERK_JWKS_URL.",
			503,
		);
	}

	const token = extractToken(c.req.raw);
	if (!token) {
		if (isApi) return c.json({ error: "unauthenticated" }, 401);
		return c.redirect(buildSignInRedirect(path), 302);
	}

	let claims: JWTPayload;
	try {
		const JWKS = getJWKS(PARROT_CLERK_JWKS_URL);
		const issuer = deriveIssuer(c.env);
		const verified = await jwtVerify(token, JWKS, {
			...(issuer ? { issuer } : {}),
		});
		claims = verified.payload;
	} catch {
		if (isApi) {
			return c.json({ error: "invalid_or_expired_token" }, 401);
		}
		return c.redirect(buildSignInRedirect(path), 302);
	}

	const employee = deriveEmployeeFromClaims(claims);
	if (!employee) {
		if (isApi) return c.json({ error: "missing_required_claims" }, 401);
		return c.redirect(buildSignInRedirect(path), 302);
	}

	// No org-membership gate. The employee Clerk app
	// (clerk.workspace.internjobs.ai) is a dedicated instance with its
	// own user pool — anyone who has a valid session JWT IS an employee
	// by construction. Org-based separation was leftover from the
	// abandoned "shared Clerk app" architecture (see
	// memory/project-auth-architecture.md, 2026-05-18 decision).

	c.set("employee", employee);
	return next();
});

// Mount the API routes (all read c.var.employee).
app.route("/", apiApp);

// React Router catch-all: SPA for everything else.
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: {
			env: c.env,
			ctx: c.executionCtx as ExecutionContext,
		},
	});
});

import { receiveEmail } from "./lib/inbound-email";
import { runAutoClear } from "./lib/auto-clear";

export default {
	fetch: app.fetch,
	async email(
		event: { raw: ReadableStream; rawSize: number },
		env: Env,
		ctx: ExecutionContext,
	) {
		// v1.2 Phase 12-fix 2026-05-19: real inbound handler replaces the
		// Wave-1 stub. Parses the MIME, resolves the recipient to an
		// employee via WorkspaceDO, writes into EmployeeMailboxDO Inbox
		// folder — which triggers the Phase 12 fire-and-forget
		// extractTodosFromEmail() hook.
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error(
				"Parrot inbound email failed:",
				(e as Error).message,
				(e as Error).stack,
			);
			// Re-throw so Cloudflare Email Routing retries or bounces.
			// Swallowing here would silently drop mail.
			throw e;
		}
	},
	// v1.3 Phase 19 Plan 01 (PARROT-AUTO-CLEAR): Cron handler.
	//
	// Fires every 5 minutes per `triggers.crons` in wrangler.jsonc. Walks
	// the graph proxy for :Todo nodes past the 5-minute grace window and
	// calls resolveTodo() on each owning EmployeeMailboxDO to close the
	// SQLite row. runAutoClear is fail-soft — never throws — so the
	// scheduled handler does not need a try/catch.
	//
	// ctx.waitUntil() ensures CF doesn't terminate the Worker before
	// reconciliation completes (the cron tick has a soft limit but we
	// rarely process more than a handful of items per run).
	async scheduled(
		_event: ScheduledEvent,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(runAutoClear(env));
	},
};
