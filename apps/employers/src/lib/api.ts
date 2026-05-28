import { useAuth } from "@clerk/clerk-react";
import { useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// apps/employers typed API client.
//
// All functions hit the CF Pages Function at `/api/*` (see
// functions/api/[[path]].ts). The Pages Function:
//   1. Reads the Clerk session JWT from `Authorization: Bearer <jwt>`.
//   2. Swaps the Authorization header for the shared `STARTUP_API_SECRET`
//      (kept out of the Vite bundle — server-side only).
//   3. Forwards the Clerk JWT as `X-Clerk-Token` so the Fly proxy can
//      resolve the requesting startup_id via the
//      `startup_members.clerk_user_id` mapping.
//
// The functions exported below are the canonical client surface for the
// founder dashboard (28.5-03). Each call accepts a Clerk JWT string
// (callers use `useAuth().getToken()` to obtain it) and returns typed
// JSON. Non-2xx responses throw with status + body for downstream UI
// error rendering.
//
// SCHEMA PARITY (STARTUP-WEB-DASH-02): `createRole`'s body mirrors the
// MCP `execute('post_role')` enum exactly — no extra fields, no missing
// fields. Schema fragmentation between MCP and web is a hard regression.
// ─────────────────────────────────────────────────────────────────────────────

// ── Response types ──────────────────────────────────────────────────────────

export interface MeResponse {
  startup_id: string;
  startup_name: string;
  /** May be null until 28.5-04 ships the migration + slug assignment. */
  agent_email: string | null;
  role_count: number;
  member_id?: string;
  role?: string;
}

export interface RoleSummary {
  id: string;
  title: string;
  description: string;
  created_at: string;
  location?: string | null;
  comp_range?: string | null;
  status?: string;
}

export interface CreateRoleBody {
  title: string;
  description: string;
  location?: string;
  employment_type?: "full_time" | "part_time" | "contract" | "internship";
}

export interface CreateRoleResponse {
  id: string;
  title: string;
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
  channel: string;
}

export interface ThreadDetail {
  thread_id: string;
  candidate_name: string;
  messages: ThreadMessage[];
}

export interface ThreadSummary {
  thread_id: string;
  candidate_name: string;
  last_message_at: string;
  unread_count: number;
}

// ── Internal request helper ─────────────────────────────────────────────────

class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
}

async function apiRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const url = `/api${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      text,
      `api ${path} failed: ${res.status} ${text}`.trim(),
    );
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ApiError(
      res.status,
      text,
      `api ${path} returned invalid json: ${(err as Error).message}`,
    );
  }
}

// ── Public API functions ────────────────────────────────────────────────────

/**
 * Resolves the authenticated founder's startup identity. The Pages Function
 * forwards the Clerk JWT to the Fly proxy which resolves the row via
 * `startup_members.clerk_user_id`.
 *
 * agent_email may be null until Phase 28.5-04 ships migration 0013 +
 * per-startup slug assignment. UI must degrade gracefully.
 */
export async function getMe(token: string): Promise<MeResponse> {
  return apiRequest<MeResponse>(token, "/me");
}

/**
 * Lists roles for the authenticated startup. Backed by the Fly proxy's
 * structured search (`POST /v1/search/roles`) under the hood — the Pages
 * Function maps `GET /api/roles` to that call.
 */
export async function getRoles(token: string): Promise<RoleSummary[]> {
  return apiRequest<RoleSummary[]>(token, "/roles");
}

/**
 * Creates a role. Fields match the MCP `execute('post_role')` schema
 * exactly — no extra fields, no missing fields. Schema parity is a hard
 * requirement (STARTUP-WEB-DASH-02).
 */
export async function createRole(
  token: string,
  body: CreateRoleBody,
): Promise<CreateRoleResponse> {
  return apiRequest<CreateRoleResponse>(token, "/roles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Fetches the full message history for a single candidate thread, plus
 * the candidate's display name.
 */
export async function getThread(
  token: string,
  threadId: string,
): Promise<ThreadDetail> {
  return apiRequest<ThreadDetail>(
    token,
    `/threads/${encodeURIComponent(threadId)}/messages`,
  );
}

/**
 * Posts a reply on a candidate thread. Sends outbound from the startup's
 * agent_email (configured by Phase 28.5-04 + 29). Returns `{ ok: true }`
 * on success.
 */
export async function sendReply(
  token: string,
  threadId: string,
  body: string,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    token,
    `/threads/${encodeURIComponent(threadId)}/reply`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

/**
 * Lists recent candidate threads for the dashboard inbox preview.
 */
export async function getThreads(token: string): Promise<ThreadSummary[]> {
  return apiRequest<ThreadSummary[]>(token, "/threads");
}

// ── React hook (preserves 28.5-02 useApi() contract) ────────────────────────

/**
 * useApi() — convenience hook that returns a generic `fetch`-style function
 * pre-bound to the current Clerk JWT and the `/api/*` proxy origin. Kept
 * for backward compatibility with the dashboard skeleton from 28.5-02.
 *
 * For new code, prefer the typed exports above (`getMe`, `getRoles`, etc.) +
 * `useApiBound()` which returns them all bound to the current token.
 */
export function useApi() {
  const { getToken } = useAuth();

  return useCallback(
    async function api<T = unknown>(
      path: string,
      init?: RequestInit,
    ): Promise<T> {
      const token = await getToken();
      if (!token) {
        throw new ApiError(401, "", "api called without a signed-in user");
      }
      return apiRequest<T>(token, path, init);
    },
    [getToken],
  );
}

/**
 * useApiBound() — returns all typed API functions pre-bound to the
 * current Clerk session. Lets callers do:
 *
 *   const api = useApiBound();
 *   const me = await api.getMe();
 *
 * Without threading `token` through every call site.
 */
export function useApiBound() {
  const { getToken } = useAuth();

  return useMemo(
    () => ({
      getMe: async () => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return getMe(t);
      },
      getRoles: async () => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return getRoles(t);
      },
      createRole: async (body: CreateRoleBody) => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return createRole(t, body);
      },
      getThread: async (threadId: string) => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return getThread(t, threadId);
      },
      sendReply: async (threadId: string, body: string) => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return sendReply(t, threadId, body);
      },
      getThreads: async () => {
        const t = await getToken();
        if (!t) throw new ApiError(401, "", "not signed in");
        return getThreads(t);
      },
    }),
    [getToken],
  );
}

export { ApiError };
