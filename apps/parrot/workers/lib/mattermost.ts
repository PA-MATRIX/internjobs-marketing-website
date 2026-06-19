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

// Exported (Phase 31 Wave 0) so the WS proxy (Wave 4) and mmFetchAsUser can
// reuse the raw fetch wrapper. The second arg is "any bearer token" — bot
// token, admin token, or a per-user PAT — not strictly the bot token anymore.
export async function mmFetch<T>(
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

/**
 * Derive a valid Mattermost username from an email local-part.
 * MM usernames must be 3–22 chars, start with a letter, and contain only
 * lowercase letters, numbers, '.', '-', '_'.
 */
function deriveMmUsername(email: string): string {
	const local = (email.split("@")[0] ?? "user").toLowerCase();
	let username = local.replace(/[^a-z0-9._-]/g, "");
	if (!/^[a-z]/.test(username)) username = `u${username}`;
	username = username.slice(0, 22);
	if (username.length < 3) username = `${username}user`.slice(0, 22);
	return username;
}

/**
 * Create a Mattermost account for an employee that doesn't have one yet.
 *
 * Employees sign into Workspace via Clerk (phone-OTP) and reach chat only
 * through the bot-proxied /api/chat/* surface — they never log into
 * Mattermost directly — so this is a "shadow" identity used for message
 * attribution and team/channel membership. The password is random and
 * unused. The account is keyed by the employee's @internjobs.ai email, so a
 * later SSO login (OIDC bridge) links to it by email. Returns null if
 * creation fails; on a lost create race we re-resolve the existing user by
 * email rather than surface a spurious failure.
 */
export async function createMmUser(
	mattermostUrl: string,
	botToken: string,
	profile: {
		email: string;
		displayName?: string;
		givenName?: string;
		familyName?: string;
	},
): Promise<MattermostUser | null> {
	const created = await mmFetch<MattermostUser>(
		mattermostUrl,
		botToken,
		"/api/v4/users",
		{
			method: "POST",
			body: JSON.stringify({
				email: profile.email,
				username: deriveMmUsername(profile.email),
				password: `Aa1!${crypto.randomUUID()}${crypto.randomUUID()}`,
				first_name: profile.givenName ?? "",
				last_name: profile.familyName ?? "",
				nickname: profile.displayName ?? "",
			}),
		},
	);
	if (created.ok) return created.data;
	// Lost a create race (email/username already taken) — re-resolve by email.
	return await getMmUserByEmail(mattermostUrl, botToken, profile.email);
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
	profile?: { displayName?: string; givenName?: string; familyName?: string },
	adminToken?: string,
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
	let userId = await resolveMmUserId(mattermostUrl, botToken, email);
	if (!userId) {
		// Auto-provision: the employee exists in Clerk but not yet in
		// Mattermost. Create the shadow MM account so native chat works without
		// manual setup. User creation REQUIRES a system-admin USER token — the
		// bot token is barred from POST /api/v4/users — so prefer adminToken
		// and only fall back to botToken (which will fail) when it's unset.
		const created = await createMmUser(
			mattermostUrl,
			adminToken || botToken,
			{ email, ...profile },
		);
		userId = created?.id ?? null;
	}
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

// ── Phase 31 Wave 0: per-employee Mattermost PAT identity ───────────
//
// Until now every chat REST call went through a single bot identity
// (MATTERMOST_BOT_TOKEN) with `parrot_author_*` props as a human-attribution
// workaround. These helpers let the Worker mint + use a personal access token
// (PAT) per employee so human messages are authored by the real MM user.

/**
 * Mint a Mattermost personal access token (PAT) for a specific MM user using
 * the system-admin token. Returns the raw token string, or null on failure.
 *
 * IMPORTANT: requires MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true on the
 * Mattermost server (set on the internjobs-mattermost Fly app in Wave 5 /
 * plan 31-06; for local dev enable it in your local MM config). Without it MM
 * returns 501 with id "api.user.create_user_access_token.disabled.app_error"
 * and this returns null — do NOT run the production backfill until 31-06
 * Task 1 confirms the Fly secret is present.
 */
export async function mintMmUserToken(
	mattermostUrl: string,
	adminToken: string,
	mmUserId: string,
): Promise<string | null> {
	const resp = await mmFetch<{ token: string }>(
		mattermostUrl,
		adminToken,
		`/api/v4/users/${mmUserId}/tokens`,
		{ method: "POST", body: JSON.stringify({ description: "parrot-workspace" }) },
	);
	return resp.ok ? resp.data.token : null;
}

/**
 * Proxy a Mattermost REST call AS the employee using their stored PAT.
 *
 * Token resolution is injected (getToken/setToken) so this file stays free of
 * any Durable Object coupling — the caller wires it to WorkspaceDO.
 * getEmployeeToken / setEmployeeToken.
 *
 * 401 handling: a PAT may have been revoked by an MM admin. On a 401 we
 * re-mint via the admin token, persist the new PAT (setToken), and retry once.
 */
export async function mmFetchAsUser<T>(
	mattermostUrl: string,
	adminToken: string,
	path: string,
	init: RequestInit,
	getToken: () => Promise<{ mmUserId: string; token: string } | null>,
	setToken: (mmUserId: string, token: string) => Promise<void>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; data: unknown }> {
	const tokenRow = await getToken();
	if (!tokenRow) return { ok: false, status: 503, data: { error: "chat_not_provisioned" } };

	let result = await mmFetch<T>(mattermostUrl, tokenRow.token, path, init);

	// 401-triggered re-mint: PAT may have been revoked by an MM admin.
	if (!result.ok && result.status === 401) {
		const newToken = await mintMmUserToken(mattermostUrl, adminToken, tokenRow.mmUserId);
		if (newToken) {
			await setToken(tokenRow.mmUserId, newToken);
			result = await mmFetch<T>(mattermostUrl, newToken, path, init);
		}
	}

	return result;
}
