// apps/startup/workers/lib/resolveChannelLink.ts
// v1.4 Phase 29-01 — Channel-link identity resolver.
//
// Generic helper used by inbound webhook handlers (Phase 29-01 telnyx-sms,
// Phase 29-02 telnyx-voice) to map an external_id (phone number, voice
// participant id, slack workspace, ...) to its owning (startup_id, member_id,
// startup_name) via the Fly proxy's GET /v1/channel-links/resolve endpoint.
//
// Return contract:
//   - 200 hit       → StartupContext { startup_id, member_id, startup_name }
//   - 404 / non-2xx → null  (caller decides — typically routes to invite path)
//   - network/exc   → null  (NEVER throws; webhook handlers cannot 500)

import type { Env, StartupContext } from "../types";

export async function resolveChannelLink(
	env: Env,
	channelType: string,
	externalId: string,
): Promise<StartupContext | null> {
	if (!env.STARTUP_API_URL || !env.STARTUP_API_SECRET) return null;
	if (!channelType || !externalId) return null;

	const base = env.STARTUP_API_URL.replace(/\/$/, "");
	const url =
		`${base}/v1/channel-links/resolve` +
		`?channel_type=${encodeURIComponent(channelType)}` +
		`&external_id=${encodeURIComponent(externalId)}`;

	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return null;
		const row = (await res.json().catch(() => null)) as
			| (StartupContext & { channel_link_id?: string })
			| null;
		if (!row?.startup_id || !row?.member_id) return null;
		return {
			startup_id: row.startup_id,
			member_id: row.member_id,
			startup_name: row.startup_name,
			// channel_link_id was added to the Fly /v1/channel-links/resolve response
			// in Phase 29-03 — older deployments may not populate it. Tolerate
			// undefined so the opt-in "yes" fast-path can no-op gracefully.
			channel_link_id: row.channel_link_id,
		};
	} catch {
		return null;
	}
}
