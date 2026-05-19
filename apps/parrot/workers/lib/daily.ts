// v1.2 Phase 11 Wave 1: Daily.co REST client (server-side only).
//
// Skills referenced:
//   cloudflare/skills: durable-objects — per-employee room ownership.
//     Each EmployeeMailboxDO owns ONE personal Daily.co room
//     (parrot-<clerk_user_id>) provisioned lazily on first call.
//   cloudflare/skills: cloudflare — Workers fetch() to Daily.co REST API.
//
// Design posture (mirrors workers/lib/vapid.ts + the inline Sentry envelope
// in workers/index.ts): NO npm dependency. The Daily.co JS SDK is a
// browser-side concern and lands in Wave 2 where the React component
// embeds it. The Worker only needs four narrow REST calls — POST /rooms,
// GET /rooms/:name, DELETE /rooms/:name, POST /meeting-tokens — which a
// single `dailyFetch()` helper handles in ~30 lines.
//
// Fail-soft contract:
//   - When DAILY_API_KEY is undefined/empty, EVERY function returns null
//     without making a network call. Callers MUST treat null as
//     "room provisioning unavailable" and degrade gracefully (Phase 13
//     toast path) rather than throwing.
//   - On non-2xx responses, we log via console.error and ALSO return null.
//     This way runtime crashes from a Daily.co outage never bubble into
//     the Worker — same posture as VAPID/Sentry.

const DAILY_BASE = "https://api.daily.co/v1";

export interface DailyRoom {
	id: string;
	name: string;
	url: string;
	privacy: "public" | "private";
	created_at: string;
}

export interface DailyMeetingToken {
	token: string;
}

/**
 * Single network choke point for every Daily.co call. Returns:
 *   - `null` when apiKey is absent OR the response is non-2xx
 *     (already logged via console.error in the latter case).
 *   - parsed JSON typed as T on success.
 *
 * NEVER throws — see fail-soft contract above.
 */
async function dailyFetch<T>(
	apiKey: string | undefined,
	path: string,
	init?: RequestInit,
): Promise<T | null> {
	if (!apiKey) {
		// Fail-soft: callers handle null as "provisioning unavailable".
		return null;
	}
	try {
		const res = await fetch(`${DAILY_BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			console.error("daily.co", res.status, path, text.slice(0, 200));
			return null;
		}
		// DELETE returns 200 with `{ deleted: true, name: "..." }` JSON,
		// so we can JSON-parse uniformly across verbs.
		return (await res.json()) as T;
	} catch (err) {
		console.error("daily.co fetch error", path, err);
		return null;
	}
}

/**
 * Create a Daily.co room. Defaults to `privacy: "private"` so only
 * meeting-token holders can join.
 *
 * @param options.exp Optional Unix-seconds expiry. When omitted the room
 *                    is always-on (personal-room use case). When provided
 *                    (one-off ad-hoc rooms) Daily.co auto-expires it.
 * @returns Room metadata or null on failure / missing key.
 */
export async function createRoom(
	apiKey: string | undefined,
	name: string,
	options?: { exp?: number },
): Promise<DailyRoom | null> {
	const properties: Record<string, unknown> = {};
	if (options?.exp !== undefined) {
		properties.exp = options.exp;
	}
	return dailyFetch<DailyRoom>(apiKey, "/rooms", {
		method: "POST",
		body: JSON.stringify({
			name,
			privacy: "private",
			properties,
		}),
	});
}

/**
 * Fetch a room by name (the slug, not the full URL). Useful for
 * idempotency probes — if getRoom returns non-null we know createRoom
 * would 409. Returns null on 404 (and any other error).
 */
export async function getRoom(
	apiKey: string | undefined,
	name: string,
): Promise<DailyRoom | null> {
	return dailyFetch<DailyRoom>(
		apiKey,
		`/rooms/${encodeURIComponent(name)}`,
		{ method: "GET" },
	);
}

/**
 * Delete a room by name. Used by the smoke endpoint to clean up after
 * itself; production code does NOT delete personal rooms.
 *
 * Returns `{ deleted: true }` on success, null on failure.
 */
export async function deleteRoom(
	apiKey: string | undefined,
	name: string,
): Promise<{ deleted: true } | null> {
	const res = await dailyFetch<{ deleted: boolean; name?: string }>(
		apiKey,
		`/rooms/${encodeURIComponent(name)}`,
		{ method: "DELETE" },
	);
	if (!res || res.deleted !== true) return null;
	return { deleted: true };
}

/**
 * Mint a per-user meeting token for a given room. Tokens encode the
 * user's identity + owner flag, so we can distinguish the employee
 * (is_owner: true → can mute/eject) from external guests
 * (is_owner: false).
 *
 * @param options.is_owner true grants moderator privileges in the room.
 * @param options.user_name Display name shown in the participant tray.
 * @param options.exp Optional Unix-seconds expiry for the token itself
 *                    (separate from the room's expiry).
 */
export async function getMeetingToken(
	apiKey: string | undefined,
	roomName: string,
	options: { is_owner: boolean; user_name?: string; exp?: number },
): Promise<DailyMeetingToken | null> {
	const properties: Record<string, unknown> = {
		room_name: roomName,
		is_owner: options.is_owner,
	};
	if (options.user_name !== undefined) {
		properties.user_name = options.user_name;
	}
	if (options.exp !== undefined) {
		properties.exp = options.exp;
	}
	return dailyFetch<DailyMeetingToken>(apiKey, "/meeting-tokens", {
		method: "POST",
		body: JSON.stringify({ properties }),
	});
}
