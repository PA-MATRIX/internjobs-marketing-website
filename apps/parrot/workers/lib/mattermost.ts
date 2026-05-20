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
	props?: Record<string, unknown>;
	root_id?: string;
}

export interface MattermostTeam {
	id: string;
	name: string;
	display_name: string;
	type?: string;
}

export interface MattermostChannel {
	id: string;
	name: string;
	display_name: string;
	team_id: string;
	type?: string;
}

export interface MattermostUser {
	id: string;
	username: string;
	email?: string;
	first_name?: string;
	last_name?: string;
	nickname?: string;
}

export interface MattermostPostList {
	order?: string[];
	posts?: Record<string, MattermostPost>;
}

export const MM_USER_ID_NONE = "__not_found__";
const DEFAULT_TEAM_NAME = "internjobs";
const DEFAULT_TEAM_DISPLAY_NAME = "InternJobs";

async function mmFetch<T>(
	mattermostUrl: string,
	botToken: string,
	path: string,
	init: RequestInit = {},
): Promise<
	{ ok: true; data: T } | { ok: false; status: number; data: unknown }
> {
	const resp = await fetch(`${mattermostUrl.replace(/\/$/, "")}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${botToken}`,
			Accept: "application/json",
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...(init.headers ?? {}),
		},
	});
	const data = await resp.json().catch(() => null);
	if (!resp.ok) return { ok: false, status: resp.status, data };
	return { ok: true, data: data as T };
}

/** Resolve a Mattermost user_id by email address. Returns null if not found. */
export async function resolveMmUserId(
	mattermostUrl: string,
	botToken: string,
	email: string,
): Promise<string | null> {
	const user = await getMmUserByEmail(mattermostUrl, botToken, email);
	return user?.id ?? null;
}

/** Resolve a Mattermost user by email address. Returns null if not found. */
export async function getMmUserByEmail(
	mattermostUrl: string,
	botToken: string,
	email: string,
): Promise<MattermostUser | null> {
	try {
		const resp = await mmFetch<MattermostUser>(
			mattermostUrl,
			botToken,
			`/api/v4/users/email/${encodeURIComponent(email)}`,
		);
		if (!resp.ok) return null;
		return resp.data ?? null;
	} catch {
		return null;
	}
}

async function getOrCreateTeam(
	mattermostUrl: string,
	botToken: string,
): Promise<MattermostTeam | null> {
	const existing = await mmFetch<MattermostTeam>(
		mattermostUrl,
		botToken,
		`/api/v4/teams/name/${DEFAULT_TEAM_NAME}`,
	);
	if (existing.ok) return existing.data;
	if (existing.status !== 404) return null;
	const created = await mmFetch<MattermostTeam>(
		mattermostUrl,
		botToken,
		"/api/v4/teams",
		{
			method: "POST",
			body: JSON.stringify({
				name: DEFAULT_TEAM_NAME,
				display_name: DEFAULT_TEAM_DISPLAY_NAME,
				type: "O",
			}),
		},
	);
	return created.ok ? created.data : null;
}

async function getDefaultChannel(
	mattermostUrl: string,
	botToken: string,
	teamId: string,
): Promise<MattermostChannel | null> {
	const townSquare = await mmFetch<MattermostChannel>(
		mattermostUrl,
		botToken,
		`/api/v4/teams/${teamId}/channels/name/town-square`,
	);
	if (townSquare.ok) return townSquare.data;
	const channels = await mmFetch<MattermostChannel[]>(
		mattermostUrl,
		botToken,
		`/api/v4/teams/${teamId}/channels`,
	);
	return channels.ok ? (channels.data[0] ?? null) : null;
}

async function isUserOnTeam(
	mattermostUrl: string,
	botToken: string,
	userId: string,
	teamId: string,
): Promise<boolean> {
	const teams = await mmFetch<MattermostTeam[]>(
		mattermostUrl,
		botToken,
		`/api/v4/users/${userId}/teams`,
	);
	return teams.ok && teams.data.some((team) => team.id === teamId);
}

async function addUserToTeam(
	mattermostUrl: string,
	botToken: string,
	userId: string,
	teamId: string,
): Promise<boolean> {
	const added = await mmFetch<unknown>(
		mattermostUrl,
		botToken,
		`/api/v4/teams/${teamId}/members`,
		{
			method: "POST",
			body: JSON.stringify({ team_id: teamId, user_id: userId }),
		},
	);
	return added.ok || added.status === 400;
}

async function addUserToChannel(
	mattermostUrl: string,
	botToken: string,
	userId: string,
	channelId: string,
): Promise<boolean> {
	const added = await mmFetch<unknown>(
		mattermostUrl,
		botToken,
		`/api/v4/channels/${channelId}/members`,
		{
			method: "POST",
			body: JSON.stringify({ user_id: userId }),
		},
	);
	return added.ok || added.status === 400;
}

export async function ensureMmWorkspaceMembership(
	mattermostUrl: string,
	botToken: string,
	email: string,
): Promise<
	| {
			ok: true;
			userId: string;
			team: MattermostTeam;
			channel: MattermostChannel | null;
	  }
	| {
			ok: false;
			reason: "user_not_found" | "team_unavailable" | "membership_failed";
	  }
> {
	const userId = await resolveMmUserId(mattermostUrl, botToken, email);
	if (!userId) return { ok: false, reason: "user_not_found" };
	const team = await getOrCreateTeam(mattermostUrl, botToken);
	if (!team) return { ok: false, reason: "team_unavailable" };
	if (!(await isUserOnTeam(mattermostUrl, botToken, userId, team.id))) {
		const joined = await addUserToTeam(mattermostUrl, botToken, userId, team.id);
		if (!joined) return { ok: false, reason: "membership_failed" };
	}
	const channel = await getDefaultChannel(mattermostUrl, botToken, team.id);
	if (channel) await addUserToChannel(mattermostUrl, botToken, userId, channel.id);
	return { ok: true, userId, team, channel };
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

/** Return teams the given MM user is a member of. */
export async function getMmTeamsForUser(
	mattermostUrl: string,
	botToken: string,
	mmUserId: string,
): Promise<MattermostTeam[]> {
	try {
		const resp = await mmFetch<MattermostTeam[]>(
			mattermostUrl,
			botToken,
			`/api/v4/users/${mmUserId}/teams`,
		);
		return resp.ok ? resp.data : [];
	} catch {
		return [];
	}
}

/** Return channels visible to the given MM user inside a team. */
export async function getMmTeamChannelsForUser(
	mattermostUrl: string,
	botToken: string,
	mmUserId: string,
	teamId: string,
): Promise<MattermostChannel[]> {
	try {
		const resp = await mmFetch<MattermostChannel[]>(
			mattermostUrl,
			botToken,
			`/api/v4/users/${mmUserId}/teams/${teamId}/channels`,
		);
		return resp.ok ? resp.data : [];
	} catch {
		return [];
	}
}

/** Return channels inside a team using the internal bot identity. */
export async function getMmTeamChannels(
	mattermostUrl: string,
	botToken: string,
	teamId: string,
): Promise<MattermostChannel[]> {
	try {
		const resp = await mmFetch<MattermostChannel[]>(
			mattermostUrl,
			botToken,
			`/api/v4/teams/${teamId}/channels`,
		);
		return resp.ok ? resp.data : [];
	} catch {
		return [];
	}
}

export async function getMmUsersByIds(
	mattermostUrl: string,
	botToken: string,
	userIds: string[],
): Promise<MattermostUser[]> {
	const ids = [...new Set(userIds.filter(Boolean))].slice(0, 100);
	if (!ids.length) return [];
	try {
		const resp = await mmFetch<MattermostUser[]>(
			mattermostUrl,
			botToken,
			"/api/v4/users/ids",
			{ method: "POST", body: JSON.stringify(ids) },
		);
		return resp.ok ? resp.data : [];
	} catch {
		return [];
	}
}

export async function getMmChannelPosts(
	mattermostUrl: string,
	botToken: string,
	channelId: string,
	page = 0,
	perPage = 50,
): Promise<MattermostPostList | null> {
	try {
		const resp = await mmFetch<MattermostPostList>(
			mattermostUrl,
			botToken,
			`/api/v4/channels/${channelId}/posts?page=${page}&per_page=${perPage}`,
		);
		return resp.ok ? resp.data : null;
	} catch {
		return null;
	}
}

export async function createMmParrotPost(
	mattermostUrl: string,
	botToken: string,
	input: {
		channelId: string;
		message: string;
		authorUserId: string;
		authorName: string;
		authorEmail: string;
	},
): Promise<MattermostPost | null> {
	try {
		const resp = await mmFetch<MattermostPost>(
			mattermostUrl,
			botToken,
			"/api/v4/posts",
			{
				method: "POST",
				body: JSON.stringify({
					channel_id: input.channelId,
					message: input.message,
					props: {
						parrot_author_user_id: input.authorUserId,
						parrot_author_name: input.authorName,
						parrot_author_email: input.authorEmail,
					},
				}),
			},
		);
		return resp.ok ? resp.data : null;
	} catch {
		return null;
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
