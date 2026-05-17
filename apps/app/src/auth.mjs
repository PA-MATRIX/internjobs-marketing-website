import { createClerkClient } from "@clerk/backend";
import { parseCookies, redirect, sendJson, signValue, verifySignedValue } from "./http.mjs";

const devCookie = "internjobs_dev_session";

// v1.2 AUTH-PROD (2026-05-16): cached Clerk SDK client. Lazily constructed
// on the first non-dev getAuth() invocation. The SDK internally caches its
// JWKS lookup, so process-lifetime singleton is the right pattern — we
// avoid re-wiring the HTTP pool on every request.
//
// Why @clerk/backend.authenticateRequest() and not a home-rolled JWT verify?
// Clerk's production custom-domain flow (clerk.internjobs.ai + the satellite
// accounts.internjobs.ai) issues a `__clerk_handshake` URL parameter on the
// FIRST cross-subdomain redirect that has to be exchanged for a session
// cookie. A JWKS-only verifier sees no `__session` cookie on that hop and
// returns null, which causes the app to redirect back to sign-in — an auth
// loop. authenticateRequest() handles the full state machine: `__session`
// cookie, `__clerk_handshake` URL param, signed-in, signed-out. The SDK
// also re-issues `Set-Cookie` headers on the handshake state which we
// forward verbatim from the route handler (see server.mjs's
// applyHandshakeOrContinue helper).
let _clerkClient = null;
function getClerkClient(config) {
  if (_clerkClient) return _clerkClient;
  _clerkClient = createClerkClient({
    secretKey: config.clerk.secretKey,
    publishableKey: config.clerk.publishableKey,
    apiUrl: config.clerk.backendApiUrl,
  });
  return _clerkClient;
}

// Test seam: allow auth.test.mjs (and any future smoke) to inject a mock
// or reset the singleton. Not exported in non-test paths.
export function _resetClerkClientForTest() {
  _clerkClient = null;
}

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

  // Dev cookie path — server-signed under ENABLE_DEV_AUTH gate. Used by
  // the smoke/test suite. Never reaches Clerk.
  if (config.enableDevAuth && cookies[devCookie]) {
    const payload = verifySignedValue(cookies[devCookie], config.appSessionSecret);
    if (payload) {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return normalizeClaims(claims, "dev");
    }
  }

  // Header-dev path — non-production only. Used by smoke tests that
  // simulate a Clerk session without standing up a real one. Never
  // reaches Clerk.
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

  // Real Clerk path (production custom domain: clerk.internjobs.ai +
  // accounts.internjobs.ai). Use @clerk/backend's authenticateRequest()
  // so we correctly handle the THREE states the SDK emits:
  //
  //   1. status === "handshake"  → Clerk needs to do a cross-subdomain
  //      redirect (the `__clerk_handshake` URL param dance). We return a
  //      sentinel { handshake: true, headers } so the route handler can
  //      forward Clerk's own Set-Cookie + Location headers verbatim.
  //   2. status === "signed-in"  → Real session. Normalize claims into
  //      the existing shape so downstream callers (requireAuth,
  //      requireOperatorAuth, requireStartupAuth, the /auth/callback
  //      handler) don't need any changes.
  //   3. status === "signed-out" → Return null. Caller redirects to
  //      sign-in. This is the expected response when a user with no
  //      cookies hits /auth/callback (e.g. `curl -I` without auth).
  //
  // We early-out (return null) if the Clerk config isn't populated —
  // this preserves the dev/test path that runs without Clerk envs.
  if (!config.clerk.publishableKey || !config.clerk.secretKey) {
    return null;
  }

  let webRequest;
  try {
    webRequest = toWebRequest(req, config);
  } catch (_err) {
    // Malformed URL or unusable headers — treat as signed-out rather
    // than crashing the request. The route handler's outer try/catch
    // in server.mjs will surface a 500 only if something else fails.
    return null;
  }

  let requestState;
  try {
    const clerk = getClerkClient(config);
    requestState = await clerk.authenticateRequest(webRequest, {
      authorizedParties: buildAuthorizedParties(config),
    });
  } catch (err) {
    // Network blip / Clerk outage / bad JWKS — log and treat as
    // signed-out. The user's next request will retry; the alternative
    // (throwing 5xx) would break /healthz independence and surprise
    // observers that don't carry session cookies.
    console.error(
      JSON.stringify({
        level: "error",
        message: "clerk_authenticate_request_failed",
        error: err?.message ?? String(err),
      }),
    );
    return null;
  }

  if (requestState.status === "handshake") {
    // Sentinel: the route handler must forward `headers` and short-circuit
    // with a redirect status. See applyHandshakeOrContinue() in server.mjs.
    return {
      handshake: true,
      headers: requestState.headers,
      reason: requestState.reason || null,
    };
  }

  if (requestState.status === "signed-in") {
    const a = requestState.toAuth();
    const sessionClaims = a.sessionClaims || {};
    // Map SDK auth → our normalized shape. The session JWT's standard
    // claims (sub, email, etc.) live on sessionClaims; userId is the
    // authoritative server-trusted Clerk ID. We pass `sub: a.userId`
    // so normalizeClaims.clerkUserId resolves correctly.
    return normalizeClaims(
      {
        sub: a.userId,
        sid: a.sessionId,
        email:
          sessionClaims.email ||
          sessionClaims.primary_email_address ||
          sessionClaims.email_address ||
          "",
        name:
          sessionClaims.name ||
          [sessionClaims.given_name, sessionClaims.family_name]
            .filter(Boolean)
            .join(" ") ||
          "",
        picture: sessionClaims.picture || sessionClaims.image_url || "",
        linkedinProfileUrl:
          sessionClaims.linkedinProfileUrl ||
          sessionClaims.linkedin_profile_url ||
          sessionClaims.profile ||
          "",
        provider: sessionClaims.provider || "linkedin",
        publicMetadata:
          sessionClaims.public_metadata || sessionClaims.publicMetadata || {},
      },
      "clerk",
    );
  }

  // signed-out
  return null;
}

// Build a Fetch API Request from a Node IncomingMessage. The SDK expects
// the Web API shape, not Node's. Headers are flattened to single-value
// strings (Headers ctor doesn't accept undefined or duplicate-array
// values cleanly across Node versions).
function toWebRequest(req, config) {
  const base = config.appUrl || `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/", base);
  const headerEntries = Object.entries(req.headers).flatMap(([name, value]) => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map((v) => [name, String(v)]);
    return [[name, String(value)]];
  });
  const headers = new Headers(headerEntries);
  return new Request(url.toString(), {
    method: req.method || "GET",
    headers,
  });
}

// Allow tokens issued for either the canonical app URL or the marketing
// apex. Clerk treats `azp` (authorized party) as the frontend origin; in
// our custom-domain setup that's the `app.internjobs.ai` Fly app.
function buildAuthorizedParties(config) {
  const parties = new Set();
  if (config.appUrl) parties.add(config.appUrl);
  parties.add("https://app.internjobs.ai");
  parties.add("https://internjobs.ai");
  return Array.from(parties);
}

// v1.2 AUTH-PROD: if getAuth() returned a handshake sentinel, forward
// Clerk's own headers (Location + Set-Cookie) and end the response with
// 307. Returns true iff a handshake was applied — callers MUST return
// immediately after a `true` result. Callers passing a non-handshake
// auth (or null) get false and proceed to their normal branching.
//
// This is the function used by every route handler (and middleware) that
// reads auth from getAuth(). It is the single place that translates
// Clerk's status='handshake' state into an HTTP response.
export function applyHandshakeOrContinue(res, auth) {
  if (!auth || auth.handshake !== true) return false;
  if (auth.headers && typeof auth.headers.forEach === "function") {
    auth.headers.forEach((value, name) => {
      // The Headers object can contain Set-Cookie + Location; setHeader
      // accepts string values. Node's res.setHeader handles multiple
      // Set-Cookie headers via append semantics when value is a string,
      // but Clerk emits them as a single comma-joined string here — Node
      // forwards that verbatim, which is what we want for the handshake.
      res.setHeader(name, value);
    });
  }
  res.statusCode = 307;
  res.end();
  return true;
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
//
// AUTH-PROD: if getAuth() returns a handshake sentinel, the helper writes
// the SDK's headers + 307 and we return null (the caller bails like for
// any unauthenticated case).
export async function requireStartupAuth(req, res, config) {
  const auth = await getAuth(req, config);
  if (applyHandshakeOrContinue(res, auth)) return null;
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
  // AUTH-PROD: handshake sentinel → SDK writes Location + Set-Cookie, we
  // return 307. Caller treats this exactly like an unauth case.
  if (applyHandshakeOrContinue(res, auth)) return null;
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

