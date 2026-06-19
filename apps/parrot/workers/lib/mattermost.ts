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

// ── Phase 31 Wave 1 (plan 31-02): channel CRUD + thread ops ─────────
//
// All of these take a bearer token directly. The Worker routes pass the
// employee's own PAT (via mmFetchAsUser) so channel creates/joins, post
// edits/deletes/pins, and thread replies are authored AS the real MM user —
// reusing the Wave 0 identity rather than the parrot bot.

/**
 * Create a Mattermost channel. type "O" = public (any employee), "P" =
 * private (operator-only, gated in the route). Returns the channel or null.
 */
export async function createMmChannel(
	mattermostUrl: string,
	token: string,
	teamId: string,
	name: string,
	displayName: string,
	type: "O" | "P",
): Promise<MattermostChannel | null> {
	const resp = await mmFetch<MattermostChannel>(
		mattermostUrl,
		token,
		"/api/v4/channels",
		{
			method: "POST",
			body: JSON.stringify({
				team_id: teamId,
				name,
				display_name: displayName,
				type,
			}),
		},
	);
	return resp.ok ? resp.data : null;
}

/**
 * Add the given user to a channel (the employee joins themselves). MM returns
 * 201 on success and 400 if already a member — both are treated as success.
 */
export async function joinMmChannel(
	mattermostUrl: string,
	token: string,
	channelId: string,
	userId: string,
): Promise<boolean> {
	const resp = await mmFetch<unknown>(
		mattermostUrl,
		token,
		`/api/v4/channels/${channelId}/members`,
		{ method: "POST", body: JSON.stringify({ user_id: userId }) },
	);
	return resp.ok || resp.status === 400;
}

/** Edit a post's message. Returns the updated post or null. */
export async function editMmPost(
	mattermostUrl: string,
	token: string,
	postId: string,
	message: string,
): Promise<MattermostPost | null> {
	const resp = await mmFetch<MattermostPost>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}`,
		{ method: "PUT", body: JSON.stringify({ id: postId, message }) },
	);
	return resp.ok ? resp.data : null;
}

/** Delete a post. Returns true on success. */
export async function deleteMmPost(
	mattermostUrl: string,
	token: string,
	postId: string,
): Promise<boolean> {
	const resp = await mmFetch<unknown>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}`,
		{ method: "DELETE" },
	);
	return resp.ok;
}

/** Pin a post to its channel. Returns true on success. */
export async function pinMmPost(
	mattermostUrl: string,
	token: string,
	postId: string,
): Promise<boolean> {
	// MM v4 pins via the post resource: POST /api/v4/posts/{id}/pin.
	const resp = await mmFetch<unknown>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}/pin`,
		{ method: "POST" },
	);
	return resp.ok;
}

/** Fetch the full thread (root + replies) for a post. */
export async function getMmPostThread(
	mattermostUrl: string,
	token: string,
	postId: string,
): Promise<MattermostPostList | null> {
	const resp = await mmFetch<MattermostPostList>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}/thread`,
	);
	return resp.ok ? resp.data : null;
}

/** Fetch a single post (used to verify authorship before edit/delete). */
export async function getMmPost(
	mattermostUrl: string,
	token: string,
	postId: string,
): Promise<MattermostPost | null> {
	const resp = await mmFetch<MattermostPost>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}`,
	);
	return resp.ok ? resp.data : null;
}

/**
 * List the public channels of a team using the EMPLOYEE's PAT (not the bot),
 * so the response reflects the user's own visibility/membership state. MM
 * returns only channels the requesting user can see for a non-admin token.
 */
export async function getMmTeamPublicChannels(
	mattermostUrl: string,
	token: string,
	teamId: string,
	page = 0,
	perPage = 100,
): Promise<MattermostChannel[]> {
	const resp = await mmFetch<MattermostChannel[]>(
		mattermostUrl,
		token,
		`/api/v4/teams/${teamId}/channels?page=${page}&per_page=${perPage}`,
	);
	return resp.ok ? resp.data : [];
}

// ── Phase 31 Wave 2 (plan 31-03): DMs + group DMs ───────────────────
//
// Mattermost DMs are channels of type "D" (direct, exactly 2 users) and "G"
// (group, 3–8 users). Creating/opening one is idempotent — MM returns the
// existing channel if it already exists (Pattern 4 from 31-RESEARCH). All of
// these take a bearer token directly; the Worker routes pass the employee's
// own PAT (via mmFetchAsUser) so the DM belongs to the real MM user.

/**
 * Open (or create) a direct message channel between exactly two users.
 * MM POST /api/v4/channels/direct with body [userId1, userId2]. One of the
 * two IDs must be the requesting user's own MM user_id. Idempotent — returns
 * the existing "D" channel if it already exists. Returns null on failure.
 */
export async function createMmDirectChannel(
	mattermostUrl: string,
	token: string,
	userIds: [string, string],
): Promise<MattermostChannel | null> {
	const resp = await mmFetch<MattermostChannel>(
		mattermostUrl,
		token,
		"/api/v4/channels/direct",
		{ method: "POST", body: JSON.stringify(userIds) },
	);
	return resp.ok ? resp.data : null;
}

/**
 * Open (or create) a group DM channel for the given users. MM POST
 * /api/v4/channels/group with body [...userIds]. MM requires at least 3 user
 * IDs (the creator + 2 others) and at most 8. Idempotent — returns the
 * existing "G" channel if the same set already exists. Returns null on failure.
 */
export async function createMmGroupChannel(
	mattermostUrl: string,
	token: string,
	userIds: string[],
): Promise<MattermostChannel | null> {
	const resp = await mmFetch<MattermostChannel>(
		mattermostUrl,
		token,
		"/api/v4/channels/group",
		{ method: "POST", body: JSON.stringify(userIds) },
	);
	return resp.ok ? resp.data : null;
}

/**
 * List the requesting user's DM channels (type "D" and "G"). MM GET
 * /api/v4/users/me/channels returns ALL channels the token user is a member
 * of across teams; we filter client-side to the DM types. Returns [] on
 * failure.
 */
export async function getMmMyDirectChannels(
	mattermostUrl: string,
	token: string,
): Promise<MattermostChannel[]> {
	const resp = await mmFetch<MattermostChannel[]>(
		mattermostUrl,
		token,
		"/api/v4/users/me/channels?include_deleted=false",
	);
	if (!resp.ok) return [];
	return resp.data.filter(
		(channel) => channel.type === "D" || channel.type === "G",
	);
}

// ── Phase 31 Wave 3 (plan 31-04): search + reactions ────────────────
//
// All of these take a bearer token directly. The Worker routes pass the
// employee's own PAT (via mmFetchAsUser) so search results reflect the
// employee's own channel visibility and reactions are attributed to the
// real MM user — reusing the Wave 0 identity rather than the parrot bot.

export interface MattermostReaction {
	user_id: string;
	post_id: string;
	emoji_name: string;
	create_at?: number;
}

/**
 * Full-text search posts across the employee's visible channels in a team.
 * MM POST /api/v4/teams/{teamId}/posts/search. `isOrSearch=false` (default)
 * means terms are AND'd. Returns the post list (posts map + order) or null.
 */
export async function searchMmPosts(
	mattermostUrl: string,
	token: string,
	teamId: string,
	terms: string,
	isOrSearch = false,
): Promise<MattermostPostList | null> {
	const resp = await mmFetch<MattermostPostList>(
		mattermostUrl,
		token,
		`/api/v4/teams/${teamId}/posts/search`,
		{
			method: "POST",
			body: JSON.stringify({ terms, is_or_search: isOrSearch }),
		},
	);
	return resp.ok ? resp.data : null;
}

/**
 * Add an emoji reaction to a post AS the given user. MM POST
 * /api/v4/reactions. `create_at: 0` lets MM stamp the time. Returns true on
 * 200/201 (already-reacted also returns 200). emojiName is the MM short name
 * (e.g. "thumbsup"), NOT the unicode glyph.
 */
export async function addMmReaction(
	mattermostUrl: string,
	token: string,
	userId: string,
	postId: string,
	emojiName: string,
): Promise<boolean> {
	const resp = await mmFetch<MattermostReaction>(
		mattermostUrl,
		token,
		"/api/v4/reactions",
		{
			method: "POST",
			body: JSON.stringify({
				user_id: userId,
				post_id: postId,
				emoji_name: emojiName,
				create_at: 0,
			}),
		},
	);
	return resp.ok;
}

/**
 * Remove an emoji reaction from a post. MM DELETE
 * /api/v4/users/{userId}/posts/{postId}/reactions/{emojiName}. Returns true
 * on success.
 */
export async function removeMmReaction(
	mattermostUrl: string,
	token: string,
	userId: string,
	postId: string,
	emojiName: string,
): Promise<boolean> {
	const resp = await mmFetch<unknown>(
		mattermostUrl,
		token,
		`/api/v4/users/${userId}/posts/${postId}/reactions/${encodeURIComponent(emojiName)}`,
		{ method: "DELETE" },
	);
	return resp.ok;
}

/**
 * List the reactions on a post. MM GET /api/v4/posts/{postId}/reactions.
 * Returns the reaction array (possibly empty) or null on failure.
 */
export async function getMmPostReactions(
	mattermostUrl: string,
	token: string,
	postId: string,
): Promise<MattermostReaction[] | null> {
	const resp = await mmFetch<MattermostReaction[]>(
		mattermostUrl,
		token,
		`/api/v4/posts/${postId}/reactions`,
	);
	return resp.ok ? resp.data ?? [] : null;
}
