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

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) {
    return new Response(
      JSON.stringify({ error: "startup_api_not_configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(request.url);
  // Strip the /api prefix. The Fly proxy mounts routes under /v1/, so
  // /api/me → /v1/me, /api/roles → /v1/roles, etc.
  const tail = url.pathname.replace(/^\/api/, "") || "/";
  const target = `${env.STARTUP_API_URL.replace(/\/$/, "")}/v1${tail}${url.search}`;

  // Forward the Clerk session JWT (if present) as X-Clerk-Token so the Fly
  // proxy can resolve startup_id from publicMetadata or the
  // startup_members.clerk_user_id mapping. The Authorization header is
  // overwritten with the shared-secret below.
  const incomingAuth = request.headers.get("Authorization") ?? "";
  const clerkToken = incomingAuth.toLowerCase().startsWith("bearer ")
    ? incomingAuth.slice(7).trim()
    : null;

  const forwardHeaders = new Headers();
  forwardHeaders.set("Authorization", `Bearer ${env.STARTUP_API_SECRET}`);
  const ct = request.headers.get("Content-Type");
  if (ct) forwardHeaders.set("Content-Type", ct);
  if (clerkToken) forwardHeaders.set("X-Clerk-Token", clerkToken);
  // Trace headers — useful when grepping wrangler tail / fly logs.
  forwardHeaders.set("X-Forwarded-By", "internjobs-startups-pages");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const upstream = await fetch(target, {
      method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
    });

    // Mirror the upstream status + body. We DO NOT mirror upstream headers
    // verbatim because the Fly proxy may leak internal headers; only safe
    // content headers are copied.
    const responseHeaders = new Headers();
    const upstreamCt = upstream.headers.get("Content-Type");
    if (upstreamCt) responseHeaders.set("Content-Type", upstreamCt);
    responseHeaders.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "upstream_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
};
