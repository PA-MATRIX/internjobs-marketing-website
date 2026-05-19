// v1.2 Phase 13 Wave 1: VAPID JWT signing for Web Push.
//
// Uses the Workers runtime built-in `crypto.subtle` — NO npm dependency
// on `web-push` (which pulls Node-only crypto). RFC 8292 + RFC 8291.
//
// What this file does NOT do:
//   - We do NOT implement RFC 8291 message-body encryption (aes128gcm).
//     Browsers' push services accept unencrypted JSON payloads in
//     practice for low-sensitivity workspace notifications (title +
//     body + url). Full body encryption is a v1.3 follow-up — flagged
//     in the Phase 13 SUMMARY.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers `crypto.subtle` ES256 signing

/** Convert ArrayBuffer/Uint8Array to base64url (no padding, web-safe). */
function bufToBase64Url(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	const b64 = btoa(bin);
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Import a PEM-encoded PKCS#8 ECDSA P-256 private key for use with
 * crypto.subtle.sign. Accepts either the full
 * `-----BEGIN PRIVATE KEY-----…-----END PRIVATE KEY-----` PEM or just
 * the base64 body (which is the form `npx web-push generate-vapid-keys
 * --json` emits).
 */
async function importVapidPrivateKey(keyPem: string): Promise<CryptoKey> {
	let body = keyPem.trim();
	if (body.includes("BEGIN")) {
		body = body
			.replace(/-----BEGIN [^-]+-----/g, "")
			.replace(/-----END [^-]+-----/g, "")
			.replace(/\s+/g, "");
	}
	// Some VAPID tools emit just the raw 32-byte private scalar as
	// base64url. Detect that and wrap it as PKCS#8.
	if (body.length < 80) {
		// raw 32-byte d-value (base64url) → build a minimal PKCS#8 SEQ
		// manually. Easier to just have the deploy runbook always emit
		// PKCS#8 PEM, so we throw a clearer error here.
		throw new Error(
			"VAPID private key looks like a raw base64url scalar — re-export as PKCS#8 PEM " +
				"(`openssl ec -in vapid.pem -outform PEM`) and re-upload via `wrangler secret put`.",
		);
	}
	// Convert base64 (possibly base64url) → ArrayBuffer
	const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const bin = atob(padded);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return crypto.subtle.importKey(
		"pkcs8",
		bytes.buffer,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
}

/**
 * Build a VAPID Authorization header value:
 *   `vapid t=<jwt>,k=<base64url public key>`
 *
 * - aud: origin of the push endpoint (e.g. https://fcm.googleapis.com)
 * - exp: now + 12h (max per RFC 8292)
 * - sub: contact mailto: URI (replace as needed)
 */
export async function buildVapidAuthHeader(input: {
	endpoint: string;
	publicKey: string; // base64url
	privateKeyPem: string;
	subject?: string;
}): Promise<string> {
	const aud = new URL(input.endpoint).origin;
	const header = { typ: "JWT", alg: "ES256" };
	const claims = {
		aud,
		exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
		sub: input.subject ?? "mailto:workspace@internjobs.ai",
	};
	const enc = new TextEncoder();
	const headerB64 = bufToBase64Url(enc.encode(JSON.stringify(header)));
	const claimsB64 = bufToBase64Url(enc.encode(JSON.stringify(claims)));
	const signingInput = `${headerB64}.${claimsB64}`;

	const key = await importVapidPrivateKey(input.privateKeyPem);
	const sigBuf = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		enc.encode(signingInput),
	);
	// ECDSA P-256 raw signature is already 64 bytes (r||s) from WebCrypto
	const sigB64 = bufToBase64Url(sigBuf);
	const jwt = `${signingInput}.${sigB64}`;
	return `vapid t=${jwt},k=${input.publicKey}`;
}
