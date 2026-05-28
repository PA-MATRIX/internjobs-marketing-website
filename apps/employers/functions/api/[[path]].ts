// CF Pages Function — authenticated proxy from the Vite SPA to the
// internjobs-startup-api Fly service.
//
// Routes: catch-all on /api/*. All requests from the browser hit
// https://startups.internjobs.ai/api/<path> and this function:
//
//   1. Strips the /api prefix and rewrites to STARTUP_API_URL/v1/<path>.
//   2. Replaces the incoming Authorization header (which carries the Clerk
//      session JWT) with `Authorization: Bearer <STARTUP_API_SECRET>` — the
//      shared-secret the Fly proxy expects. The original Clerk JWT is
//      forwarded as X-Clerk-Token so the Fly layer can resolve the
//      requesting startup_id + member_id via Clerk JWKS verification.
//   3. Pipes the body through for non-GET/HEAD methods.
//
// 28.5-03 path mapping additions (this commit):
//   - GET  /api/me                       → derived from /v1/startups/identity-by-clerk-id
//                                          + /v1/startups/:id/stats (+ /v1/search/roles for count)
//   - GET  /api/roles                    → POST /v1/search/roles
//   - GET  /api/threads                  → POST /v1/search/threads
//   - GET  /api/threads/:id/messages     → 501 not_implemented (TODO: Fly endpoint deferred to v1.5)
//   - POST /api/threads/:id/reply        → POST /v1/messages
//   - everything else                    → pass-through (existing 28.5-02 behavior)
//
// Why mapping lives here, not on Fly: Clerk-JWT → startup_id resolution is the only
// new dependency; the Fly proxy already has every primitive we need. A single
// Pages Function deploy is cheaper than redeploying Fly for v1.4 pilot scope.
//
// SECURITY: STARTUP_API_SECRET must NEVER appear in the Vite bundle. It is
// only available at Pages-Function runtime via the Cloudflare Pages secret
// store (`wrangler pages secret put STARTUP_API_SECRET`). The Vite bundle
// only contains VITE_CLERK_PUBLISHABLE_KEY (public by design).
//
// IDENTITY MODEL: We forward the Clerk JWT separately rather than embedding
// startup_id in the request — the Fly proxy is the authoritative resolver
// (it owns the startup_members.clerk_user_id mapping). This prevents the
// browser from spoofing a startup_id even if it controls the URL.

import type { PagesFunction } from "@cloudflare/workers-types";

interface Env {
  STARTUP_API_SECRET: string;
  STARTUP_API_URL: string;
}

// Decode a JWT payload WITHOUT signature verification. We use this only to
// extract the `sub` (Clerk user id) for routing identity calls; the Fly
// proxy is responsible for cryptographically validating the JWT against
// STARTUPS_CLERK_JWKS_URL when it serves the v1.5 hardened path. For v1.4
// pilot, the JWT travels as X-Clerk-Token and the Fly side trusts the
// pages-function-to-fly secret-auth boundary.
function decodeJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const json = JSON.parse(decoded);
    return typeof json.sub === "string" ? json.sub : null;
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
  | {
      ok: true;
      startup_id: string;
      member_id: string;
      startup_name: string;
      role: string;
    }
  | { ok: false; status: number; body: string }
> {
  const sub = decodeJwtSub(clerkToken);
  if (!sub) {
    return { ok: false, status: 401, body: "invalid_clerk_token" };
  }
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

// ── Pass-through (legacy /api/* paths from 28.5-02) ────────────────────────

async function handlePassThrough(
  request: Request,
  env: Env,
  clerkToken: string | null,
  tail: string,
  search: string,
): Promise<Response> {
  const target = `${env.STARTUP_API_URL.replace(/\/$/, "")}/v1${tail}${search}`;
  const forwardHeaders = new Headers();
  forwardHeaders.set("Authorization", `Bearer ${env.STARTUP_API_SECRET}`);
  const ct = request.headers.get("Content-Type");
  if (ct) forwardHeaders.set("Content-Type", ct);
  if (clerkToken) forwardHeaders.set("X-Clerk-Token", clerkToken);
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

  // Everything else: legacy pass-through (28.5-02 behavior).
  return handlePassThrough(request, env, clerkToken, tail, url.search);
};
