// Phase 32 (32-01): mintEmbedToken() unit tests — REAL crypto, not mocked.
//
// These tests generate a throwaway RS256 keypair, feed the PKCS8 private
// half as OIDC_SIGNING_KEY and the public half as a JWK (with a kid) as
// OIDC_PUBLIC_JWK — exactly the shape workers/routes/oidc.ts's /jwks handler
// serves. Verifying a minted token against a createLocalJWKSet built from
// that JWK is therefore equivalent to "verifies against our own live JWKS,"
// which is what Parrot does at runtime by fetching /oidc/jwks. The negative
// case (verify against an unrelated key) proves the signature is meaningful
// rather than a false-positive round-trip.

import { describe, it, expect, beforeAll } from "vitest";
import {
	generateKeyPair,
	exportPKCS8,
	exportJWK,
	createLocalJWKSet,
	jwtVerify,
	decodeJwt,
	type JWK,
} from "jose";
import {
	mintEmbedToken,
	EMBED_TOKEN_AUDIENCE,
	EMBED_TOKEN_TTL_SECONDS,
	type EmbedTokenEnv,
	type EmbedTokenClaims,
} from "../../lib/embed-jwt";

const ISSUER = "https://workspace.internjobs.ai";
const KID = "test-embed-kid-1";

// Primary keypair — this is "our" signing key.
let env: EmbedTokenEnv;
let publicJwk: JWK;
// A second, unrelated keypair for the negative test.
let otherPublicJwk: JWK;

const baseClaims: EmbedTokenClaims = {
	sub: "user_clerk_abc123",
	email: "Test.Employee@InternJobs.ai", // deliberately mixed-case to check normalization
	name: "Test Employee",
	phone: "+15551234567",
	role: "employee",
};

async function buildKeyMaterial() {
	const { publicKey, privateKey } = await generateKeyPair("RS256", {
		extractable: true,
	});
	const pkcs8 = await exportPKCS8(privateKey);
	const jwk = await exportJWK(publicKey);
	jwk.kid = KID;
	jwk.alg = "RS256";
	jwk.use = "sig";
	return { pkcs8, jwk };
}

beforeAll(async () => {
	const primary = await buildKeyMaterial();
	env = {
		OIDC_SIGNING_KEY: primary.pkcs8,
		// Mirror the real /oidc/jwks shape: OIDC_PUBLIC_JWK is a JSON string.
		// oidc.ts accepts either a bare JWK or a { keys: [...] } set; use a
		// bare JWK here (the shape that carries a top-level kid the mint reads).
		OIDC_PUBLIC_JWK: JSON.stringify(primary.jwk),
	};
	publicJwk = primary.jwk;

	const other = await buildKeyMaterial();
	otherPublicJwk = other.jwk;
});

function ourJwks() {
	// Same shape /oidc/jwks serves: { keys: [ <public JWK> ] }.
	return createLocalJWKSet({ keys: [publicJwk] });
}

describe("mintEmbedToken", () => {
	it("1. round-trips: minted token verifies against our own JWKS shape with exact claims", async () => {
		const { token } = await mintEmbedToken(env, ISSUER, baseClaims);
		const { payload } = await jwtVerify(token, ourJwks(), {
			issuer: ISSUER,
			audience: EMBED_TOKEN_AUDIENCE,
		});
		expect(payload.sub).toBe(baseClaims.sub);
		// email is lowercased + trimmed by the mint.
		expect(payload.email).toBe("test.employee@internjobs.ai");
		expect(payload.name).toBe(baseClaims.name);
		expect(payload.phone).toBe(baseClaims.phone);
		expect(payload.role).toBe("employee");
	});

	it("2. exp is exactly iat + TTL (~120s)", async () => {
		const { token, expiresIn } = await mintEmbedToken(env, ISSUER, baseClaims);
		const payload = decodeJwt(token);
		expect(payload.exp).toBeDefined();
		expect(payload.iat).toBeDefined();
		expect((payload.exp as number) - (payload.iat as number)).toBe(
			EMBED_TOKEN_TTL_SECONDS,
		);
		expect(expiresIn).toBe(EMBED_TOKEN_TTL_SECONDS);
		expect(EMBED_TOKEN_TTL_SECONDS).toBe(120);
	});

	it("3. aud is 'parrot-embed' and iss is the supplied issuer", async () => {
		const { token } = await mintEmbedToken(env, ISSUER, baseClaims);
		const payload = decodeJwt(token);
		expect(payload.aud).toBe("parrot-embed");
		expect(payload.aud).toBe(EMBED_TOKEN_AUDIENCE);
		expect(payload.iss).toBe(ISSUER);
	});

	it("4. jti is present and unique across two mints", async () => {
		const a = await mintEmbedToken(env, ISSUER, baseClaims);
		const b = await mintEmbedToken(env, ISSUER, baseClaims);
		const pa = decodeJwt(a.token);
		const pb = decodeJwt(b.token);
		expect(pa.jti).toBeTruthy();
		expect(pb.jti).toBeTruthy();
		expect(pa.jti).not.toBe(pb.jti);
	});

	it("5. role passthrough — admin", async () => {
		const { token } = await mintEmbedToken(env, ISSUER, {
			...baseClaims,
			role: "admin",
		});
		const { payload } = await jwtVerify(token, ourJwks(), {
			issuer: ISSUER,
			audience: EMBED_TOKEN_AUDIENCE,
		});
		expect(payload.role).toBe("admin");
	});

	it("6. role passthrough — employee", async () => {
		const { token } = await mintEmbedToken(env, ISSUER, {
			...baseClaims,
			role: "employee",
		});
		const { payload } = await jwtVerify(token, ourJwks(), {
			issuer: ISSUER,
			audience: EMBED_TOKEN_AUDIENCE,
		});
		expect(payload.role).toBe("employee");
	});

	it("7. throws when OIDC_SIGNING_KEY is absent (fails closed, no malformed token)", async () => {
		await expect(mintEmbedToken({}, ISSUER, baseClaims)).rejects.toThrow(
			/OIDC_SIGNING_KEY/,
		);
	});

	it("8. throws when sub is empty (defense-in-depth for 'sub always populated')", async () => {
		await expect(
			mintEmbedToken(env, ISSUER, { ...baseClaims, sub: "   " }),
		).rejects.toThrow(/sub is required/);
	});

	it("9. throws when email is empty (defense-in-depth for 'email always populated')", async () => {
		await expect(
			mintEmbedToken(env, ISSUER, { ...baseClaims, email: "" }),
		).rejects.toThrow(/email is required/);
	});

	it("10. verification FAILS against an unrelated key (signature is meaningful)", async () => {
		const { token } = await mintEmbedToken(env, ISSUER, baseClaims);
		const foreignJwks = createLocalJWKSet({ keys: [otherPublicJwk] });
		await expect(
			jwtVerify(token, foreignJwks, {
				issuer: ISSUER,
				audience: EMBED_TOKEN_AUDIENCE,
			}),
		).rejects.toThrow();
	});

	it("omits phone claim when phone is not provided", async () => {
		const { phone, ...noPhone } = baseClaims;
		void phone;
		const { token } = await mintEmbedToken(env, ISSUER, noPhone);
		const payload = decodeJwt(token);
		expect(payload.phone).toBeUndefined();
	});
});
