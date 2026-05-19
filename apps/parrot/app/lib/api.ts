// v1.2 Phase 10 Wave 1: Parrot client-side API helpers.
//
// Thin fetch wrapper that always sends credentials (Clerk's __session
// cookie) and serializes JSON. Returns parsed JSON on success and
// throws an ApiError on non-2xx so React Query can route it to the
// retry/onError path.

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

async function request<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const res = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			Accept: "application/json",
			...(init.body && !(init.body instanceof FormData)
				? { "Content-Type": "application/json" }
				: {}),
			...(init.headers || {}),
		},
	});

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

export interface InboxListResponse {
	emails: InboxMessage[];
	totalCount: number;
	folder: string;
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
	getMessage: (id: string) =>
		request<InboxMessage & { body?: string }>(
			`/api/inbox/messages/${encodeURIComponent(id)}`,
		),
	sendEmail: (input: {
		to: string;
		subject: string;
		html?: string;
		text?: string;
	}) =>
		request<{ id: string; status: string; note?: string }>(
			"/api/inbox/send",
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
	crosspaneStartMeeting: () =>
		request<{ ok: boolean; reason: string; message?: string }>(
			"/api/crosspane/start-meeting",
			{ method: "POST" },
		),
	// — Phase 13 Wave 1: notifications + push.
	getNotifications: (limit = 20) =>
		request<NotificationsResponse>(`/api/notifications?limit=${limit}`),
	markNotificationsRead: (ids?: string[]) =>
		request<{ ok: boolean }>("/api/notifications/mark-read", {
			method: "POST",
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
};
