import { useAuth } from "@clerk/clerk-react";

// Thin wrapper around fetch() that:
//   1. Always hits same-origin /api/* (no CORS, all traffic terminates at the
//      CF Pages Function in functions/api/[[path]].ts).
//   2. Attaches the current Clerk session JWT as `Authorization: Bearer <jwt>`
//      so the Pages Function can resolve startup_id + member_id on the Fly
//      side. (The Pages Function swaps this header for the internal STARTUP_
//      API_SECRET before forwarding — see functions/api/[[path]].ts.)
//   3. Returns the parsed JSON or throws on non-2xx.
//
// Usage:
//   const api = useApi();
//   const me = await api<MeResponse>("/me");
//
// "/me" hits the Pages Function which forwards to STARTUP_API_URL/v1/me
// (Fly proxy). The /v1/ prefix is added by the Pages Function so callers can
// keep paths short.
export function useApi() {
  const { getToken } = useAuth();

  return async function api<T = unknown>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    const url = `/api${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`api ${path} failed: ${res.status} ${detail}`.trim());
    }

    return (await res.json()) as T;
  };
}
