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
		const msg =
			(body &&
				typeof body === "object" &&
				"error" in body &&
				typeof (body as Record<string, unknown>).error === "string" &&
				((body as Record<string, unknown>).error as string)) ||
			res.statusText ||
			"Request failed";
		throw new ApiError(res.status, body, msg);
	}
	return body as T;
}

export interface MeResponse {
	employee_id: string;
	email: string;
	display_name: string;
	created_at: string;
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
	crosspaneChatToEmail: () =>
		request<{ ok: boolean; reason: string }>(
			"/api/crosspane/chat-to-email",
			{ method: "POST" },
		),
	crosspaneEmailToChat: () =>
		request<{ ok: boolean; reason: string }>(
			"/api/crosspane/email-to-chat",
			{ method: "POST" },
		),
	crosspaneStartMeeting: () =>
		request<{ ok: boolean; reason: string }>(
			"/api/crosspane/start-meeting",
			{ method: "POST" },
		),
};
