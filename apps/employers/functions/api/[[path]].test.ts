// apps/employers/functions/api/[[path]].test.ts
// v1.5 Phase 33-06 — auth-boundary unit tests for the employers Pages Function.
//
// Uses Node's built-in `node:test` runner via tsx (mirrors the
// stub-globalThis.fetch-by-URL, restore-in-finally pattern from
// apps/startup/workers/routes/email.test.ts). Run with:
//   cd apps/employers && npx tsx --test "functions/api/[[path]].test.ts"
//
// EVERY signature test uses a REAL generated RSA keypair — the JWKS the
// Pages Function verifies against is served by the same stubbed fetch that
// intercepts the Fly forwards. There is NO mocked crypto anywhere: forged /
// expired / wrong-issuer tokens are genuinely signed (or genuinely
// tampered) and must be rejected by real jose jwtVerify, not a stub.
//
// Coverage maps 1:1 to 33-06 must_haves:
//   1  forged signature            -> 401, zero Fly calls
//   2  expired token               -> 401, zero Fly calls
//   3  wrong issuer                -> 401, zero Fly calls
//   4  genuine session resolves    -> 200, NO Clerk Backend API call (hot path)
//   5  lazy-link on first sign-in  -> 200, Clerk + link each called once
//   6  second sign-in idempotent   -> 200, Clerk + link NOT called
//   7  takeover guard tripped      -> original 404 surfaced (never silent ok)
//   8  missing Authorization       -> 401 missing_clerk_token
//   9  unauth non-mapped path      -> 401 missing_clerk_token, zero forwards
//   10 forged token non-mapped     -> 401 invalid_clerk_token, zero forwards
//   11 client startup_id spoof     -> server-resolved startup_id wins

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { generateKeyPair, exportJWK, SignJWT } from "jose";

import { onRequest } from "./[[path]]";

// ── Real keypair + JWKS fixtures ─────────────────────────────────────────────

const JWKS_URL = "https://test-clerk.example.com/.well-known/jwks.json";
const ISSUER = "https://test-clerk.example.com";

const { publicKey, privateKey } = await generateKeyPair("RS256", {
  extractable: true,
});
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "test-key-1";
publicJwk.alg = "RS256";
publicJwk.use = "sig";

const now = () => Math.floor(Date.now() / 1000);
const FUTURE = () => now() + 3600;
const PAST = () => now() - 3600;

/**
 * Signs a JWT with the real private key. The caller supplies sub / iss /
 * exp explicitly per test (we don't default them — tests need to control
 * expiry and issuer directly to exercise rejection paths).
 */
async function signToken(
  claims: Record<string, unknown>,
  { kid = "test-key-1" }: { kid?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .sign(privateKey);
}

/** Structurally valid, cryptographically invalid: flip one signature char. */
function tamperSignature(jwt: string): string {
  const parts = jwt.split(".");
  const sig = parts[2];
  const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

// ── Fetch stub ───────────────────────────────────────────────────────────────

interface FlyCall {
  url: string;
  path: string;
  method: string;
  body: unknown;
}

interface StubConfig {
  identity?: () => Response;
  link?: () => Response;
  roles?: () => Response;
  clerkUser?: () => Response;
}

interface StubHandle {
  fetch: typeof fetch;
  flyCalls: FlyCall[];
  clerkCalls: () => number;
}

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function makeStub(config: StubConfig): StubHandle {
  const flyCalls: FlyCall[] = [];
  let clerkBackendCalls = 0;

  const stub: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    // JWKS fetch (jose createRemoteJWKSet) — NOT a Fly forward, never counted.
    if (url.includes("/.well-known/jwks.json")) {
      return jsonRes({ keys: [publicJwk] });
    }

    // Clerk Backend API verified-email lookup — counted separately.
    if (url.includes("api.clerk.com/v1/users")) {
      clerkBackendCalls += 1;
      return config.clerkUser
        ? config.clerkUser()
        : jsonRes({ error: "not_found" }, 404);
    }

    // Everything else represents a Fly forward. Record it so tests can
    // assert "zero forwards happened" precisely.
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      /* keep raw */
    }
    flyCalls.push({ url, path, method, body });

    if (url.includes("/v1/startups/identity-by-clerk-id")) {
      return config.identity ? config.identity() : jsonRes({ error: "not_found" }, 404);
    }
    if (url.includes("/v1/startups/link-clerk-id")) {
      return config.link
        ? config.link()
        : jsonRes({ error: "no_linkable_member_found" }, 404);
    }
    if (url.includes("/v1/roles")) {
      return config.roles ? config.roles() : jsonRes({ id: "role-1" });
    }
    // Any other Fly path (e.g. /v1/startups/:id/stats, or an unexpected
    // passthrough forward) — succeed benignly; presence in flyCalls is the
    // signal the tests care about.
    return jsonRes({});
  };

  return { fetch: stub, flyCalls, clerkCalls: () => clerkBackendCalls };
}

async function withStub<T>(
  config: StubConfig,
  fn: (h: StubHandle) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const handle = makeStub(config);
  globalThis.fetch = handle.fetch;
  try {
    return await fn(handle);
  } finally {
    globalThis.fetch = original;
  }
}

// ── Env + request helpers ────────────────────────────────────────────────────

const baseEnv = {
  STARTUP_API_SECRET: "test-secret",
  STARTUP_API_URL: "https://fake-fly.test",
  STARTUPS_CLERK_JWKS_URL: JWKS_URL,
  STARTUPS_CLERK_ISSUER: ISSUER,
  STARTUPS_CLERK_SECRET_KEY: "sk_test_fake",
};

function apiRequest(
  tail: string,
  {
    method = "GET",
    token,
    body,
  }: { method?: string; token?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`https://employers.internjobs.ai/api${tail}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const meRequest = (token?: string) => apiRequest("/me", { method: "GET", token });

const call = (request: Request) =>
  onRequest({ request, env: baseEnv } as any) as Promise<Response>;

const flyForwards = (h: StubHandle) =>
  h.flyCalls.filter((c) => c.url.includes("fake-fly.test"));

const fullIdentity = () =>
  jsonRes({
    startup_id: "startup-real-owner",
    member_id: "m-1",
    startup_name: "RealCo",
    role: "founder",
  });

// ═════════════════════════════════════════════════════════════════════════════

test("rejects a JWT with an invalid/forged signature (401)", async () => {
  await withStub({ identity: fullIdentity }, async (h) => {
    const valid = await signToken({ sub: "user_attacker", iss: ISSUER, exp: FUTURE() });
    const forged = tamperSignature(valid);
    const res = await call(meRequest(forged));
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(text.includes("invalid_clerk_token"), `body: ${text}`);
    assert.equal(flyForwards(h).length, 0, "no Fly identity/link call may happen");
  });
});

test("rejects an expired token (401)", async () => {
  await withStub({ identity: fullIdentity }, async (h) => {
    const token = await signToken({ sub: "user_x", iss: ISSUER, exp: PAST() });
    const res = await call(meRequest(token));
    assert.equal(res.status, 401);
    assert.equal(flyForwards(h).length, 0);
  });
});

test("rejects a token with the wrong issuer (401)", async () => {
  await withStub({ identity: fullIdentity }, async (h) => {
    const token = await signToken({
      sub: "user_x",
      iss: "https://evil.example.com",
      exp: FUTURE(),
    });
    const res = await call(meRequest(token));
    assert.equal(res.status, 401);
    assert.equal(flyForwards(h).length, 0);
  });
});

test("accepts a genuine signed session and resolves identity, with no Clerk-Backend-API call on the hot path", async () => {
  await withStub({ identity: fullIdentity }, async (h) => {
    const token = await signToken({ sub: "user_real123", iss: ISSUER, exp: FUTURE() });
    const res = await call(meRequest(token));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { startup_id: string };
    assert.equal(json.startup_id, "startup-real-owner");
    assert.equal(h.clerkCalls(), 0, "already-linked member must not hit the Clerk Backend API");
  });
});

test("lazy-links a concierge placeholder on first sign-in", async () => {
  await withStub(
    {
      identity: () => jsonRes({ error: "not_found" }, 404),
      clerkUser: () =>
        jsonRes({
          id: "user_new456",
          primary_email_address_id: "idn_1",
          email_addresses: [
            {
              id: "idn_1",
              email_address: "founder@newco.com",
              verification: { status: "verified" },
            },
          ],
        }),
      link: () =>
        jsonRes({
          startup_id: "startup-newco",
          member_id: "m-new",
          startup_name: "NewCo",
          role: "founder",
        }),
    },
    async (h) => {
      const token = await signToken({ sub: "user_new456", iss: ISSUER, exp: FUTURE() });
      const res = await call(meRequest(token));
      assert.equal(res.status, 200);
      const json = (await res.json()) as { startup_id: string };
      assert.equal(json.startup_id, "startup-newco");
      assert.equal(h.clerkCalls(), 1, "verified email fetched exactly once");
      const linkCalls = h.flyCalls.filter((c) => c.path === "/v1/startups/link-clerk-id");
      assert.equal(linkCalls.length, 1, "link-clerk-id called exactly once");
      const b = linkCalls[0].body as { clerk_user_id?: string; email?: string };
      assert.equal(b.clerk_user_id, "user_new456");
      assert.equal(b.email, "founder@newco.com");
    },
  );
});

test("second sign-in from the same now-linked founder is idempotent", async () => {
  await withStub(
    {
      identity: () =>
        jsonRes({
          startup_id: "startup-newco",
          member_id: "m-new",
          startup_name: "NewCo",
          role: "founder",
        }),
      clerkUser: () => jsonRes({ error: "should_not_be_called" }, 500),
      link: () => jsonRes({ error: "should_not_be_called" }, 500),
    },
    async (h) => {
      const token = await signToken({ sub: "user_new456", iss: ISSUER, exp: FUTURE() });
      const res = await call(meRequest(token));
      assert.equal(res.status, 200);
      assert.equal(h.clerkCalls(), 0, "no Clerk Backend API call on the linked hot path");
      const linkCalls = h.flyCalls.filter((c) => c.path === "/v1/startups/link-clerk-id");
      assert.equal(linkCalls.length, 0, "link-clerk-id must not be called again");
    },
  );
});

test("respects Fly's takeover guard — surfaces the original 404 when link-clerk-id refuses to link", async () => {
  await withStub(
    {
      identity: () => jsonRes({ error: "not_found" }, 404),
      clerkUser: () =>
        jsonRes({
          id: "user_takeover",
          primary_email_address_id: "idn_1",
          email_addresses: [
            {
              id: "idn_1",
              email_address: "taken@corp.com",
              verification: { status: "verified" },
            },
          ],
        }),
      // Guard trips: the row is already linked to someone else.
      link: () => jsonRes({ error: "no_linkable_member_found" }, 404),
    },
    async () => {
      const token = await signToken({ sub: "user_takeover", iss: ISSUER, exp: FUTURE() });
      const res = await call(meRequest(token));
      assert.equal(res.status, 404, "must surface the ORIGINAL 404, never a silent success");
    },
  );
});

test("missing Authorization header returns 401 missing_clerk_token", async () => {
  await withStub({}, async (h) => {
    const res = await call(meRequest());
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(text.includes("missing_clerk_token"), `body: ${text}`);
    assert.equal(flyForwards(h).length, 0);
  });
});

test("an unauthenticated request to a non-explicitly-mapped path is rejected with 401, not forwarded", async () => {
  await withStub({}, async (h) => {
    const res = await call(apiRequest("/search/candidates", { method: "GET" }));
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(text.includes("missing_clerk_token"), `body: ${text}`);
    assert.equal(flyForwards(h).length, 0, "passthrough forward must never be attempted");
  });
});

test("a forged/invalid token on a non-explicitly-mapped path is also rejected with 401", async () => {
  await withStub({}, async (h) => {
    const valid = await signToken({ sub: "user_attacker", iss: ISSUER, exp: FUTURE() });
    const forged = tamperSignature(valid);
    const res = await call(apiRequest("/search/candidates", { method: "GET", token: forged }));
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.ok(text.includes("invalid_clerk_token"), `body: ${text}`);
    assert.equal(flyForwards(h).length, 0, "no forward on an unverified token");
  });
});

test("a client-supplied startup_id is never honored — POST /api/roles always stamps the caller's OWN resolved startup_id", async () => {
  await withStub(
    {
      identity: fullIdentity, // resolves to startup-real-owner
      roles: () => jsonRes({ id: "role-created" }),
    },
    async (h) => {
      const token = await signToken({ sub: "user_real123", iss: ISSUER, exp: FUTURE() });
      const res = await call(
        apiRequest("/roles", {
          method: "POST",
          token,
          body: {
            startup_id: "startup-someone-elses",
            title: "Spoofed role",
            description: "attempt to write into another startup",
          },
        }),
      );
      assert.equal(res.status, 200);
      const rolesCalls = h.flyCalls.filter((c) => c.path === "/v1/roles");
      assert.equal(rolesCalls.length, 1);
      const b = rolesCalls[0].body as { startup_id?: string };
      assert.equal(
        b.startup_id,
        "startup-real-owner",
        "the server-resolved startup_id must win over the client's spoofed value",
      );
    },
  );
});
