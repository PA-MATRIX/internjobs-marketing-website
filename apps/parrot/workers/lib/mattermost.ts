// v1.2 Phase 12 Wave 2: Mattermost REST API helpers for chat ingest.
//
// Auth: Bearer token from env.MATTERMOST_BOT_TOKEN (System Admin bot account).
// Bot must be granted System Admin role in Mattermost System Console so it can
// read private channels and DMs.
//
// Known edge case (mattermost/mattermost#13846): `since` can miss posts under
// very high write load. Mitigation: subtract 5000ms from the watermark so we
// overlap by 5 seconds. Deduplication is handled by INSERT OR IGNORE on source_id.
//
// User-id resolution risk: employees who have never SSO'd into Mattermost won't
// have an MM account. GET /api/v4/users/email/{email} returns 404 in that case.
// We store MM_USER_ID_NONE sentinel in DO storage and retry on each alarm cycle.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)

export interface MattermostPost {
	id: string;
	channel_id: string;
	user_id: string;
	message: string;
	create_at: number; // unix ms
}

export const MM_USER_ID_NONE = "__not_found__";

/** Resolve a Mattermost user_id by email address. Returns null if not found. */
export async function resolveMmUserId(
	mattermostUrl: string,
	botToken: string,
	email: string,
): Promise<string | null> {
	try {
		const resp = await fetch(
			`${mattermostUrl}/api/v4/users/email/${encodeURIComponent(email)}`,
			{ headers: { Authorization: `Bearer ${botToken}` } },
		);
		if (resp.status === 404) return null;
		if (!resp.ok) return null;
		const user = (await resp.json()) as { id?: string };
		return user?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Return channel IDs the given MM user is a member of.
 * Uses the bot's system-admin access to list all channels
 * and filter by membership. For v1.2 we poll ALL channels the bot
 * can see and filter locally — simpler than per-user channel membership
 * endpoint which requires per-channel calls.
 */
export async function getMmChannelsForUser(
	mattermostUrl: string,
	botToken: string,
	mmUserId: string,
): Promise<string[]> {
	try {
		const resp = await fetch(
			`${mattermostUrl}/api/v4/users/${mmUserId}/teams`,
			{ headers: { Authorization: `Bearer ${botToken}` } },
		);
		if (!resp.ok) return [];
		const teams = (await resp.json()) as Array<{ id: string }>;

		const channelIds: string[] = [];
		for (const team of teams) {
			const chResp = await fetch(
				`${mattermostUrl}/api/v4/users/${mmUserId}/teams/${team.id}/channels`,
				{ headers: { Authorization: `Bearer ${botToken}` } },
			);
			if (!chResp.ok) continue;
			const channels = (await chResp.json()) as Array<{ id: string }>;
			channelIds.push(...channels.map((ch) => ch.id));
		}
		return channelIds;
	} catch {
		return [];
	}
}

/** Fetch posts in a channel since a given unix millisecond timestamp. */
export async function getMmPostsSince(
	mattermostUrl: string,
	botToken: string,
	channelId: string,
	sinceMs: number,
): Promise<MattermostPost[]> {
	try {
		// Subtract 5s overlap to guard against the mattermost#13846 edge case.
		const url = `${mattermostUrl}/api/v4/channels/${channelId}/posts?since=${sinceMs - 5000}`;
		const resp = await fetch(url, {
			headers: { Authorization: `Bearer ${botToken}` },
		});
		if (!resp.ok) return [];
		const data = (await resp.json()) as {
			posts?: Record<string, MattermostPost>;
		};
		return Object.values(data.posts ?? {});
	} catch {
		return [];
	}
}
