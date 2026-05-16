import { createPublicKey, createVerify } from "node:crypto";
import { parseCookies, redirect, sendJson, signValue, verifySignedValue } from "./http.mjs";

const devCookie = "internjobs_dev_session";

export function setDevSessionCookie(res, config, overrides = {}) {
  // v1.2 Phase 05: optional overrides let dev sign-in pick an operator or
  // startup role. Default is the v1.1 student identity ('dev_jordan_linkedin').
  // The Clerk Backend API is bypassed in dev mode — requireOperatorAuth reads
  // userType directly from the signed cookie. This is only usable when
  // ENABLE_DEV_AUTH=true, so production cannot forge an operator role here.
  const claims = {
    sub: "dev_jordan_linkedin",
    email: "jordan@student.edu",
    name: "Jordan Lee",
    linkedinProfileUrl: "https://www.linkedin.com/in/jordan-builder",
    provider: "linkedin",
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = signValue(payload, config.appSessionSecret);

  res.setHeader("set-cookie", `${devCookie}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

export function clearDevSessionCookie(res) {
  res.setHeader("set-cookie", `${devCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function getAuth(req, config) {
  const cookies = parseCookies(req.headers.cookie || "");

  if (config.enableDevAuth && cookies[devCookie]) {
    const payload = verifySignedValue(cookies[devCookie], config.appSessionSecret);
    if (payload) {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return normalizeClaims(claims, "dev");
    }
  }

  const sessionJwt = cookies.__session || bearerToken(req);
  if (sessionJwt && config.clerk.jwksUrl) {
    const claims = await verifyJwtWithJwks(sessionJwt, config.clerk.jwksUrl);
    if (claims) return normalizeClaims(claims, "clerk");
  }

  if (!config.isProduction && req.headers["x-clerk-user-id"]) {
    return normalizeClaims(
      {
        sub: String(req.headers["x-clerk-user-id"]),
        email: req.headers["x-student-email"],
        name: req.headers["x-student-name"],
      },
      "header-dev",
    );
  }

  return null;
}

export function getSignInUrl(config) {
  if (config.clerk.signInUrl) {
    const url = new URL(config.clerk.signInUrl, config.appUrl);
    url.searchParams.set("redirect_url", `${config.appUrl}/auth/callback`);
    return url.toString();
  }

  if (config.enableDevAuth) return "/dev/sign-in";
  return "#configuration-needed";
}

// Returns the normalized auth object only if publicMetadata.userType === 'startup'.
// If authenticated but wrong type, sends 403. If unauthenticated, redirects to startup sign-in.
// Authorization MUST be enforced here (middleware level), never inside handlers.
export async function requireStartupAuth(req, res, config) {
  const auth = await getAuth(req, config);
  if (!auth?.clerkUserId) {
    redirect(res, getStartupSignInUrl(config));
    return null;
  }
  if (auth.userType !== "startup") {
    sendJson(res, 403, { error: "forbidden", reason: "not_startup" });
    return null;
  }
  return auth;
}

// v1.2 Phase 05 — operator-only middleware.
//
// PITFALLS #13: publicMetadata MUST be read server-side from Clerk Backend API,
// not from the session JWT claims. Session tokens can be stale or tampered
// with on the client; only the Backend API is authoritative.
//
// In dev mode (source === 'dev'), the cookie is signed by the server itself
// (ENABLE_DEV_AUTH gated), so the claim is trusted. The fetch path is never
// taken for dev sessions, which is what keeps the test/CI smoke suite from
// needing real Clerk credentials.
//
// The `clerkClient` parameter is injected for testability — a real call site
// passes the default (which uses fetch); the auth.test.mjs negative-case
// suite injects a mock that returns controlled publicMetadata.
//
// Returns the auth object on success, or null after sending a 403/redirect.
export async function requireOperatorAuth(req, res, config, clerkClient = defaultClerkClient) {
  const auth = await getAuth(req, config);
  if (!auth?.clerkUserId) {
    redirect(res, getSignInUrl(config));
    return null;
  }

  // Dev sessions: the cookie is server-signed under ENABLE_DEV_AUTH, so we
  // trust its userType claim directly. The signing secret is the same as the
  // app's session secret, which is locally controlled.
  if (auth.source === "dev" || auth.source === "header-dev") {
    if (auth.userType === "operator") return auth;
    sendJson(res, 403, { error: "forbidden", reason: "not_operator" });
    return null;
  }

  // Real Clerk session: re-fetch publicMetadata from the Backend API.
  if (!config.clerk.secretKey) {
    sendJson(res, 503, { error: "clerk_secret_key_missing" });
    return null;
  }

  let user;
  try {
    user = await clerkClient.users.getUser(auth.clerkUserId, config);
  } catch (err) {
    sendJson(res, 502, { error: "clerk_backend_unavailable", reason: err?.message || String(err) });
    return null;
  }

  const userType = user?.public_metadata?.userType || user?.publicMetadata?.userType || "";
  if (userType !== "operator") {
    sendJson(res, 403, { error: "forbidden", reason: "not_operator" });
    return null;
  }
  return { ...auth, userType: "operator" };
}

// Default Clerk Backend API client — thin fetch wrapper mirroring the same
// pattern as the /auth/callback handler in server.mjs. We don't pull in
// @clerk/backend to keep deps minimal and to match how the rest of the
// codebase talks to Clerk. Tests inject a mock with the same shape:
// `{ users: { getUser(userId, config) => Promise<UserPayload> } }`.
export const defaultClerkClient = {
  users: {
    async getUser(userId, config) {
      const response = await fetch(`${config.clerk.backendApiUrl}/v1/users/${userId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.clerk.secretKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`clerk_backend_${response.status}: ${text.slice(0, 200)}`);
      }
      return response.json();
    },
  },
};

export function getStartupSignInUrl(config) {
  if (config.clerk.signInUrl) {
    const url = new URL(config.clerk.signInUrl, config.appUrl);
    url.searchParams.set("redirect_url", `${config.appUrl}/auth/callback`);
    url.searchParams.set("after_sign_in_url", `${config.appUrl}/startup/onboarding`);
    return url.toString();
  }
  if (config.enableDevAuth) return "/dev/sign-in";
  return "#configuration-needed";
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function normalizeClaims(claims, source) {
  return {
    clerkUserId: claims.sub || claims.user_id || claims.id,
    email: claims.email || claims.email_address || claims.primary_email_address || "",
    name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || "",
    imageUrl: claims.picture || claims.image_url || "",
    linkedinProfileUrl: claims.linkedinProfileUrl || claims.linkedin_profile_url || claims.profile || "",
    provider: claims.provider || "linkedin",
    userType: claims.publicMetadata?.userType || claims.public_metadata?.userType || claims.userType || "",
    source,
    raw: redactClaims(claims),
  };
}

function redactClaims(claims) {
  const clone = { ...claims };
  delete clone.__raw;
  delete clone.sid;
  delete clone.azp;
  return clone;
}

async function verifyJwtWithJwks(jwt, jwksUrl) {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;

  const response = await fetch(jwksUrl);
  if (!response.ok) return null;
  const jwks = await response.json();
  const key = jwks.keys?.find((item) => item.kid === header.kid);
  if (!key) return null;

  const publicKey = createPublicKey({ key, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  return verifier.verify(publicKey, Buffer.from(encodedSignature, "base64url")) ? payload : null;
}
