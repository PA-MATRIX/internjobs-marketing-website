// CF Pages Function — authenticated proxy from the Vite SPA to the
// internjobs-startup-api Fly service.
//
// Routes: catch-all on /api/*. All requests from the browser hit
// https://employers.internjobs.ai/api/<path> and this function:
//
//   1. Strips the /api prefix and rewrites to STARTUP_API_URL/v1/<path>.
//   2. Cryptographically verifies the incoming Clerk session JWT (RS256 via
//      JWKS) HERE — this Pages Function is the boundary that already holds
//      the raw token, and the CF Workers runtime has WebCrypto + fetch for
//      jose's createRemoteJWKSet with zero extra runtime deps (v1.5 Phase
//      33-06). It then replaces the incoming Authorization header with
//      `Authorization: Bearer <STARTUP_API_SECRET>` — the shared secret the
//      Fly proxy expects — and resolves the startup identity server-side.
//      The raw Clerk JWT is still forwarded as X-Clerk-Token for context.
//   3. Pipes the body through for non-GET/HEAD methods.
//
// Path mapping (28.5-03) + auth hardening (v1.5 Phase 33-06):
//   - GET  /api/me                       → derived from /v1/startups/identity-by-clerk-id
//                                          + /v1/startups/:id/stats (+ /v1/search/roles for count)
//   - GET  /api/roles                    → POST /v1/search/roles
//   - POST /api/roles                    → POST /v1/roles (startup_id server-stamped)
//   - GET  /api/threads                  → POST /v1/search/threads
//   - GET  /api/threads/:id/messages     → shell (Fly endpoint deferred to v1.5)
//   - POST /api/threads/:id/reply        → POST /v1/messages
//   - everything else                    → 401 unless a verified session is
//                                          present AND the tail is in the
//                                          (currently EMPTY) PASSTHROUGH_ALLOWLIST
//
// Why verification lives here, not on Fly: this is the boundary that already
// holds the raw JWT. Moving JWKS verification to Fly (Node/Hono) would mean
// adding a JWT library + STARTUPS_CLERK_* secrets to a second runtime for no
// benefit — Fly already trusts this Pages Function via the shared
// STARTUP_API_SECRET.
//
// SECURITY: STARTUP_API_SECRET and STARTUPS_CLERK_SECRET_KEY must NEVER
// appear in the Vite bundle. They are only available at Pages-Function
// runtime via the Cloudflare Pages secret store
// (`wrangler pages secret put <NAME>`). The Vite bundle only contains
// VITE_CLERK_PUBLISHABLE_KEY (public by design).
//
// IDENTITY MODEL: We never trust a browser-supplied startup_id. The verified
// JWT `sub` is resolved to a startup_id server-side (Fly owns the
// startup_members.clerk_user_id mapping). This prevents the browser from
// spoofing a startup_id even if it controls the URL or request body.

import type { PagesFunction } from "@cloudflare/workers-types";
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { JWTPayload } from "jose";

interface Env {
  STARTUP_API_SECRET: string;
  STARTUP_API_URL: string;
  STARTUPS_CLERK_JWKS_URL: string;
  STARTUPS_CLERK_ISSUER: string;
  STARTUPS_CLERK_SECRET_KEY: string;
}

// ── Clerk JWT verification (v1.5 Phase 33-06 — closes an auth bypass) ──────
// Previously decodeJwtSub() base64-decoded the JWT payload with NO
// signature check — any caller could forge a JWT with an arbitrary `sub`
// and impersonate any founder via /api/me. This is the ONLY place a Clerk
// session JWT is trusted for identity in this app now.
//
// Cached at module scope: createRemoteJWKSet caches Clerk's JWKS in-memory
// (keyed by kid) and only re-fetches on cache-miss/rotation — this does
// NOT add a network round-trip to every request, only to isolate
// cold-start / key rotation. Mirrors apps/parrot/workers/routes/oidc.ts
// (getClerkJwks / verifyClerkSession) — same pattern, do not diverge.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksUrl: string | null = null;
function getJwks(jwksUrl: string) {
  if (cachedJwks && cachedJwksUrl === jwksUrl) return cachedJwks;
  cachedJwks = createRemoteJWKSet(new URL(jwksUrl));
  cachedJwksUrl = jwksUrl;
  return cachedJwks;
}

/**
 * Cryptographically verifies a Clerk session JWT (RS256 via JWKS) and
 * returns the verified `sub`, or null on ANY failure — bad signature,
 * expired (exp), not-yet-valid (nbf), wrong issuer, malformed token, or
 * missing env config. jose's jwtVerify checks exp/nbf automatically; the
 * explicit `issuer` option additionally rejects tokens from a different
 * Clerk instance.
 */
async function verifyClerkToken(jwt: string, env: Env): Promise<string | null> {
  if (!env.STARTUPS_CLERK_JWKS_URL || !env.STARTUPS_CLERK_ISSUER) return null;
  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(
      jwt,
      getJwks(env.STARTUPS_CLERK_JWKS_URL),
      { issuer: env.STARTUPS_CLERK_ISSUER },
    );
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
}
interface ClerkUserRecord {
  id: string;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
}

/**
 * Fetches the founder's VERIFIED primary email via the Clerk Backend API.
 * Clerk session JWTs don't carry email by default (no JWT template is
 * configured) — a template requires an out-of-band Dashboard change that
 * isn't reproducible from code/CLI, so this Backend API call is the
 * chosen path instead. Hand-rolled fetch (no SDK) mirrors the existing
 * apps/parrot/workers/lib/clerk-admin.ts pattern.
 *
 * WHY this doesn't add latency to every request: it's called ONLY from the
 * lazy-link branch of resolveIdentity(), which only runs when
 * identity-by-clerk-id returns 404 — i.e. exactly once per founder, on
 * their very first authenticated request after signup. Every later
 * request resolves directly by the (by-then-real) clerk_user_id and never
 * reaches this function again.
 *
 * Returns null (fail closed) if there's no primary email or it isn't
 * verification.status === 'verified'. This Clerk instance is passwordless
 * email+email_code-only, so Clerk itself enforces verification before an
 * account can exist — but we don't trust that invariant blindly here.
 */
async function getVerifiedClerkEmail(sub: string, env: Env): Promise<string | null> {
  if (!env.STARTUPS_CLERK_SECRET_KEY) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(sub)}`, {
      headers: { Authorization: `Bearer ${env.STARTUPS_CLERK_SECRET_KEY}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as ClerkUserRecord;
    const primary = (user.email_addresses ?? []).find(
      (e) => e.id === user.primary_email_address_id,
    );
    if (!primary || primary.verification?.status !== "verified") return null;
    return primary.email_address ?? null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

interface ForwardOpts {
  /** Fly-side path including leading slash and /v1 prefix (e.g. "/v1/roles"). */
  flyPath: string;
  /** HTTP method to use against Fly. */
  method: string;
  /** Optional JSON body. */
  body?: unknown;
  env: Env;
  /** Clerk JWT to forward as X-Clerk-Token (optional but expected). */
  clerkToken: string | null;
}

async function forwardToFly({
  flyPath,
  method,
  body,
  env,
  clerkToken,
}: ForwardOpts): Promise<Response> {
  const target = `${env.STARTUP_API_URL.replace(/\/$/, "")}${flyPath}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${env.STARTUP_API_SECRET}`);
  headers.set("Content-Type", "application/json");
  headers.set("X-Forwarded-By", "internjobs-startups-pages");
  if (clerkToken) headers.set("X-Clerk-Token", clerkToken);
  try {
    return await fetch(target, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: "upstream_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
}

async function resolveIdentity(
  env: Env,
  clerkToken: string,
): Promise<
  | { ok: true; startup_id: string; member_id: string; startup_name: string; role: string }
  | { ok: false; status: number; body: string }
> {
  const sub = await verifyClerkToken(clerkToken, env);
  if (!sub) {
    return { ok: false, status: 401, body: "invalid_clerk_token" };
  }

  const first = await lookupIdentityByClerkId(env, clerkToken, sub);
  if (first.ok || first.status !== 404) return first;

  // Lazy-link fallback (replaces the deleted 28.5-05 webhook): this
  // founder's row is still a concierge:% placeholder minted before their
  // Clerk account existed. Resolve their VERIFIED email and ask Fly to
  // flip it — Fly's guarded UPDATE (clerk_user_id LIKE 'concierge:%') is
  // the only thing that decides whether the flip is safe.
  const email = await getVerifiedClerkEmail(sub, env);
  if (!email) return first; // can't lazy-link without a verified email

  const linked = await forwardToFly({
    flyPath: "/v1/startups/link-clerk-id",
    method: "POST",
    body: { clerk_user_id: sub, email },
    env,
    clerkToken,
  });
  if (!linked.ok) {
    // Bug A (v1.5 33-08) — first-load race: the dashboard fires /me + /roles +
    // /threads concurrently. On the ONE load where the concierge:% → user_ flip
    // happens, one request wins the link; the others then find no concierge:%
    // row and link-clerk-id 404s here — even though the row is now correctly
    // linked to OUR OWN verified sub. Re-resolve by clerk_user_id: if a sibling
    // just linked us it now succeeds; a genuine no-member case still returns its
    // 404. This only re-reads by our verified sub (no new trust surface) and the
    // takeover guard (Fly's `clerk_user_id LIKE 'concierge:%'` UPDATE) is untouched.
    return await lookupIdentityByClerkId(env, clerkToken, sub);
  }

  try {
    const json = await linked.json<{
      startup_id: string;
      member_id: string;
      startup_name: string;
      role: string;
    }>();
    return { ok: true, ...json };
  } catch {
    return first;
  }
}

async function lookupIdentityByClerkId(
  env: Env,
  clerkToken: string,
  sub: string,
): Promise<
  | { ok: true; startup_id: string; member_id: string; startup_name: string; role: string }
  | { ok: false; status: number; body: string }
> {
  const r = await forwardToFly({
    flyPath: "/v1/startups/identity-by-clerk-id",
    method: "POST",
    body: { clerk_user_id: sub },
    env,
    clerkToken,
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, body: text };
  try {
    const json = JSON.parse(text);
    return {
      ok: true,
      startup_id: json.startup_id,
      member_id: json.member_id,
      startup_name: json.startup_name,
      role: json.role,
    };
  } catch {
    return { ok: false, status: 502, body: "invalid_identity_json" };
  }
}

// ── Per-route mappers ──────────────────────────────────────────────────────

async function handleGetMe(env: Env, clerkToken: string): Promise<Response> {
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const stats = await forwardToFly({
    flyPath: `/v1/startups/${encodeURIComponent(identity.startup_id)}/stats`,
    method: "GET",
    env,
    clerkToken,
  });
  let roleCount = 0;
  let agentEmail: string | null = null;
  if (stats.ok) {
    try {
      const sj = await stats.json<{
        active_role_count?: number;
        agent_email?: string | null;
      }>();
      roleCount = sj.active_role_count ?? 0;
      // agent_email is added by 28.5-04 migration 0013. Until then it's
      // simply absent and the dashboard renders the "pending" hint.
      agentEmail = sj.agent_email ?? null;
    } catch {
      /* fall through with defaults */
    }
  }
  return jsonResponse({
    startup_id: identity.startup_id,
    startup_name: identity.startup_name,
    member_id: identity.member_id,
    role: identity.role,
    agent_email: agentEmail,
    role_count: roleCount,
  });
}

async function handleGetRoles(env: Env, clerkToken: string): Promise<Response> {
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const r = await forwardToFly({
    flyPath: "/v1/search/roles",
    method: "POST",
    body: { startup_id: identity.startup_id, query: "", limit: 20 },
    env,
    clerkToken,
  });
  if (!r.ok) {
    const text = await r.text();
    return new Response(
      JSON.stringify({ error: "roles_lookup_failed", detail: text }),
      { status: r.status, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const sj = await r.json<{
      results: Array<{
        id: string;
        summary: string;
        description?: string;
        location?: string;
        comp_range?: string;
        status?: string;
        created_at?: string;
      }>;
    }>();
    const roles = (sj.results ?? []).map((row) => ({
      id: row.id,
      title: row.summary,
      description: row.description ?? "",
      location: row.location ?? null,
      comp_range: row.comp_range ?? null,
      status: row.status ?? "active",
      created_at: row.created_at ?? "",
    }));
    return jsonResponse(roles);
  } catch (err) {
    return jsonResponse(
      {
        error: "roles_parse_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
}

async function handlePostRoles(
  env: Env,
  clerkToken: string,
  request: Request,
): Promise<Response> {
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  // Stamp the resolved startup_id — the browser MUST NOT pick its own.
  const flyBody = { ...body, startup_id: identity.startup_id };
  const r = await forwardToFly({
    flyPath: "/v1/roles",
    method: "POST",
    body: flyBody,
    env,
    clerkToken,
  });
  // Pass through status + body.
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handleGetThreads(
  env: Env,
  clerkToken: string,
): Promise<Response> {
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const r = await forwardToFly({
    flyPath: "/v1/search/threads",
    method: "POST",
    body: { startup_id: identity.startup_id, query: "", limit: 20 },
    env,
    clerkToken,
  });
  if (!r.ok) {
    const text = await r.text();
    return new Response(
      JSON.stringify({ error: "threads_lookup_failed", detail: text }),
      { status: r.status, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const sj = await r.json<{
      results: Array<{
        id: string;
        summary: string;
        last_inbound_at?: string;
        message_count?: number;
      }>;
    }>();
    const threads = (sj.results ?? []).map((row) => ({
      thread_id: row.id,
      candidate_name: row.summary,
      last_message_at: row.last_inbound_at ?? "",
      unread_count: 0, // TODO 28.5-04: startup_mark='unread' is not aggregated yet
    }));
    return jsonResponse(threads);
  } catch (err) {
    return jsonResponse(
      {
        error: "threads_parse_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
}

async function handleGetThreadMessages(
  env: Env,
  clerkToken: string,
  threadId: string,
): Promise<Response> {
  // The Fly proxy does NOT yet expose a per-thread message-history GET.
  // The MCP `execute('get_thread_messages')` tool aggregates this server-
  // side but isn't reachable from the web path. For v1.4 we return an
  // empty thread shell so the UI renders without crashing, and a TODO
  // notes the Fly endpoint that needs to land.
  //
  // TODO(28.5-04 or v1.5): add `GET /v1/threads/:id/messages` to infra/
  // startup-api/src/index.mjs that joins outbound_messages + inbound_
  // messages by thread_id, returns the merged history scoped to the
  // resolved startup_id.
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return jsonResponse({
    thread_id: threadId,
    candidate_name: "candidate",
    messages: [],
    _note:
      "thread message history endpoint deferred — Fly /v1/threads/:id/messages not yet implemented",
  });
}

async function handlePostThreadReply(
  env: Env,
  clerkToken: string,
  threadId: string,
  request: Request,
): Promise<Response> {
  const identity = await resolveIdentity(env, clerkToken);
  if (!identity.ok) {
    return new Response(
      JSON.stringify({ error: "identity_lookup_failed", detail: identity.body }),
      {
        status: identity.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  let body: { body?: string } = {};
  try {
    body = (await request.json()) as { body?: string };
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const content = (body.body ?? "").trim();
  if (!content) return jsonResponse({ error: "body_required" }, 400);
  const r = await forwardToFly({
    flyPath: "/v1/messages",
    method: "POST",
    body: {
      thread_id: threadId,
      startup_id: identity.startup_id,
      member_id: identity.member_id,
      content,
      channel: "email",
      direction: "outbound",
    },
    env,
    clerkToken,
  });
  if (!r.ok) {
    const text = await r.text();
    return new Response(
      JSON.stringify({ error: "reply_send_failed", detail: text }),
      { status: r.status, headers: { "Content-Type": "application/json" } },
    );
  }
  // Normalize to { ok: true } — the client doesn't need the Fly row id here.
  return jsonResponse({ ok: true });
}

// ── Passthrough allowlist (SECURITY — v1.5 Phase 33-06) ─────────────────
// Deliberately empty. If a future route genuinely needs generic
// passthrough, add its exact tail here AND give its Fly handler
// ownership-scoping to the verified identity's startup_id (the way
// handlePostRoles already stamps startup_id above) — never trust a
// caller-supplied startup_id/:id from an unscoped forward.
const PASSTHROUGH_ALLOWLIST: ReadonlySet<string> = new Set([]);

async function handlePassThrough(
  request: Request,
  env: Env,
  tail: string,
  search: string,
): Promise<Response> {
  if (!PASSTHROUGH_ALLOWLIST.has(tail)) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  const target = `${env.STARTUP_API_URL.replace(/\/$/, "")}/v1${tail}${search}`;
  const forwardHeaders = new Headers();
  forwardHeaders.set("Authorization", `Bearer ${env.STARTUP_API_SECRET}`);
  const ct = request.headers.get("Content-Type");
  if (ct) forwardHeaders.set("Content-Type", ct);
  forwardHeaders.set("X-Forwarded-By", "internjobs-startups-pages");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  try {
    const upstream = await fetch(target, {
      method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
    });
    const responseHeaders = new Headers();
    const upstreamCt = upstream.headers.get("Content-Type");
    if (upstreamCt) responseHeaders.set("Content-Type", upstreamCt);
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: "upstream_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) {
    return jsonResponse({ error: "startup_api_not_configured" }, 503);
  }

  const url = new URL(request.url);
  const tail = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method.toUpperCase();

  // Extract Clerk JWT from Authorization: Bearer <jwt>.
  const incomingAuth = request.headers.get("Authorization") ?? "";
  const clerkToken = incomingAuth.toLowerCase().startsWith("bearer ")
    ? incomingAuth.slice(7).trim()
    : null;

  // High-level routes mapped to specific Fly endpoints.
  if (tail === "/me" && method === "GET") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handleGetMe(env, clerkToken);
  }

  if (tail === "/roles" && method === "GET") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handleGetRoles(env, clerkToken);
  }

  if (tail === "/roles" && method === "POST") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handlePostRoles(env, clerkToken, request);
  }

  if (tail === "/threads" && method === "GET") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handleGetThreads(env, clerkToken);
  }

  const threadMessagesMatch = tail.match(/^\/threads\/([^/]+)\/messages$/);
  if (threadMessagesMatch && method === "GET") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handleGetThreadMessages(
      env,
      clerkToken,
      decodeURIComponent(threadMessagesMatch[1]),
    );
  }

  const threadReplyMatch = tail.match(/^\/threads\/([^/]+)\/reply$/);
  if (threadReplyMatch && method === "POST") {
    if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
    return handlePostThreadReply(
      env,
      clerkToken,
      decodeURIComponent(threadReplyMatch[1]),
      request,
    );
  }

  // Everything else. SECURITY (v1.5 Phase 33-06, checker blocker-1 fix):
  // this must NEVER forward to Fly without a verified Clerk session.
  // Previously clerkToken could be null here and the request still
  // forwarded, authenticated only by the shared STARTUP_API_SECRET — a
  // second, EASIER auth bypass than the forged-JWT bug this plan
  // otherwise closes (no forgery required at all, just omit the header).
  if (!clerkToken) return jsonResponse({ error: "missing_clerk_token" }, 401);
  const verifiedSub = await verifyClerkToken(clerkToken, env);
  if (!verifiedSub) return jsonResponse({ error: "invalid_clerk_token" }, 401);
  return handlePassThrough(request, env, tail, url.search);
};
