// v1.2 Phase 10 Wave 1: Parrot Hono root — Clerk JWT verification.
//
// BIG architectural diff vs apps/agentic-inbox/workers/app.ts:
//   - agentic-inbox guards every request with a Cloudflare Access JWT
//     (cf-access-jwt-assertion header). One shared CF Access policy
//     fronts every mailbox.
//   - Parrot guards every request with a Clerk session JWT issued by a
//     SECOND Clerk instance (PARROT_CLERK_*). Each employee has their
//     own identity → their own EmployeeMailboxDO.
//
// Token transport:
//   - Bearer header (Authorization: Bearer <token>) for API requests
//     from the SPA, or
//   - `__session` cookie (Clerk's default) for direct navigations.
//
// Verification uses `jose.createRemoteJWKSet` against
// PARROT_CLERK_JWKS_URL. We do NOT use @clerk/backend's
// authenticateRequest here because Workers' request model differs from
// the Node http one apps/app uses, and a plain JWT verify is enough for
// Wave 1 (we re-issue handshake cookies only if we add a Clerk hosted
// sign-in page later in this wave).
//
// On unauth:
//   - API requests (/api/*) → 401 JSON
//   - All other requests → redirect to /sign-in (the Clerk-hosted
//     sign-in page or the React /sign-in route, whichever ships first).

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
	const email =
		(typeof claims.email === "string" && claims.email) ||
		(typeof c.primary_email_address === "string" &&
			(c.primary_email_address as string)) ||
		(typeof c.email_address === "string" && (c.email_address as string)) ||
		null;
	if (!employeeId || !email) return null;

	const givenName =
		typeof c.given_name === "string" ? (c.given_name as string) : undefined;
	const familyName =
		typeof c.family_name === "string" ? (c.family_name as string) : undefined;
	const displayName =
		(typeof c.name === "string" && (c.name as string)) ||
		[givenName ?? "", familyName ?? ""].filter(Boolean).join(" ") ||
		email.split("@")[0];
	const picture =
		typeof c.picture === "string"
			? (c.picture as string)
			: typeof c.image_url === "string"
				? (c.image_url as string)
				: null;

	return {
		employeeId,
		email,
		displayName,
		givenName,
		familyName,
		picture,
	};
}

const app = new Hono<ParrotContext>();

// Clerk session JWT validation middleware.
app.use("*", async (c, next) => {
	const path = new URL(c.req.url).pathname;

	// Always allow /api/health (used by uptime checks and CI).
	if (path === "/api/health") return next();

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
		return c.redirect("/sign-in", 302);
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
		return c.redirect("/sign-in", 302);
	}

	const employee = deriveEmployeeFromClaims(claims);
	if (!employee) {
		if (isApi) return c.json({ error: "missing_required_claims" }, 401);
		return c.redirect("/sign-in", 302);
	}

	// Enforce @internjobs.ai email domain — Parrot is internal-only.
	if (!employee.email.toLowerCase().endsWith("@internjobs.ai")) {
		if (isApi) {
			return c.json({ error: "forbidden_external_email" }, 403);
		}
		return c.redirect("/sign-in?reason=external_email", 302);
	}

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

export default {
	fetch: app.fetch,
	async email(
		event: { raw: ReadableStream; rawSize: number },
		_env: Env,
		_ctx: ExecutionContext,
	) {
		// Wave 1 stub: inbound mail handling is deferred until apex CF
		// Email Routing is reshaped to recognize per-employee addresses.
		// Drain the stream so the runtime doesn't complain about an
		// unconsumed body.
		try {
			const reader = event.raw.getReader();
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		} catch (e) {
			console.error(
				"Parrot inbound email drain failed:",
				(e as Error).message,
			);
		}
		console.log(
			`Parrot inbound email received (${event.rawSize} bytes) — Wave 1 stub, message discarded.`,
		);
	},
};
