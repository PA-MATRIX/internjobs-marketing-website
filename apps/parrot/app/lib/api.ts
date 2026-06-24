// v1.2 Phase 10 Wave 1: Parrot client-side API helpers.
//
// Thin fetch wrapper that sends credentials and, when Clerk has finished
// loading, a fresh Bearer token. Cookies are still included for direct
// navigations, but API calls should not depend on Clerk's short-lived
// __session cookie being present at exactly the right moment.

declare global {
	interface Window {
		Clerk?: {
			loaded?: boolean;
			session?: {
				getToken: () => Promise<string | null>;
			} | null;
		};
	}
}

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, body: unknown, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getClerkBearerToken(): Promise<string | null> {
	if (typeof window === "undefined") return null;

	for (let i = 0; i < 20; i += 1) {
		const session = window.Clerk?.session;
		if (session?.getToken) {
			return await session.getToken().catch(() => null);
		}
		if (window.Clerk?.loaded) return null;
		await wait(100);
	}

	return null;
}

export async function apiFetch(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const token = await getClerkBearerToken();
	return fetch(path, {
		credentials: "include",
		...init,
		headers: {
			Accept: "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init.body && !(init.body instanceof FormData)
				? { "Content-Type": "application/json" }
				: {}),
			...(init.headers || {}),
		},
	});
}

async function request<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const res = await apiFetch(path, init);

	const contentType = res.headers.get("content-type") || "";
	let body: unknown = null;
	if (contentType.includes("application/json")) {
		body = await res.json().catch(() => null);
	} else {
		body = await res.text().catch(() => "");
	}

	if (!res.ok) {
		let msg: string | null = null;
		if (body && typeof body === "object" && "error" in body) {
			const errField = (body as Record<string, unknown>).error;
			if (typeof errField === "string") msg = errField;
		}
		if (!msg) msg = res.statusText || "Request failed";
		throw new ApiError(res.status, body, msg);
	}
	return body as T;
}

export interface MeResponse {
	employee_id: string;
	email: string;
	display_name: string;
	created_at: string;
	role?: "operator" | "employee";
	/** Phase 13 Wave 3: NULL until the onboarding wizard is completed. */
	onboarded_at: string | null;
}

export interface InboxMessage {
	id: string;
	subject: string | null;
	sender: string | null;
	recipient: string | null;
	date: string | null;
	read: boolean;
	starred: boolean;
	snippet?: string;
	thread_id?: string | null;
	folder_id?: string;
}

// v1.3.1 BACKFILL: attachment metadata shape returned by getMessage.
// Mirrors apps/parrot/workers/lib/schemas.ts::AttachmentInfo.
export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export interface InboxListResponse {
	emails: InboxMessage[];
	totalCount: number;
	folder: string;
}

// PARROT-FOLDER-COUNTS-01: total message count per folder (sidebar badges).
export interface FolderCounts {
	inbox: number;
	sent: number;
	draft: number;
	archive: number;
	trash: number;
	starred: number;
}

// — Phase 13 Wave 1: notifications + push.
export interface NotificationItem {
	id: string;
	event_type: "urgent_todo" | "starred_email" | "chat_mention";
	title: string;
	body: string | null;
	url: string | null;
	read: number;
	created_at: string;
}

export interface NotificationsResponse {
	notifications: NotificationItem[];
	unread: number;
}

export const api = {
	getMe: () => request<MeResponse>("/api/me"),
	getHealth: () => request<{ ok: boolean; service: string }>("/api/health"),
	listInbox: (folder = "inbox") =>
		request<InboxListResponse>(
			`/api/inbox/messages?folder=${encodeURIComponent(folder)}`,
		),
	// PARROT-FOLDER-COUNTS-01: total message count per folder for the
	// sidebar badges.
	getFolderCounts: () => request<FolderCounts>("/api/inbox/folder-counts"),
	// Phase 31 gap-fix: full-mailbox email search for the global header search
	// when the user is on the Email pane.
	searchEmails: (query: string) =>
		request<{ results: InboxMessage[] }>(
			`/api/inbox/search?q=${encodeURIComponent(query)}`,
		),
	getMessage: (id: string) =>
		request<InboxMessage & { body?: string; attachments?: Attachment[] }>(
			`/api/inbox/messages/${encodeURIComponent(id)}`,
		),
	// STAR-API-01: toggle the starred/read flags on a single message.
	patchMessage: (id: string, patch: { starred?: boolean; read?: boolean }) =>
		request<{ id: string; starred: boolean; read: boolean }>(
			`/api/inbox/messages/${encodeURIComponent(id)}`,
			{ method: "PATCH", body: JSON.stringify(patch) },
		),
	// PARROT-FOLDER-ACTIONS-01: move message to target folder.
	moveMessage: (id: string, folder: string) =>
		request<{ ok: boolean; id: string; folder: string }>(
			`/api/inbox/messages/${encodeURIComponent(id)}/move`,
			{ method: "POST", body: JSON.stringify({ folder }) },
		),
	// PARROT-FOLDER-ACTIONS-01: two-stage delete.
	// Server returns { movedToTrash: true } or { hardDeleted: true }.
	deleteMessage: (id: string) =>
		request<{
			ok: boolean;
			id: string;
			movedToTrash?: boolean;
			hardDeleted?: boolean;
		}>(`/api/inbox/messages/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),
	// v1.3.1 BACKFILL: sendEmail / replyEmail / forwardEmail.
	//
	// All three hit the real reply-forward.ts route handlers (no longer
	// 501 stubs). The request body shape matches
	// apps/parrot/workers/lib/schemas.ts::SendEmailRequestSchema. The
	// server overrides 'from' with the authenticated employee's email,
	// so the client never sets it.
	sendEmail: (input: {
		to: string | string[];
		cc?: string | string[];
		bcc?: string | string[];
		subject: string;
		html?: string;
		text?: string;
	}) =>
		request<{ id: string; status: string }>("/api/inbox/send", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	replyEmail: (
		originalId: string,
		input: {
			to: string | string[];
			cc?: string | string[];
			bcc?: string | string[];
			subject: string;
			html?: string;
			text?: string;
		},
	) =>
		request<{ id: string; status: string }>(
			`/api/inbox/messages/${encodeURIComponent(originalId)}/reply`,
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		),
	forwardEmail: (
		originalId: string,
		input: {
			to: string | string[];
			cc?: string | string[];
			bcc?: string | string[];
			subject: string;
			html?: string;
			text?: string;
		},
	) =>
		request<{ id: string; status: string }>(
			`/api/inbox/messages/${encodeURIComponent(originalId)}/forward`,
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		),
	createMeeting: () =>
		request<{ url: string; token: string; note?: string }>(
			"/api/meetings/create",
			{ method: "POST" },
		),
	// — Phase 11 Wave 2: Daily.co Meetings pane helpers.
	ensurePersonalRoom: () =>
		request<{ ok: boolean; url?: string; name?: string; error?: string }>(
			"/api/meetings/ensure-room",
			{ method: "POST" },
		),
	getMyRoom: () =>
		request<{ ok: boolean; url?: string; name?: string; error?: string }>(
			"/api/meetings/my-room",
		),
	getRoomToken: () =>
		request<{ ok: boolean; token?: string; error?: string }>(
			"/api/meetings/room-token",
		),
	getActiveRooms: () =>
		request<{ rooms: Array<{ name: string; url: string }> }>(
			"/api/meetings/active",
		),
	// Updated Phase 13 Wave 2: crosspaneEmailToChat now takes emailId;
	// crosspaneChatToEmail takes postId + postBody; crosspaneStartMeeting
	// remains parameterless (UI seam for Phase 11 / Daily.co).
	crosspaneEmailToChat: (emailId: string) =>
		request<{
			ok: boolean;
			channel_url?: string;
			channel_id?: string;
			reason?: string;
		}>("/api/crosspane/email-to-chat", {
			method: "POST",
			body: JSON.stringify({ email_id: emailId }),
		}),
	crosspaneChatToEmail: (postId: string, postBody: string) =>
		request<{
			ok: boolean;
			draft?: { to: string; subject: string; body: string };
			reason?: string;
		}>("/api/crosspane/chat-to-email", {
			method: "POST",
			body: JSON.stringify({ post_id: postId, post_body: postBody }),
		}),
	// Phase 11 Wave 3: start-meeting now returns the Daily.co room URL on
	// success. When DAILY_API_KEY is absent the server still returns 200 OK
	// with reason:'meetings_coming_soon' (Phase 13 toast fallback path).
	crosspaneStartMeeting: () =>
		request<{
			ok: boolean;
			url?: string; // present when a Daily.co room was created
			name?: string;
			reason?: string; // 'meetings_coming_soon' in fallback path
			message?: string;
		}>("/api/crosspane/start-meeting", { method: "POST" }),
	// — Phase 13 Wave 1: notifications + push.
	getNotifications: (limit = 20) =>
		request<NotificationsResponse>(`/api/notifications?limit=${limit}`),
	markNotificationsRead: (ids?: string[]) =>
		request<{ ok: boolean }>("/api/notifications/mark-read", {
			method: "POST",
			body: JSON.stringify({ ids }),
		}),
	// Phase 31 gap-fix: discard notifications from the drawer. No ids ⇒ clear all.
	clearNotifications: (ids?: string[]) =>
		request<{ ok: boolean }>("/api/notifications", {
			method: "DELETE",
			body: JSON.stringify({ ids }),
		}),
	subscribePush: (subscription: PushSubscription) => {
		const json = subscription.toJSON();
		return request<{ ok: boolean }>("/api/push/subscribe", {
			method: "POST",
			body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
		});
	},
	unsubscribePush: (endpoint: string) =>
		request<{ ok: boolean }>("/api/push/subscribe", {
			method: "DELETE",
			body: JSON.stringify({ endpoint }),
		}),
	// — Phase 13 Wave 3: feature flags + onboarding wizard.
	getFeatureFlags: () =>
		request<{ flags: Record<string, boolean> }>("/api/feature-flags"),
	completeOnboarding: (input: {
		display_name?: string;
		push_enabled?: boolean;
	}) =>
		request<{ ok: boolean }>("/api/onboarding/complete", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	// — v1.3.1 Agent Lift: /api/inbox/agent/* endpoints.
	agentTools: () =>
		request<{ tools: Array<{ name: string; description: string }> }>(
			"/api/inbox/agent/tools",
		),
	agentSummarize: (emailId: string) =>
		request<{ summary?: string; error?: string; blocked?: boolean }>(
			"/api/inbox/agent/summarize",
			{ method: "POST", body: JSON.stringify({ email_id: emailId }) },
		),
	agentExtractActions: (emailId: string) =>
		request<{ actions?: string[]; error?: string; blocked?: boolean }>(
			"/api/inbox/agent/extract-actions",
			{ method: "POST", body: JSON.stringify({ email_id: emailId }) },
		),
	agentTranslate: (emailId: string, targetLanguage?: string) =>
		request<{ translation?: string; error?: string }>(
			"/api/inbox/agent/translate",
			{
				method: "POST",
				body: JSON.stringify({
					email_id: emailId,
					target_language: targetLanguage,
				}),
			},
		),
	agentDraftReply: (
		emailId: string,
		instructions?: string,
		save: boolean = false,
	) =>
		request<{
			draft_text?: string;
			draft_id?: string;
			error?: string;
			blocked?: boolean;
		}>("/api/inbox/agent/draft-reply", {
			method: "POST",
			body: JSON.stringify({
				email_id: emailId,
				instructions,
				save,
			}),
		}),
	agentChat: (
		messages: Array<{ role: "user" | "assistant"; content: string }>,
		emailId?: string,
	) =>
		request<{ reply?: string; error?: string }>("/api/inbox/agent/chat", {
			method: "POST",
			body: JSON.stringify({
				email_id: emailId,
				messages,
			}),
		}),
	agentConversation: (emailId: string) =>
		request<{ suggested_prompts: string[]; error?: string }>(
			`/api/inbox/agent/conversation/${encodeURIComponent(emailId)}`,
		),
};
