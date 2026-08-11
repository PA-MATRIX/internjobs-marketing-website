// Phase 32 (32-01): Parrot embed-token minting.
//
// Phase 32 embeds Parrot's internjobs tenant as the Workspace SMS/phone
// pane via an authenticated <iframe> that loads
// https://parrot.projecta.ai/embed?token=<JWT>. This module signs that
// short-lived (~120s) RS256 JWT.
//
// CRITICAL: we reuse the SAME OIDC_SIGNING_KEY that workers/routes/oidc.ts
// signs Mattermost id_tokens with — the public half of which /oidc/jwks
// already publishes. Parrot is configured to fetch
// https://workspace.internjobs.ai/oidc/jwks and verify against it, so there
// is NO separate key to provision or rotate for this integration. This
// mirrors signIdToken()'s exact signing pattern (importPKCS8 + SignJWT +
// kid resolved from OIDC_PUBLIC_JWK).
//
// Contract locked in .planning/workstreams/team-workspace/WORKSPACE-HANDOFF.md
// and WORKSPACE-EMBED-REPLY.md: aud="parrot-embed", exp≈120s, sub+email
// ALWAYS populated (Parrot rejects/mismatches otherwise), role drives
// Parrot's admin-vs-employee interface selection.
//
// This is a PURE function module — no Hono, no Durable Object access — so it
// is directly unit-testable without any HTTP plumbing.

import { SignJWT, importPKCS8 } from "jose";

export const EMBED_TOKEN_AUDIENCE = "parrot-embed";
export const EMBED_TOKEN_TTL_SECONDS = 120;

export interface EmbedTokenEnv {
	OIDC_SIGNING_KEY?: string;
	OIDC_PUBLIC_JWK?: string;
}

export interface EmbedTokenClaims {
	/** Clerk employee user id. Stable per employee across logins. REQUIRED. */
	sub: string;
	/** Canonical lowercased provisioned Workspace email. REQUIRED. */
	email: string;
	/** Display name, read fresh on every mint. */
	name: string;
	/** Display-only phone (E.164 or whatever Clerk has). Optional. */
	phone?: string;
	/** "admin" for Workspace operators (isOperator() === true), else "employee". */
	role: "admin" | "employee";
}

export interface MintedEmbedToken {
	token: string;
	expiresIn: number;
}

/**
 * Signs a short-lived (~120s) RS256 embed JWT for the Parrot iframe, using
 * the SAME OIDC_SIGNING_KEY that workers/routes/oidc.ts signs Mattermost
 * id_tokens with (and that /oidc/jwks already publishes the public half
 * of). Parrot fetches that JWKS and verifies against it — there is no
 * separate key to provision or rotate for this integration.
 *
 * Fails closed by throwing (never emitting a malformed token) when the
 * signing key is absent or when sub/email are blank — the latter is the
 * defense-in-depth backstop for the "sub + email always populated"
 * guarantee Parrot's contract depends on.
 */
export async function mintEmbedToken(
	env: EmbedTokenEnv,
	issuer: string,
	claims: EmbedTokenClaims,
): Promise<MintedEmbedToken> {
	if (!env.OIDC_SIGNING_KEY) {
		throw new Error("mintEmbedToken: OIDC_SIGNING_KEY not configured.");
	}
	if (!claims.sub || !claims.sub.trim()) {
		throw new Error("mintEmbedToken: sub is required and must be non-empty.");
	}
	if (!claims.email || !claims.email.trim()) {
		throw new Error("mintEmbedToken: email is required and must be non-empty.");
	}

	const privateKey = await importPKCS8(env.OIDC_SIGNING_KEY, "RS256");
	const now = Math.floor(Date.now() / 1000);

	// Same kid-resolution as signIdToken in oidc.ts — keeps /oidc/jwks lookups
	// consistent across both token types this Worker signs.
	let kid: string | undefined;
	if (env.OIDC_PUBLIC_JWK) {
		try {
			const parsed = JSON.parse(env.OIDC_PUBLIC_JWK) as
				| { kid?: string; keys?: { kid?: string }[] }
				| undefined;
			if (parsed?.kid) kid = parsed.kid;
			else if (parsed?.keys?.[0]?.kid) kid = parsed.keys[0].kid;
		} catch {
			/* ignore — sign without kid, some verifiers don't require it */
		}
	}

	const jti = crypto.randomUUID();

	const token = await new SignJWT({
		email: claims.email.trim().toLowerCase(),
		name: claims.name,
		...(claims.phone ? { phone: claims.phone } : {}),
		role: claims.role,
	})
		.setProtectedHeader({ alg: "RS256", ...(kid ? { kid } : {}) })
		.setIssuer(issuer)
		.setSubject(claims.sub)
		.setAudience(EMBED_TOKEN_AUDIENCE)
		.setIssuedAt(now)
		.setExpirationTime(now + EMBED_TOKEN_TTL_SECONDS)
		.setJti(jti)
		.sign(privateKey);

	return { token, expiresIn: EMBED_TOKEN_TTL_SECONDS };
}
