// v1.2 Phase 10 Wave 2b: OIDC bridge for Mattermost SSO.
//
// Mattermost Team Edition speaks OAuth 2.0 via its "GitLab OAuth"
// integration (which is OAuth 2.0 + a minimal userinfo endpoint, not
// actually GitLab-specific). We expose a tiny OIDC provider here that
// federates Clerk's identity to Mattermost.
//
// Endpoints implemented (paths are relative to the /oidc mount):
//   /.well-known/openid-configuration — discovery doc
//   /jwks                              — RS256 public key set
//   /authorize                         — start the auth code flow
//   /token                             — exchange code for tokens
//   /userinfo                          — Bearer-authed claim lookup
//
// Trust model:
//   - The Worker's Clerk middleware (workers/app.ts) lets every /oidc/*
//     path through without authentication. Each route enforces its own
//     auth:
//       * /authorize: looks for a Clerk __session cookie; if absent,
//         redirects to /sign-in with redirect_url back to /authorize.
//       * /token: validates client_id + client_secret against the
//         Mattermost-registered pair (env.MATTERMOST_OIDC_CLIENT_*).
//       * /userinfo: validates Authorization: Bearer <access_token>
//         against opaque tokens stored in WorkspaceDO.
//   - id_tokens are signed RS256 with OIDC_SIGNING_KEY (PEM private).
//     The matching public JWK lives in OIDC_PUBLIC_JWK (JSON string).
//
// Cleanup: WorkspaceDO.sweepExpired() is called opportunistically on
// /token to keep the codes/tokens tables from growing unboundedly.

import { Hono } from "hono";
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from "jose";
import type { JWTPayload } from "jose";
import type { ParrotContext } from "../lib/mailbox";
import type { Env } from "../types";
import { getWorkspaceStub } from "../durableObject/workspace";

const oidc = new Hono<ParrotContext>();

const AUTH_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const ID_TOKEN_TTL_SECONDS = 60 * 60;

// — Discovery & JWKS ———————————————————————————————————————

function baseUrl(req: Request): string {
	const u = new URL(req.url);
	return `${u.protocol}//${u.host}`;
}

oidc.get("/.well-known/openid-configuration", (c) => {
	const issuer = baseUrl(c.req.raw);
	return c.json({
		issuer,
		authorization_endpoint: `${issuer}/oidc/authorize`,
		token_endpoint: `${issuer}/oidc/token`,
		userinfo_endpoint: `${issuer}/oidc/userinfo`,
		jwks_uri: `${issuer}/oidc/jwks`,
		response_types_supported: ["code"],
		subject_types_supported: ["public"],
		id_token_signing_alg_values_supported: ["RS256"],
		scopes_supported: ["openid", "profile", "email"],
		grant_types_supported: ["authorization_code"],
		token_endpoint_auth_methods_supported: [
			"client_secret_basic",
			"client_secret_post",
		],
		claims_supported: [
			"sub",
			"email",
			"email_verified",
			"name",
			"given_name",
			"family_name",
			"picture",
			"iss",
			"aud",
			"exp",
			"iat",
		],
	});
});

oidc.get("/jwks", (c) => {
	const jwkJson = c.env.OIDC_PUBLIC_JWK;
	if (!jwkJson) {
		return c.json({ keys: [] });
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(jwkJson);
	} catch {
		return c.json({ keys: [] });
	}
	// We accept either a single JWK or a full JWKS shape.
	if (parsed && typeof parsed === "object") {
		if ("keys" in (parsed as Record<string, unknown>)) {
			return c.json(parsed);
		}
		return c.json({ keys: [parsed] });
	}
	return c.json({ keys: [] });
});

// — Authorize ———————————————————————————————————————————————

function extractClerkSessionToken(req: Request): string | null {
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

let cachedClerkJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedClerkJwksUrl: string | null = null;
function getClerkJwks(jwksUrl: string) {
	if (cachedClerkJwks && cachedClerkJwksUrl === jwksUrl) return cachedClerkJwks;
	cachedClerkJwks = createRemoteJWKSet(new URL(jwksUrl));
	cachedClerkJwksUrl = jwksUrl;
	return cachedClerkJwks;
}

interface ClerkIdentity {
	sub: string;
	email: string;
	name: string;
	givenName: string | null;
	familyName: string | null;
	picture: string | null;
}

async function verifyClerkSession(
	req: Request,
	env: Env,
): Promise<ClerkIdentity | null> {
	const token = extractClerkSessionToken(req);
	if (!token || !env.PARROT_CLERK_JWKS_URL) return null;
	let payload: JWTPayload;
	try {
		const issuer = env.PARROT_CLERK_ISSUER
			? env.PARROT_CLERK_ISSUER
			: new URL(env.PARROT_CLERK_JWKS_URL).origin;
		const verified = await jwtVerify(
			token,
			getClerkJwks(env.PARROT_CLERK_JWKS_URL),
			{ issuer },
		);
		payload = verified.payload;
	} catch {
		return null;
	}
	const c = payload as Record<string, unknown>;
	const sub = typeof payload.sub === "string" ? payload.sub : null;
	const email =
		(typeof c.email === "string" && (c.email as string)) ||
		(typeof c.primary_email_address === "string" &&
			(c.primary_email_address as string)) ||
		(typeof c.email_address === "string" && (c.email_address as string)) ||
		null;
	if (!sub || !email) return null;
	const givenName = typeof c.given_name === "string" ? (c.given_name as string) : null;
	const familyName = typeof c.family_name === "string" ? (c.family_name as string) : null;
	const name =
		(typeof c.name === "string" && (c.name as string)) ||
		[givenName ?? "", familyName ?? ""].filter(Boolean).join(" ").trim() ||
		email.split("@")[0];
	const picture = typeof c.picture === "string" ? (c.picture as string) : null;
	return { sub, email, name, givenName, familyName, picture };
}

oidc.get("/authorize", async (c) => {
	const url = new URL(c.req.url);
	const clientId = url.searchParams.get("client_id") || "";
	const redirectUri = url.searchParams.get("redirect_uri") || "";
	const responseType = url.searchParams.get("response_type") || "";
	const scope = url.searchParams.get("scope") || "openid";
	const state = url.searchParams.get("state") || "";

	// Validate the request shape first — we don't want to start an
	// auth flow for a misconfigured client.
	if (responseType !== "code") {
		return c.text(
			`unsupported_response_type: '${responseType}' (only 'code' is supported)`,
			400,
		);
	}
	const expectedClientId = c.env.MATTERMOST_OIDC_CLIENT_ID;
	const expectedRedirect = c.env.MATTERMOST_OIDC_REDIRECT_URI;
	if (!expectedClientId || !expectedRedirect) {
		return c.text("oidc_not_configured: Mattermost client credentials missing.", 503);
	}
	if (clientId !== expectedClientId) {
		return c.text(`unauthorized_client: '${clientId}' is not registered.`, 400);
	}
	// Mattermost sometimes appends a trailing slash or normalises the
	// query string; do an exact match but trim trailing slashes.
	if (redirectUri.replace(/\/$/, "") !== expectedRedirect.replace(/\/$/, "")) {
		return c.text(
			`invalid_redirect_uri: '${redirectUri}' does not match registered URI.`,
			400,
		);
	}

	// Check Clerk session.
	const identity = await verifyClerkSession(c.req.raw, c.env);
	if (!identity) {
		// Redirect to Clerk-hosted sign-in with a redirect_url that
		// brings the user back to /oidc/authorize with the original
		// query string intact.
		const returnTo = `/oidc/authorize${url.search}`;
		const signInUrl = `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
		return c.redirect(signInUrl, 302);
	}

	// Mint a short-lived auth code.
	const workspace = getWorkspaceStub(c.env);
	const code = await workspace.createAuthCode({
		clerkUserId: identity.sub,
		email: identity.email,
		name: identity.name,
		picture: identity.picture,
		clientId,
		redirectUri,
		scope,
		ttlSeconds: AUTH_CODE_TTL_SECONDS,
	});

	const redirect = new URL(redirectUri);
	redirect.searchParams.set("code", code);
	if (state) redirect.searchParams.set("state", state);
	return c.redirect(redirect.toString(), 302);
});

// — Token ———————————————————————————————————————————————————

function parseClientCredentials(
	req: Request,
	bodyClientId: string | null,
	bodyClientSecret: string | null,
): { clientId: string | null; clientSecret: string | null } {
	// Try Basic auth first (RFC 6749 §2.3.1 preferred).
	const auth = req.headers.get("authorization");
	if (auth && auth.toLowerCase().startsWith("basic ")) {
		try {
			const decoded = atob(auth.slice(6).trim());
			const colonIdx = decoded.indexOf(":");
			if (colonIdx > 0) {
				return {
					clientId: decodeURIComponent(decoded.slice(0, colonIdx)),
					clientSecret: decodeURIComponent(decoded.slice(colonIdx + 1)),
				};
			}
		} catch {
			/* malformed — fall through */
		}
	}
	return { clientId: bodyClientId, clientSecret: bodyClientSecret };
}

async function readTokenRequestBody(
	req: Request,
): Promise<Record<string, string>> {
	const ct = req.headers.get("content-type") || "";
	if (ct.includes("application/x-www-form-urlencoded")) {
		const text = await req.text();
		const params = new URLSearchParams(text);
		const out: Record<string, string> = {};
		for (const [k, v] of params.entries()) out[k] = v;
		return out;
	}
	if (ct.includes("application/json")) {
		const json = (await req.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		const out: Record<string, string> = {};
		if (json) {
			for (const [k, v] of Object.entries(json)) {
				if (typeof v === "string") out[k] = v;
			}
		}
		return out;
	}
	return {};
}

async function signIdToken(
	env: Env,
	issuer: string,
	subject: string,
	audience: string,
	claims: Record<string, unknown>,
): Promise<string> {
	if (!env.OIDC_SIGNING_KEY) {
		throw new Error("signIdToken: OIDC_SIGNING_KEY not configured.");
	}
	const privateKey = await importPKCS8(env.OIDC_SIGNING_KEY, "RS256");
	const now = Math.floor(Date.now() / 1000);

	// Resolve a kid from OIDC_PUBLIC_JWK if present so /jwks lookups
	// match. Some OIDC clients (Mattermost included via GitLab module)
	// don't require kid, but it's defensive.
	let kid: string | undefined;
	if (env.OIDC_PUBLIC_JWK) {
		try {
			const parsed = JSON.parse(env.OIDC_PUBLIC_JWK) as
				| { kid?: string; keys?: { kid?: string }[] }
				| undefined;
			if (parsed?.kid) kid = parsed.kid;
			else if (parsed?.keys?.[0]?.kid) kid = parsed.keys[0].kid;
		} catch {
			/* ignore */
		}
	}

	const jwt = await new SignJWT(claims)
		.setProtectedHeader({ alg: "RS256", ...(kid ? { kid } : {}) })
		.setIssuer(issuer)
		.setSubject(subject)
		.setAudience(audience)
		.setIssuedAt(now)
		.setExpirationTime(now + ID_TOKEN_TTL_SECONDS)
		.sign(privateKey);
	return jwt;
}

oidc.post("/token", async (c) => {
	const body = await readTokenRequestBody(c.req.raw);
	const { clientId, clientSecret } = parseClientCredentials(
		c.req.raw,
		body.client_id ?? null,
		body.client_secret ?? null,
	);
	const grantType = body.grant_type;
	const code = body.code;
	const redirectUri = body.redirect_uri;

	if (grantType !== "authorization_code") {
		return c.json({ error: "unsupported_grant_type" }, 400);
	}
	if (!clientId || !clientSecret) {
		return c.json({ error: "invalid_client" }, 401);
	}
	if (
		clientId !== c.env.MATTERMOST_OIDC_CLIENT_ID ||
		clientSecret !== c.env.MATTERMOST_OIDC_CLIENT_SECRET
	) {
		return c.json({ error: "invalid_client" }, 401);
	}
	if (!code || !redirectUri) {
		return c.json({ error: "invalid_request" }, 400);
	}

	const workspace = getWorkspaceStub(c.env);
	const record = await workspace.consumeAuthCode(code, clientId, redirectUri);
	if (!record) {
		return c.json({ error: "invalid_grant" }, 400);
	}

	const issuer = baseUrl(c.req.raw);
	const { token: accessToken, expiresIn } = await workspace.createAccessToken({
		clerkUserId: record.clerk_user_id,
		email: record.email,
		name: record.name,
		picture: record.picture ?? null,
		clientId,
		ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
	});

	let idToken: string;
	try {
		// Split name → given/family for OIDC consumers like Mattermost
		// that prefer those over a single "name" claim.
		const parts = (record.name || "").trim().split(/\s+/);
		const givenName = parts[0] || record.email.split("@")[0];
		const familyName = parts.length > 1 ? parts.slice(1).join(" ") : "";

		idToken = await signIdToken(c.env, issuer, record.clerk_user_id, clientId, {
			email: record.email,
			email_verified: true,
			name: record.name,
			given_name: givenName,
			family_name: familyName,
			picture: record.picture ?? undefined,
			preferred_username: record.email.split("@")[0],
		});
	} catch (e) {
		return c.json(
			{
				error: "server_error",
				detail: `id_token sign failed: ${(e as Error).message}`,
			},
			500,
		);
	}

	// Fire-and-forget sweep so the codes/tokens tables stay tidy.
	c.executionCtx.waitUntil(workspace.sweepExpired().then(() => undefined));

	return c.json(
		{
			access_token: accessToken,
			id_token: idToken,
			token_type: "Bearer",
			expires_in: expiresIn,
			scope: record.scope,
		},
		200,
		{
			"Cache-Control": "no-store",
			Pragma: "no-cache",
		},
	);
});

// — Userinfo ————————————————————————————————————————————————

oidc.get("/userinfo", async (c) => {
	const auth = c.req.header("authorization") || "";
	const m = /^Bearer\s+(.+)$/i.exec(auth);
	if (!m) {
		return c.json({ error: "invalid_token" }, 401, {
			"WWW-Authenticate": 'Bearer error="invalid_token"',
		});
	}
	const token = m[1].trim();
	const workspace = getWorkspaceStub(c.env);
	const record = await workspace.lookupAccessToken(token);
	if (!record) {
		return c.json({ error: "invalid_token" }, 401, {
			"WWW-Authenticate": 'Bearer error="invalid_token"',
		});
	}

	const parts = (record.name || "").trim().split(/\s+/);
	const givenName = parts[0] || record.email.split("@")[0];
	const familyName = parts.length > 1 ? parts.slice(1).join(" ") : "";

	return c.json({
		sub: record.clerk_user_id,
		email: record.email,
		email_verified: true,
		name: record.name,
		given_name: givenName,
		family_name: familyName,
		picture: record.picture ?? undefined,
		preferred_username: record.email.split("@")[0],
		username: record.email.split("@")[0],
		// Mattermost's GitLab adapter reads `id` (the GitLab user id).
		// We map to Clerk's user id which is stable.
		id: record.clerk_user_id,
	});
});

export { oidc };
