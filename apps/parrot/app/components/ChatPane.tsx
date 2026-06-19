// v1.3.1 → Phase 31 Wave 1 (plan 31-02): ChatPane — native Parrot chat.
//
// Mattermost remains the source of truth for teams, channels, posts, and
// durable message storage. Parrot owns the user-facing session boundary:
// this component only calls /api/chat/* with the Clerk-backed Workspace
// session, and the Worker talks to Mattermost internally (AS the employee
// via their PAT — see plan 31-01/31-02).
//
// Wave 1 additions:
//   - Channel browser lives in the Workspace SecondaryNav rail (Column 2 of
//     WorkspaceShell). ChatPane renders the shell itself so it can hand its
//     channel list to the `secondaryNav` prop.
//   - Create-channel dialog (public open to all; private operator-only).
//   - Join button for channels the employee is not yet a member of.
//   - Right-side thread panel (320px) for replies (root_id).
//   - Per-message action row: Reply / Edit (own) / Delete (own) / Pin.

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	Check,
	FileText,
	Hash,
	Loader2,
	Lock,
	MessageSquare,
	Paperclip,
	Pencil,
	Pin,
	Plus,
	RefreshCw,
	Reply,
	Search,
	Send,
	Smile,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { ChatToEmail } from "./crosspane/ChatToEmail";
import { StartMeeting } from "./crosspane/StartMeeting";
import { WorkspaceShell } from "./WorkspaceShell";
import { apiFetch } from "~/lib/api";

interface MmUser {
	id: string;
	username: string;
	first_name?: string;
	last_name?: string;
	nickname?: string;
	email?: string;
}

interface MmTeam {
	id: string;
	name: string;
	display_name: string;
}

interface MmChannel {
	id: string;
	name: string;
	display_name: string;
	type: "O" | "P" | "D" | "G";
	last_post_at?: number;
	total_msg_count?: number;
	// Wave 4 will populate real unread counts; until then the dot stays hidden.
	has_unreads?: boolean;
	// Wave 2 (31-03): GET /api/chat/dms enriches DM channels with the resolved
	// display names of the conversation partner(s) (excludes the employee).
	dm_partner_names?: string[];
}

interface MmFileInfo {
	id: string;
	name: string;
	mime_type?: string;
	extension?: string;
	width?: number;
	height?: number;
}

interface MmReaction {
	user_id: string;
	emoji_name: string;
	post_id?: string;
}

interface MmPost {
	id: string;
	channel_id: string;
	user_id: string;
	message: string;
	create_at: number;
	update_at?: number;
	// Mattermost bumps update_at on replies/reactions too, so it is NOT a
	// reliable "this message was edited" marker. edit_at is set ONLY when the
	// message text itself is edited (0 otherwise). Use edit_at for the tag.
	edit_at?: number;
	// Set true by MM when a post is pinned in its channel (#6a).
	is_pinned?: boolean;
	root_id?: string;
	reply_count?: number;
	props?: Record<string, unknown>;
	// Wave 3 (31-04): attachments + reactions. file_ids is the raw id list MM
	// stores on the post; metadata.files carries the resolved FileInfo MM
	// embeds in the post object when present.
	file_ids?: string[];
	metadata?: { files?: MmFileInfo[] };
	reactions?: MmReaction[];
}

interface MmPostList {
	order?: string[];
	posts?: Record<string, MmPost>;
}

interface BootstrapData {
	me: MmUser;
	team: MmTeam;
	channels: MmChannel[];
}

class ChatApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

// Map the worker's `reason` codes (see workers/index.ts /api/chat/*) to
// human-readable copy. Without this the pane only ever showed the opaque
// "Chat request failed (404)" because chatFetch read message/error, not reason.
function friendlyChatReason(reason?: string): string | null {
	switch (reason) {
		case "user_not_found":
			return "Your chat account is still being set up. Refresh in a moment — if this keeps happening, contact an admin.";
		case "mattermost_bot_not_configured":
			return "Chat isn't configured yet (missing bot token). Contact an admin.";
		case "team_unavailable":
			return "The chat workspace is unavailable right now. Please try again.";
		case "channel_unavailable":
			return "No chat channels are available yet.";
		case "membership_failed":
			return "Couldn't add you to the chat workspace. Please try again.";
		default:
			return null;
	}
}

async function chatFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await apiFetch(path, {
		...init,
		headers: {
			Accept: "application/json",
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...(init.headers ?? {}),
		},
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as
			| { message?: string; error?: string; reason?: string }
			| null;
		throw new ChatApiError(
			res.status,
			body?.message ||
				body?.error ||
				friendlyChatReason(body?.reason) ||
				`Chat request failed (${res.status})`,
		);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

function displayName(user?: MmUser): string {
	if (!user) return "Teammate";
	const full = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
	return user.nickname || full || user.username || user.email || "Teammate";
}

function parrotAuthor(post: MmPost): string | null {
	const name = post.props?.parrot_author_name;
	return typeof name === "string" && name.trim() ? name : null;
}

function isParrotAuthoredBy(post: MmPost, user?: MmUser): boolean {
	const authorId = post.props?.parrot_author_user_id;
	const authorEmail = post.props?.parrot_author_email;
	return (
		(typeof authorId === "string" && authorId === user?.id) ||
		(typeof authorEmail === "string" && authorEmail === user?.email)
	);
}

function channelLabel(channel: MmChannel): string {
	return channel.display_name || channel.name || "channel";
}

function sortChannels(channels: MmChannel[]): MmChannel[] {
	return [...channels].sort((a, b) => {
		const lastDelta = (b.last_post_at ?? 0) - (a.last_post_at ?? 0);
		if (lastDelta !== 0) return lastDelta;
		return channelLabel(a).localeCompare(channelLabel(b));
	});
}

// Wave 2 (31-03): a DM channel's user-facing label is its resolved partner
// name(s). Direct ("D") → the single partner; group ("G") → "Group: a, b…"
// truncated. Falls back to the raw display_name if partner names are absent.
function dmLabel(channel: MmChannel): string {
	const names = channel.dm_partner_names ?? [];
	if (channel.type === "D") {
		return names[0] || channel.display_name || "Direct message";
	}
	if (names.length) {
		const joined = `Group: ${names.join(", ")}`;
		return joined.length > 28 ? `${joined.slice(0, 27)}…` : joined;
	}
	return channel.display_name || "Group message";
}

function initials(label: string): string {
	const parts = label.replace(/^Group:\s*/, "").trim().split(/\s+/);
	const first = parts[0]?.[0] ?? "?";
	const second = parts.length > 1 ? (parts[1][0] ?? "") : "";
	return (first + second).toUpperCase();
}

function mmUserDisplayName(user: MmUser): string {
	const full = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
	return user.nickname || full || user.username || user.email || "Teammate";
}

// Wave 4 (31-05): presence dot color for an MM status string.
function presenceDotClass(status: string | null | undefined): string {
	switch (status) {
		case "online":
			return "bg-emerald-500";
		case "away":
			return "bg-amber-400";
		case "dnd":
			return "bg-rose-500";
		default:
			return "bg-slate-300"; // offline / unknown
	}
}

function orderedPosts(data?: MmPostList): MmPost[] {
	if (!data?.posts) return [];
	const values = Object.values(data.posts);
	const byId = new Map(values.map((post) => [post.id, post]));
	if (data.order?.length) {
		return data.order
			.map((id) => byId.get(id))
			.filter((post): post is MmPost => Boolean(post))
			.reverse();
	}
	return values.sort((a, b) => a.create_at - b.create_at);
}

// Thread replies render oldest-first (parent at the top, replies below).
function threadOrderedPosts(data?: MmPostList): MmPost[] {
	if (!data?.posts) return [];
	return Object.values(data.posts).sort((a, b) => a.create_at - b.create_at);
}

function formatMessageTime(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

// MM channel names must be lowercase URL-safe slugs. Slugify the create-dialog
// name input as the user types so the POST body is always valid.
function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

// ── Wave 3 (31-04): emoji reactions + @mentions + inline files ────────

// Quick-picker glyphs and their MM short names. MM stores reactions by short
// name (e.g. "thumbsup"), so the picker maps the displayed glyph to its name
// when calling POST /api/chat/reactions.
const EMOJI_PICKER: Array<[string, string]> = [
	["👍", "thumbsup"],
	["❤️", "heart"],
	["😂", "joy"],
	["🎉", "tada"],
	["🔥", "fire"],
	["👀", "eyes"],
	["🙏", "pray"],
	["💯", "100"],
	["✅", "white_check_mark"],
	["❌", "x"],
	["😊", "blush"],
	["🤔", "thinking_face"],
	["🚀", "rocket"],
	["💡", "bulb"],
	["⚡", "zap"],
	["😎", "sunglasses"],
	["🤝", "handshake"],
	["🙌", "raised_hands"],
	["💪", "muscle"],
	["✨", "sparkles"],
];

// Reverse lookup: MM short name → glyph, so existing reaction chips render the
// emoji rather than the raw name. Falls back to :name: for unknown emoji.
const EMOJI_GLYPH = new Map(EMOJI_PICKER.map(([glyph, name]) => [name, glyph]));

function emojiGlyph(name: string): string {
	return EMOJI_GLYPH.get(name) ?? `:${name}:`;
}

// Group a post's reactions by emoji_name → { count, mine }.
function groupReactions(
	reactions: MmReaction[] | undefined,
	myUserId?: string,
): Array<{ name: string; count: number; mine: boolean }> {
	if (!reactions?.length) return [];
	const byName = new Map<string, { count: number; mine: boolean }>();
	for (const r of reactions) {
		const entry = byName.get(r.emoji_name) ?? { count: 0, mine: false };
		entry.count += 1;
		if (myUserId && r.user_id === myUserId) entry.mine = true;
		byName.set(r.emoji_name, entry);
	}
	return [...byName.entries()].map(([name, v]) => ({ name, ...v }));
}

// Resolve a post's file attachments from either metadata.files (preferred,
// includes mime/name) or the bare file_ids list (id-only fallback).
function postFiles(post: MmPost): MmFileInfo[] {
	if (post.metadata?.files?.length) return post.metadata.files;
	if (post.file_ids?.length) {
		return post.file_ids.map((id) => ({ id, name: "attachment" }));
	}
	return [];
}

// #5 + #12a: a post is "edited" ONLY when MM set edit_at (> 0). Replies and
// reactions bump update_at but leave edit_at at 0, so keying the tag off
// update_at vs create_at wrongly flagged those posts as edited.
function isEdited(post: MmPost): boolean {
	return typeof post.edit_at === "number" && post.edit_at > 0;
}

function isImageFile(file: MmFileInfo): boolean {
	if (file.mime_type) return file.mime_type.startsWith("image/");
	const ext = (file.extension ?? file.name.split(".").pop() ?? "").toLowerCase();
	return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);
}

// Render message text with @mentions highlighted. The current employee's own
// username gets a yellow background (directed-at-you); other mentions are sky
// blue. Returns a ReactNode array so we keep the rest of the text as-is.
function renderMessageText(text: string, myUsername?: string): ReactNode {
	if (!text) return text;
	const parts: ReactNode[] = [];
	// #13: capture the WHOLE mention token INCLUDING the leading @, so the
	// highlight span wraps "@John" rather than just "John". A mention starts at
	// the beginning of the string or after whitespace/punctuation. We capture an
	// optional leading boundary char in group 1 (re-emitted as plain text) and
	// the @handle in group 2 (highlighted).
	const regex = /(^|[\s.,;:!?()[\]{}"'])(@\w+)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	let key = 0;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex walk
	while ((match = regex.exec(text)) !== null) {
		const boundary = match[1] ?? "";
		const mentionStart = match.index + boundary.length;
		// Emit any text before the mention (including the boundary char) as-is.
		if (mentionStart > lastIndex) {
			parts.push(text.slice(lastIndex, mentionStart));
		}
		const mention = match[2]; // the @handle, including the leading @
		const handle = mention.slice(1).toLowerCase();
		const isMe = !!myUsername && handle === myUsername.toLowerCase();
		parts.push(
			<span
				key={`m${key++}`}
				className={
					isMe
						? "rounded bg-yellow-100 px-0.5 font-medium text-sky-700"
						: "font-medium text-sky-600"
				}
			>
				{mention}
			</span>,
		);
		lastIndex = mentionStart + mention.length;
	}
	if (lastIndex < text.length) parts.push(text.slice(lastIndex));
	return parts.length ? parts : text;
}

// ── Wave 4 (31-05): real-time WebSocket hook ──────────────────────────
//
// Replaces the 5s post polling. Connects to the Worker-proxied /api/chat/ws
// (the Worker authenticates with the employee PAT server-side — the browser
// never sees the token). Dispatches MM events (`posted`, `typing`,
// `status_change`, `channel_viewed`) to the provided callbacks. Reconnects
// with exponential backoff. Returns `sendTyping()` to emit `user_typing`.
//
// Callbacks are held in a ref so the socket handlers always see the latest
// closures WITHOUT tearing down + reconnecting the socket on every render.
interface ChatWsCallbacks {
	onPosted: (post: MmPost) => void;
	onTyping: (channelId: string, userId: string) => void;
	onStatusChange: (userId: string, status: string) => void;
	onChannelViewed: (channelId: string) => void;
}

function useChatWebSocket(enabled: boolean, callbacks: ChatWsCallbacks) {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const attemptsRef = useRef(0);
	const closedByUnmountRef = useRef(false);
	const cbRef = useRef(callbacks);
	cbRef.current = callbacks;

	useEffect(() => {
		if (!enabled) return;
		if (typeof window === "undefined") return;
		closedByUnmountRef.current = false;

		function connect() {
			if (wsRef.current?.readyState === WebSocket.OPEN) return;
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(
				`${protocol}//${window.location.host}/api/chat/ws`,
			);
			wsRef.current = ws;

			ws.onopen = () => {
				attemptsRef.current = 0;
			};

			ws.onmessage = (evt) => {
				try {
					const msg = JSON.parse(evt.data as string) as {
						event?: string;
						data?: Record<string, unknown>;
					};
					const cb = cbRef.current;
					if (msg.event === "posted") {
						const raw = msg.data?.post;
						const post =
							typeof raw === "string"
								? (JSON.parse(raw) as MmPost)
								: (raw as MmPost | undefined);
						if (post?.id) cb.onPosted(post);
					} else if (msg.event === "typing") {
						const channelId = msg.data?.channel_id as string | undefined;
						const userId = msg.data?.user_id as string | undefined;
						if (channelId && userId) cb.onTyping(channelId, userId);
					} else if (msg.event === "status_change") {
						const userId = msg.data?.user_id as string | undefined;
						const status = msg.data?.status as string | undefined;
						if (userId && status) cb.onStatusChange(userId, status);
					} else if (msg.event === "channel_viewed") {
						const channelId = msg.data?.channel_id as string | undefined;
						if (channelId) cb.onChannelViewed(channelId);
					}
				} catch {
					/* malformed frame (e.g. MM "hello"/"pong" non-JSON) — ignore */
				}
			};

			ws.onclose = () => {
				if (closedByUnmountRef.current) return;
				// Exponential backoff: 2s → 4s → 8s → 16s, capped at 30s.
				const delay = Math.min(2000 * 2 ** attemptsRef.current, 30000);
				attemptsRef.current = Math.min(attemptsRef.current + 1, 4);
				reconnectTimerRef.current = setTimeout(connect, delay);
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			closedByUnmountRef.current = true;
			if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close(1000, "component_unmount");
			wsRef.current = null;
		};
	}, [enabled]);

	const sendTyping = useCallback((channelId: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(
				JSON.stringify({
					seq: Date.now(),
					action: "user_typing",
					data: { channel_id: channelId, parent_id: "" },
				}),
			);
		}
	}, []);

	return { sendTyping };
}

export function ChatPane({ isOperator = false }: { isOperator?: boolean }) {
	const queryClient = useQueryClient();
	const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
	const [threadPanelPostId, setThreadPanelPostId] = useState<string | null>(null);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [dmDialogOpen, setDmDialogOpen] = useState(false);
	const [editingPostId, setEditingPostId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState("");
	const [pinToast, setPinToast] = useState<string | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);

	// Wave 3 (31-04) state.
	// Pending file uploads: each entry tracks the MM file id (once uploaded),
	// a local preview URL for images, and the upload status.
	type PendingFile = {
		key: string;
		fileId: string | null;
		name: string;
		previewUrl: string | null;
		isImage: boolean;
		uploading: boolean;
		error: boolean;
	};
	const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	// Global search.
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchValue, setSearchValue] = useState("");
	const [searchResults, setSearchResults] = useState<MmPost[] | null>(null);
	const [searchLoading, setSearchLoading] = useState(false);
	const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Reaction picker (which post id has its picker open).
	const [reactionPickerPostId, setReactionPickerPostId] = useState<string | null>(
		null,
	);
	// @mention autocomplete.
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const draftRef = useRef<HTMLTextAreaElement | null>(null);

	// Wave 4 (31-05): real-time state.
	// typingState[channelId][userId] = last-typing timestamp (ms). Pruned every 1s.
	const [typingState, setTypingState] = useState<
		Record<string, Record<string, number>>
	>({});
	// presenceMap[userId] = "online" | "away" | "offline" | "dnd".
	const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
	// Channels/DMs with unread posts (not currently viewed).
	const [unreadChannels, setUnreadChannels] = useState<Set<string>>(
		() => new Set(),
	);
	// Debounce guard so we emit at most one user_typing per 2s.
	const lastTypingSentRef = useRef(0);
	// Keep the active channel id in a ref so WS callbacks (stable closures) can
	// read the CURRENT active channel without re-subscribing the socket.
	const activeIdRef = useRef<string | null>(null);

	const bootstrap = useQuery({
		queryKey: ["native-chat", "bootstrap"],
		retry: false,
		queryFn: async (): Promise<BootstrapData> => {
			const data = await chatFetch<BootstrapData>("/api/chat/bootstrap");
			return { ...data, channels: sortChannels(data.channels) };
		},
	});

	const me = bootstrap.data?.me;
	const team = bootstrap.data?.team;

	// Wave 1: full channel browser. Polls every 30s. Falls back to the
	// bootstrap channel list while the first fetch is in flight.
	const channelsQuery = useQuery({
		queryKey: ["native-chat", "channels"],
		enabled: Boolean(bootstrap.data),
		refetchInterval: 30_000,
		retry: false,
		queryFn: async () => {
			const data = await chatFetch<MmChannel[]>("/api/chat/channels");
			return sortChannels(data);
		},
	});

	const channels =
		channelsQuery.data ?? bootstrap.data?.channels ?? [];

	// Wave 2 (31-03): DM channels (type D + G) live in a separate query/section
	// below the channel list. Polls every 30s like the channel list.
	const dmsQuery = useQuery({
		queryKey: ["native-chat", "dms"],
		enabled: Boolean(bootstrap.data),
		refetchInterval: 30_000,
		retry: false,
		queryFn: () => chatFetch<MmChannel[]>("/api/chat/dms"),
	});
	const dms = dmsQuery.data ?? [];

	// Active channel may be a regular channel OR a DM channel — search both.
	const activeChannel =
		channels.find((channel) => channel.id === activeChannelId) ??
		dms.find((channel) => channel.id === activeChannelId) ??
		channels[0];
	const activeId = activeChannel?.id ?? null;
	const activeIsDm =
		activeChannel?.type === "D" || activeChannel?.type === "G";

	useEffect(() => {
		if (!activeChannelId && channels[0]) {
			setActiveChannelId(channels[0].id);
		}
	}, [activeChannelId, channels]);

	// Wave 4 (31-05): WebSocket delivers new posts in real time, so the 5s
	// polling is gone. The query still runs once on channel switch for the
	// initial backfill; live updates arrive via the `posted` WS event below.
	const postsQuery = useQuery({
		queryKey: ["native-chat", "posts", activeId],
		enabled: Boolean(activeId),
		retry: false,
		queryFn: () =>
			chatFetch<MmPostList>(
				`/api/chat/channels/${activeId}/posts?page=0&per_page=50`,
			),
	});

	// Root-level posts only (replies appear in the thread panel, not the
	// main list — MM returns thread replies in the channel feed too).
	const posts = useMemo(
		() => orderedPosts(postsQuery.data).filter((p) => !p.root_id),
		[postsQuery.data],
	);
	const selectedPost =
		posts.find((post) => post.id === selectedPostId) ?? posts.at(-1) ?? null;

	const userIds = useMemo(
		() => [...new Set(posts.map((post) => post.user_id).filter(Boolean))],
		[posts],
	);

	const usersQuery = useQuery({
		queryKey: ["native-chat", "users", userIds.join(",")],
		enabled: userIds.length > 0,
		staleTime: 60_000,
		queryFn: () =>
			chatFetch<MmUser[]>("/api/chat/users", {
				method: "POST",
				body: JSON.stringify(userIds),
			}),
	});

	const usersById = useMemo(() => {
		const map = new Map<string, MmUser>();
		for (const user of usersQuery.data ?? []) map.set(user.id, user);
		return map;
	}, [usersQuery.data]);

	useEffect(() => {
		const node = messagesRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [activeId, posts.length]);

	useEffect(() => {
		if (!pinToast) return;
		const t = setTimeout(() => setPinToast(null), 2000);
		return () => clearTimeout(t);
	}, [pinToast]);

	// Wave 3 (31-04): team member list (cached) — powers @mention autocomplete.
	const teamMembersQuery = useQuery({
		queryKey: ["native-chat", "team-members"],
		enabled: Boolean(bootstrap.data),
		staleTime: 60_000,
		retry: false,
		queryFn: () => chatFetch<MmUser[]>("/api/chat/team-members"),
	});

	// Filtered mention candidates for the autocomplete dropdown (max 6).
	const mentionCandidates = useMemo(() => {
		if (mentionQuery === null) return [];
		const q = mentionQuery.toLowerCase();
		const list = teamMembersQuery.data ?? [];
		return list
			.filter(
				(u) =>
					(u.username ?? "").toLowerCase().includes(q) ||
					mmUserDisplayName(u).toLowerCase().includes(q),
			)
			.slice(0, 6);
	}, [mentionQuery, teamMembersQuery.data]);

	// ── Wave 4 (31-05): real-time wiring ──────────────────────────────

	// Keep the active-channel ref current for the stable WS callbacks.
	useEffect(() => {
		activeIdRef.current = activeId;
	}, [activeId]);

	// Mark-read mutation: clears MM's unread tracking for the employee.
	const markRead = useMutation({
		mutationFn: (channelId: string) =>
			chatFetch<{ ok: boolean }>(
				`/api/chat/channels/${channelId}/mark-read`,
				{ method: "POST" },
			),
	});

	// Initial presence for everyone the employee might see (DM partners + team
	// members). Refreshed live via the `status_change` WS event; this query just
	// seeds the map and re-syncs every 60s as a safety net.
	const presenceIds = useMemo(() => {
		const ids = new Set<string>();
		for (const u of teamMembersQuery.data ?? []) ids.add(u.id);
		for (const user of usersQuery.data ?? []) ids.add(user.id);
		if (me?.id) ids.delete(me.id);
		return [...ids];
	}, [teamMembersQuery.data, usersQuery.data, me?.id]);

	const presenceQuery = useQuery({
		queryKey: ["native-chat", "presence", presenceIds.join(",")],
		enabled: Boolean(bootstrap.data) && presenceIds.length > 0,
		refetchInterval: 60_000,
		retry: false,
		queryFn: () =>
			chatFetch<Array<{ user_id: string; status: string }>>(
				`/api/chat/presence?ids=${encodeURIComponent(presenceIds.join(","))}`,
			),
	});

	useEffect(() => {
		if (!presenceQuery.data) return;
		setPresenceMap((prev) => {
			const next = { ...prev };
			for (const s of presenceQuery.data) next[s.user_id] = s.status;
			return next;
		});
	}, [presenceQuery.data]);

	// WS callbacks. Stable identities (the hook holds them in a ref), so they may
	// freely read activeIdRef / queryClient without re-subscribing the socket.
	const handlePosted = useCallback(
		(post: MmPost) => {
			const currentActive = activeIdRef.current;
			if (post.channel_id === currentActive) {
				// Append to the active channel's cache so it renders instantly.
				queryClient.setQueryData<MmPostList>(
					["native-chat", "posts", currentActive],
					(prev) => {
						const posts = { ...(prev?.posts ?? {}) };
						if (posts[post.id]) return prev; // dedupe (we may have just sent it)
						posts[post.id] = post;
						const order = prev?.order ? [...prev.order] : [];
						if (!order.includes(post.id)) order.unshift(post.id);
						return { ...prev, posts, order };
					},
				);
			} else {
				// A post in a channel we're not viewing → mark unread.
				setUnreadChannels((prev) => {
					if (prev.has(post.channel_id)) return prev;
					const next = new Set(prev);
					next.add(post.channel_id);
					return next;
				});
			}
		},
		[queryClient],
	);

	const handleTyping = useCallback((channelId: string, userId: string) => {
		setTypingState((prev) => ({
			...prev,
			[channelId]: { ...(prev[channelId] ?? {}), [userId]: Date.now() },
		}));
	}, []);

	const handleStatusChange = useCallback((userId: string, status: string) => {
		setPresenceMap((prev) => ({ ...prev, [userId]: status }));
	}, []);

	const handleChannelViewed = useCallback((channelId: string) => {
		setUnreadChannels((prev) => {
			if (!prev.has(channelId)) return prev;
			const next = new Set(prev);
			next.delete(channelId);
			return next;
		});
	}, []);

	const { sendTyping } = useChatWebSocket(Boolean(bootstrap.data), {
		onPosted: handlePosted,
		onTyping: handleTyping,
		onStatusChange: handleStatusChange,
		onChannelViewed: handleChannelViewed,
	});

	// Prune stale typing entries (older than 3s) once per second.
	useEffect(() => {
		const interval = setInterval(() => {
			const cutoff = Date.now() - 3000;
			setTypingState((prev) => {
				let changed = false;
				const next: Record<string, Record<string, number>> = {};
				for (const [channelId, users] of Object.entries(prev)) {
					const kept: Record<string, number> = {};
					for (const [userId, ts] of Object.entries(users)) {
						if (ts >= cutoff) kept[userId] = ts;
						else changed = true;
					}
					if (Object.keys(kept).length) next[channelId] = kept;
				}
				return changed ? next : prev;
			});
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	// Dispatch a window event whenever the unread-channel count changes so
	// WorkspaceShell can drive the Chat nav badge (see Task 3 listener).
	useEffect(() => {
		if (typeof window === "undefined") return;
		window.dispatchEvent(
			new CustomEvent("chat-unread-change", {
				detail: { count: unreadChannels.size },
			}),
		);
	}, [unreadChannels]);

	// When the active channel changes, clear its unread flag (optimistically) and
	// tell MM to mark it read.
	useEffect(() => {
		if (!activeId) return;
		setUnreadChannels((prev) => {
			if (!prev.has(activeId)) return prev;
			const next = new Set(prev);
			next.delete(activeId);
			return next;
		});
		markRead.mutate(activeId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeId]);

	// Map a display name → status, so a DM row (which carries partner NAMES, not
	// ids) can show a presence dot by resolving the name against team members.
	const statusByName = useMemo(() => {
		const map = new Map<string, string>();
		for (const u of teamMembersQuery.data ?? []) {
			const status = presenceMap[u.id];
			if (status) map.set(mmUserDisplayName(u).toLowerCase(), status);
		}
		return map;
	}, [teamMembersQuery.data, presenceMap]);

	function dmPresence(dm: MmChannel): string | null {
		if (dm.type !== "D") return null; // only 1:1 DMs get a single dot
		const partner = dm.dm_partner_names?.[0];
		if (!partner) return null;
		return statusByName.get(partner.toLowerCase()) ?? null;
	}

	// Names of teammates currently typing in the active channel (excluding self).
	const typingNames = useMemo(() => {
		if (!activeId) return [] as string[];
		const users = typingState[activeId] ?? {};
		return Object.keys(users)
			.filter((uid) => uid !== me?.id)
			.map((uid) => {
				const u = usersById.get(uid);
				return u ? mmUserDisplayName(u) : "Someone";
			});
	}, [typingState, activeId, me?.id, usersById]);

	const sendMessage = useMutation({
		mutationFn: (input: { message: string; fileIds: string[] }) =>
			chatFetch<MmPost>("/api/chat/posts", {
				method: "POST",
				body: JSON.stringify({
					channel_id: activeId,
					message: input.message,
					...(input.fileIds.length ? { file_ids: input.fileIds } : {}),
				}),
			}),
		onSuccess: async () => {
			setDraft("");
			// Revoke any preview object URLs and clear the pending list.
			setPendingFiles((prev) => {
				for (const f of prev) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
				return [];
			});
			setMentionQuery(null);
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "posts", activeId],
			});
		},
	});

	const createChannel = useMutation({
		mutationFn: (input: { name: string; display_name: string; type: "O" | "P" }) =>
			chatFetch<MmChannel>("/api/chat/channels", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: async (channel) => {
			setCreateDialogOpen(false);
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "channels"],
			});
			setActiveChannelId(channel.id);
			setSelectedPostId(null);
			setThreadPanelPostId(null);
		},
	});

	const joinChannel = useMutation({
		mutationFn: (channelId: string) =>
			chatFetch<{ ok: boolean }>(`/api/chat/channels/${channelId}/join`, {
				method: "POST",
			}),
		onSuccess: async (_data, channelId) => {
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "channels"],
			});
			setActiveChannelId(channelId);
		},
	});

	// Wave 2 (31-03): open/create a DM (idempotent on the server). On success
	// refresh the DM list and switch the active channel to the new/existing DM.
	const openDm = useMutation({
		mutationFn: (input: { kind: "direct" | "group"; userIds: string[] }) => {
			if (input.kind === "direct") {
				return chatFetch<MmChannel>("/api/chat/dms/direct", {
					method: "POST",
					body: JSON.stringify({ mm_user_id: input.userIds[0] }),
				});
			}
			return chatFetch<MmChannel>("/api/chat/dms/group", {
				method: "POST",
				body: JSON.stringify({ mm_user_ids: input.userIds }),
			});
		},
		onSuccess: async (channel) => {
			setDmDialogOpen(false);
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "dms"],
			});
			setActiveChannelId(channel.id);
			setSelectedPostId(null);
			setThreadPanelPostId(null);
		},
	});

	const editPost = useMutation({
		mutationFn: (input: { postId: string; message: string }) =>
			chatFetch<MmPost>(`/api/chat/posts/${input.postId}`, {
				method: "PATCH",
				body: JSON.stringify({ message: input.message }),
			}),
		onSuccess: async () => {
			setEditingPostId(null);
			setEditDraft("");
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "posts", activeId],
			});
		},
	});

	const deletePost = useMutation({
		mutationFn: (postId: string) =>
			chatFetch<{ ok: boolean }>(`/api/chat/posts/${postId}`, {
				method: "DELETE",
			}),
		onSuccess: async (_data, postId) => {
			// Optimistically drop from the cached post list.
			queryClient.setQueryData<MmPostList>(
				["native-chat", "posts", activeId],
				(prev) => {
					if (!prev?.posts) return prev;
					const posts = { ...prev.posts };
					delete posts[postId];
					return {
						...prev,
						posts,
						order: prev.order?.filter((id) => id !== postId),
					};
				},
			);
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "posts", activeId],
			});
		},
	});

	const pinPost = useMutation({
		mutationFn: (postId: string) =>
			chatFetch<{ ok: boolean }>(`/api/chat/channels/${activeId}/pin`, {
				method: "POST",
				body: JSON.stringify({ post_id: postId }),
			}),
		onSuccess: () => setPinToast("Pinned"),
	});

	// Wave 3 (31-04): toggle an emoji reaction. POST to add, DELETE to remove —
	// the caller passes `mine` to pick the direction. Optimistic-free: we just
	// refetch the channel posts (MM embeds reactions on the post object).
	const toggleReaction = useMutation({
		mutationFn: (input: { postId: string; emojiName: string; mine: boolean }) =>
			chatFetch<{ ok: boolean }>("/api/chat/reactions", {
				method: input.mine ? "DELETE" : "POST",
				body: JSON.stringify({
					post_id: input.postId,
					emoji_name: input.emojiName,
				}),
			}),
		onSuccess: async () => {
			setReactionPickerPostId(null);
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "posts", activeId],
			});
		},
	});

	// Wave 3 (31-04): upload a file to the active channel. This is a multipart
	// request, so we use the raw apiFetch (NOT chatFetch which forces JSON) and
	// let the browser set the multipart Content-Type + boundary automatically.
	async function uploadFiles(fileList: FileList | File[]) {
		if (!activeId) return;
		const files = Array.from(fileList);
		for (const file of files) {
			const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const isImage = file.type.startsWith("image/");
			const previewUrl = isImage ? URL.createObjectURL(file) : null;
			setPendingFiles((prev) => [
				...prev,
				{
					key,
					fileId: null,
					name: file.name,
					previewUrl,
					isImage,
					uploading: true,
					error: false,
				},
			]);
			try {
				const form = new FormData();
				form.append("files", file, file.name);
				const res = await apiFetch(
					`/api/chat/files?channel_id=${encodeURIComponent(activeId)}`,
					{ method: "POST", body: form },
				);
				const data = (await res.json().catch(() => null)) as
					| { file_infos?: Array<{ id: string }> }
					| null;
				const fileId = data?.file_infos?.[0]?.id ?? null;
				if (!res.ok || !fileId) throw new Error("upload failed");
				setPendingFiles((prev) =>
					prev.map((f) =>
						f.key === key ? { ...f, fileId, uploading: false } : f,
					),
				);
			} catch {
				setPendingFiles((prev) =>
					prev.map((f) =>
						f.key === key ? { ...f, uploading: false, error: true } : f,
					),
				);
			}
		}
	}

	function removePendingFile(key: string) {
		setPendingFiles((prev) => {
			const target = prev.find((f) => f.key === key);
			if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
			return prev.filter((f) => f.key !== key);
		});
	}

	// Wave 3 (31-04): debounced global search. Runs whenever searchValue changes
	// while search mode is open. Stores the ordered result posts in state.
	useEffect(() => {
		if (!searchOpen) return;
		const term = searchValue.trim();
		if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		if (!term) {
			setSearchResults(null);
			setSearchLoading(false);
			return;
		}
		setSearchLoading(true);
		searchDebounceRef.current = setTimeout(async () => {
			try {
				const data = await chatFetch<MmPostList>("/api/chat/search", {
					method: "POST",
					body: JSON.stringify({ terms: term, team_id: team?.id }),
				});
				setSearchResults(orderedPosts(data));
			} catch {
				setSearchResults([]);
			} finally {
				setSearchLoading(false);
			}
		}, 400);
		return () => {
			if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		};
	}, [searchOpen, searchValue, team?.id]);

	// Close search mode on Escape.
	useEffect(() => {
		if (!searchOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setSearchOpen(false);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [searchOpen]);

	function closeSearch() {
		setSearchOpen(false);
		setSearchValue("");
		setSearchResults(null);
	}

	function jumpToResult(channelId: string) {
		selectChannel(channelId);
		closeSearch();
	}

	// Detect @mention typing: a trailing "@word" at the cursor opens the picker.
	function onDraftChange(value: string) {
		setDraft(value);
		const caret = draftRef.current?.selectionStart ?? value.length;
		const upToCaret = value.slice(0, caret);
		const match = /\B@(\w*)$/.exec(upToCaret);
		setMentionQuery(match ? match[1] : null);
		// Wave 4 (31-05): emit a typing event (debounced to once per 2s) so other
		// employees viewing this channel see the typing indicator.
		const now = Date.now();
		if (activeId && value && now - lastTypingSentRef.current > 2000) {
			lastTypingSentRef.current = now;
			sendTyping(activeId);
		}
	}

	function insertMention(username: string) {
		const caret = draftRef.current?.selectionStart ?? draft.length;
		const before = draft.slice(0, caret).replace(/\B@(\w*)$/, `@${username} `);
		const after = draft.slice(caret);
		setDraft(before + after);
		setMentionQuery(null);
		draftRef.current?.focus();
	}

	function submitDraft() {
		const message = draft.trim();
		const fileIds = pendingFiles
			.map((f) => f.fileId)
			.filter((id): id is string => Boolean(id));
		const stillUploading = pendingFiles.some((f) => f.uploading);
		if (
			(!message && fileIds.length === 0) ||
			!activeId ||
			sendMessage.isPending ||
			stillUploading
		) {
			return;
		}
		sendMessage.mutate({ message, fileIds });
	}

	function onSubmit(e: FormEvent) {
		e.preventDefault();
		submitDraft();
	}

	function openThread(postId: string) {
		setThreadPanelPostId(postId);
	}

	function startEdit(post: MmPost) {
		setEditingPostId(post.id);
		setEditDraft(post.message);
	}

	function isMine(post: MmPost): boolean {
		const legacyName = parrotAuthor(post);
		return legacyName
			? isParrotAuthoredBy(post, me)
			: post.user_id === me?.id;
	}

	function selectChannel(channelId: string) {
		setActiveChannelId(channelId);
		setSelectedPostId(null);
		setThreadPanelPostId(null);
	}

	// ── Secondary nav: the channel browser rail + DM section ──────────
	const secondaryNav: ReactNode = (
		<div className="flex h-full flex-col">
			<div className="flex-1 overflow-auto py-1">
				{/* Channels */}
				<div className="flex items-center justify-between px-4 pb-1 pt-2">
					<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
						Channels
					</span>
				</div>
				{channelsQuery.isLoading && !channels.length ? (
					<div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500">
						<Loader2 className="animate-spin" size={14} />
						Loading channels
					</div>
				) : channels.length === 0 ? (
					<p className="px-4 py-3 text-sm text-slate-400">No channels yet.</p>
				) : (
					channels.map((channel) => {
						const active = channel.id === activeId;
						const Icon = channel.type === "P" ? Lock : Hash;
						return (
							<button
								key={channel.id}
								type="button"
								onClick={() => selectChannel(channel.id)}
								className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors ${
									active
										? "bg-slate-100 font-semibold text-slate-900"
										: "text-slate-600 hover:bg-slate-50"
								}`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<Icon size={14} className="shrink-0 text-slate-400" />
									<span className="truncate">{channelLabel(channel)}</span>
								</span>
								{(channel.has_unreads ||
									unreadChannels.has(channel.id)) && (
									<span
										aria-hidden="true"
										className="h-2 w-2 shrink-0 rounded-full bg-sky-500"
									/>
								)}
							</button>
						);
					})
				)}

				{/* Direct Messages */}
				<div className="mt-4 flex items-center justify-between px-4 pb-1 pt-2">
					<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
						Direct Messages
					</span>
					<button
						type="button"
						onClick={() => setDmDialogOpen(true)}
						title="New direct message"
						aria-label="New direct message"
						className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
					>
						<Plus size={14} />
					</button>
				</div>
				{dmsQuery.isLoading && !dms.length ? (
					<div className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500">
						<Loader2 className="animate-spin" size={14} />
						Loading DMs
					</div>
				) : dms.length === 0 ? (
					<p className="px-4 py-2 text-xs text-slate-400">
						No direct messages yet.
					</p>
				) : (
					dms.map((dm) => {
						const active = dm.id === activeId;
						const label = dmLabel(dm);
						const presence = dmPresence(dm);
						return (
							<button
								key={dm.id}
								type="button"
								onClick={() => selectChannel(dm.id)}
								className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors ${
									active
										? "bg-slate-100 font-semibold text-slate-900"
										: "text-slate-600 hover:bg-slate-50"
								}`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">
										{dm.type === "G" ? (
											<Users size={11} />
										) : (
											initials(label)
										)}
										{presence && (
											<span
												aria-hidden="true"
												title={presence}
												className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white ${presenceDotClass(presence)}`}
											/>
										)}
									</span>
									<span className="truncate">{label}</span>
								</span>
								{(dm.has_unreads || unreadChannels.has(dm.id)) && (
									<span
										aria-hidden="true"
										className="h-2 w-2 shrink-0 rounded-full bg-sky-500"
									/>
								)}
							</button>
						);
					})
				)}
			</div>
			<div className="border-t border-slate-200 p-2">
				<button
					type="button"
					onClick={() => setCreateDialogOpen(true)}
					className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
				>
					<Plus size={15} />
					New Channel
				</button>
			</div>
		</div>
	);

	// ── Loading / error gates ────────────────────────────────────────
	let body: ReactNode;
	if (bootstrap.isLoading) {
		body = (
			<div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
				<Loader2 className="mr-2 animate-spin" size={16} />
				Loading chat
			</div>
		);
	} else if (bootstrap.error) {
		const err = bootstrap.error as Error;
		body = (
			<div className="flex h-full items-center justify-center bg-slate-50 p-4">
				<div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex items-start gap-3">
						<AlertCircle className="mt-0.5 text-slate-400" size={18} />
						<div>
							<h2 className="text-sm font-semibold text-slate-900">
								Chat is unavailable
							</h2>
							<p className="mt-1 text-sm text-slate-500">{err.message}</p>
						</div>
					</div>
					<div className="mt-4 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => bootstrap.refetch()}
							className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
						>
							<RefreshCw size={15} />
							Refresh
						</button>
					</div>
				</div>
			</div>
		);
	} else {
		body = (
			<div className="flex h-full min-h-0 flex-col bg-slate-50">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-900">
							{activeChannel
								? activeIsDm
									? dmLabel(activeChannel)
									: `#${channelLabel(activeChannel)}`
								: "channel"}
						</p>
						<p className="truncate text-xs text-slate-500">
							{team?.display_name || "InternJobs"} · Signed in as{" "}
							{displayName(me)}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<ChatToEmail
							postId={selectedPost?.id ?? ""}
							postBody={selectedPost?.message ?? ""}
						/>
						<StartMeeting />
						<button
							type="button"
							onClick={() => setSearchOpen((v) => !v)}
							title="Search messages"
							aria-label="Search messages"
							className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 ${
								searchOpen ? "text-sky-600 ring-1 ring-sky-300" : "text-slate-600"
							}`}
						>
							<Search size={16} />
						</button>
						<button
							type="button"
							onClick={() => postsQuery.refetch()}
							disabled={postsQuery.isFetching}
							title="Refresh messages"
							className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
						>
							<RefreshCw
								size={16}
								className={postsQuery.isFetching ? "animate-spin" : ""}
							/>
						</button>
					</div>
				</div>

				{/* Message area + right-side thread panel */}
				<div className="flex min-h-0 flex-1">
					<section className="flex min-h-0 flex-1 flex-col">
						{searchOpen ? (
							<SearchPanel
								value={searchValue}
								onChange={setSearchValue}
								loading={searchLoading}
								results={searchResults}
								usersById={usersById}
								channels={channels}
								dms={dms}
								myUsername={me?.username}
								onJump={jumpToResult}
								onClose={closeSearch}
							/>
						) : (
						<>
						<div
							ref={messagesRef}
							className="min-h-0 flex-1 space-y-1 overflow-auto px-3 py-4 sm:px-6"
						>
							{postsQuery.isLoading ? (
								<div className="flex items-center gap-2 text-sm text-slate-500">
									<Loader2 className="animate-spin" size={16} />
									Loading messages
								</div>
							) : postsQuery.error ? (
								<div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
									{(postsQuery.error as Error).message}
								</div>
							) : posts.length === 0 ? (
								<div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
									No messages here yet.
								</div>
							) : (
								posts.map((post) => {
									const mine = isMine(post);
									const selected = post.id === selectedPost?.id;
									const author =
										parrotAuthor(post) ||
										displayName(usersById.get(post.user_id));
									const editing = editingPostId === post.id;
									const replies = post.reply_count ?? 0;
									return (
										<div
											key={post.id}
											className={`group relative rounded-md px-3 py-2 transition-colors ${
												selected
													? "bg-white ring-1 ring-slate-300"
													: "hover:bg-white/80"
											}`}
											onClick={() => setSelectedPostId(post.id)}
										>
											<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
												<span className="text-sm font-semibold text-slate-900">
													{mine ? "You" : author}
												</span>
												<span className="text-xs text-slate-400">
													{formatMessageTime(post.create_at)}
												</span>
												{isEdited(post) && (
													<span className="text-[10px] text-slate-400">
														(edited)
													</span>
												)}
											</div>

											{editing ? (
												<div className="mt-1">
													<textarea
														value={editDraft}
														onChange={(e) => setEditDraft(e.target.value)}
														rows={2}
														className="w-full resize-none rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
													/>
													<div className="mt-1 flex gap-2">
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																const msg = editDraft.trim();
																if (msg) editPost.mutate({ postId: post.id, message: msg });
															}}
															disabled={editPost.isPending}
															className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
														>
															<Check size={13} /> Save
														</button>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																setEditingPostId(null);
																setEditDraft("");
															}}
															className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
														>
															Cancel
														</button>
													</div>
												</div>
											) : (
												<>
													{post.message && (
														<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
															{renderMessageText(post.message, me?.username)}
														</p>
													)}
													{/* Wave 3 (31-04): inline attachments. Images render
													    via the GET proxy (Content-Type forwarded); other
													    files render as a download link. */}
													{postFiles(post).length > 0 && (
														<div className="mt-1.5 flex flex-wrap gap-2">
															{postFiles(post).map((file) =>
																isImageFile(file) ? (
																	<a
																		key={file.id}
																		href={`/api/chat/files/${file.id}`}
																		target="_blank"
																		rel="noreferrer"
																		onClick={(e) => e.stopPropagation()}
																		className="block"
																	>
																		<img
																			src={`/api/chat/files/${file.id}`}
																			alt={file.name}
																			className="max-h-60 max-w-xs rounded-md border border-slate-200 object-cover"
																		/>
																	</a>
																) : (
																	<a
																		key={file.id}
																		href={`/api/chat/files/${file.id}`}
																		target="_blank"
																		rel="noreferrer"
																		onClick={(e) => e.stopPropagation()}
																		className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
																	>
																		<FileText size={14} className="text-slate-400" />
																		<span className="max-w-[12rem] truncate">
																			{file.name}
																		</span>
																	</a>
																),
															)}
														</div>
													)}
													{/* Wave 3 (31-04): reaction chips. Click toggles. */}
													{groupReactions(post.reactions, me?.id).length > 0 && (
														<div className="mt-1.5 flex flex-wrap gap-1">
															{groupReactions(post.reactions, me?.id).map((r) => (
																<button
																	key={r.name}
																	type="button"
																	onClick={(e) => {
																		e.stopPropagation();
																		toggleReaction.mutate({
																			postId: post.id,
																			emojiName: r.name,
																			mine: r.mine,
																		});
																	}}
																	title={r.name}
																	className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
																		r.mine
																			? "border-sky-300 bg-sky-50 text-sky-700"
																			: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
																	}`}
																>
																	<span>{emojiGlyph(r.name)}</span>
																	<span className="tabular-nums">{r.count}</span>
																</button>
															))}
														</div>
													)}
												</>
											)}

											{replies > 0 && !editing && (
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														openThread(post.id);
													}}
													className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-50"
												>
													<MessageSquare size={12} />
													{replies} {replies === 1 ? "reply" : "replies"}
												</button>
											)}

											{/* Reaction quick-picker popover */}
											{reactionPickerPostId === post.id && (
												<div
													className="absolute right-2 top-8 z-20 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
													onClick={(e) => e.stopPropagation()}
												>
													<div className="grid grid-cols-8 gap-0.5">
														{EMOJI_PICKER.map(([glyph, name]) => (
															<button
																key={name}
																type="button"
																title={name}
																onClick={(e) => {
																	e.stopPropagation();
																	const already = groupReactions(
																		post.reactions,
																		me?.id,
																	).find((r) => r.name === name)?.mine;
																	toggleReaction.mutate({
																		postId: post.id,
																		emojiName: name,
																		mine: !!already,
																	});
																}}
																className="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-slate-100"
															>
																{glyph}
															</button>
														))}
													</div>
												</div>
											)}

											{/* Hover action row */}
											{!editing && (
												<div className="absolute right-2 top-1 hidden items-center gap-0.5 rounded-md border border-slate-200 bg-white px-0.5 py-0.5 shadow-sm group-hover:flex">
													<button
														type="button"
														title="Add reaction"
														onClick={(e) => {
															e.stopPropagation();
															setReactionPickerPostId((prev) =>
																prev === post.id ? null : post.id,
															);
														}}
														className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
													>
														<Smile size={13} />
													</button>
													<button
														type="button"
														title="Reply in thread"
														onClick={(e) => {
															e.stopPropagation();
															openThread(post.id);
														}}
														className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
													>
														<Reply size={13} />
													</button>
													<button
														type="button"
														title="Pin"
														onClick={(e) => {
															e.stopPropagation();
															pinPost.mutate(post.id);
														}}
														className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
													>
														<Pin size={13} />
													</button>
													{mine && (
														<>
															<button
																type="button"
																title="Edit"
																onClick={(e) => {
																	e.stopPropagation();
																	startEdit(post);
																}}
																className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900"
															>
																<Pencil size={13} />
															</button>
															<button
																type="button"
																title="Delete"
																onClick={(e) => {
																	e.stopPropagation();
																	if (
																		window.confirm(
																			"Delete this message? This can't be undone.",
																		)
																	) {
																		deletePost.mutate(post.id);
																	}
																}}
																className="inline-flex h-6 w-6 items-center justify-center rounded text-rose-500 hover:bg-rose-50"
															>
																<Trash2 size={13} />
															</button>
														</>
													)}
												</div>
											)}
										</div>
									);
								})
							)}
						</div>

						{/* Wave 4 (31-05): typing indicator */}
						{typingNames.length > 0 && (
							<div className="flex items-center gap-1.5 px-4 pb-1 text-xs italic text-slate-500 sm:px-6">
								<span className="flex gap-0.5">
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
									<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
								</span>
								<span>
									{typingNames.length === 1
										? `${typingNames[0]} is typing…`
										: typingNames.length === 2
											? `${typingNames[0]} and ${typingNames[1]} are typing…`
											: "Several people are typing…"}
								</span>
							</div>
						)}

						<form
							onSubmit={onSubmit}
							className="relative border-t border-slate-200 bg-white p-3 sm:p-4"
						>
							{/* @mention autocomplete dropdown */}
							{mentionQuery !== null && mentionCandidates.length > 0 && (
								<div className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
									{mentionCandidates.map((u) => (
										<button
											key={u.id}
											type="button"
											onClick={() => insertMention(u.username)}
											className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
										>
											<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">
												{initials(mmUserDisplayName(u))}
											</span>
											<span className="min-w-0">
												<span className="block truncate font-medium text-slate-800">
													{mmUserDisplayName(u)}
												</span>
												<span className="block truncate text-xs text-slate-400">
													@{u.username}
												</span>
											</span>
										</button>
									))}
								</div>
							)}

							{/* Pending attachment previews */}
							{pendingFiles.length > 0 && (
								<div className="mb-2 flex flex-wrap gap-2">
									{pendingFiles.map((f) => (
										<div
											key={f.key}
											className="relative flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs"
										>
											{f.isImage && f.previewUrl ? (
												<img
													src={f.previewUrl}
													alt={f.name}
													className="h-10 w-10 rounded object-cover"
												/>
											) : (
												<FileText size={16} className="text-slate-400" />
											)}
											<span className="max-w-[8rem] truncate text-slate-600">
												{f.name}
											</span>
											{f.uploading && (
												<Loader2 className="animate-spin text-slate-400" size={13} />
											)}
											{f.error && (
												<span className="text-rose-600">failed</span>
											)}
											<button
												type="button"
												aria-label={`Remove ${f.name}`}
												onClick={() => removePendingFile(f.key)}
												className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
											>
												<X size={11} />
											</button>
										</div>
									))}
								</div>
							)}

							<div
								className={`flex items-end gap-2 rounded-md ${
									isDragging ? "ring-2 ring-sky-400" : ""
								}`}
								onDragOver={(e) => {
									e.preventDefault();
									if (activeId) setIsDragging(true);
								}}
								onDragLeave={() => setIsDragging(false)}
								onDrop={(e) => {
									e.preventDefault();
									setIsDragging(false);
									if (e.dataTransfer.files?.length) {
										void uploadFiles(e.dataTransfer.files);
									}
								}}
							>
								<input
									ref={fileInputRef}
									type="file"
									multiple
									className="hidden"
									onChange={(e) => {
										if (e.target.files?.length) {
											void uploadFiles(e.target.files);
											e.target.value = "";
										}
									}}
								/>
								<button
									type="button"
									title="Attach file"
									aria-label="Attach file"
									disabled={!activeId}
									onClick={() => fileInputRef.current?.click()}
									className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
								>
									<Paperclip size={17} />
								</button>
								<textarea
									ref={draftRef}
									value={draft}
									onChange={(e) => onDraftChange(e.target.value)}
									disabled={!activeId || sendMessage.isPending}
									rows={2}
									placeholder={
										isDragging
											? "Drop file to attach"
											: activeChannel
											? activeIsDm
												? `Message ${dmLabel(activeChannel)}`
												: `Message #${channelLabel(activeChannel)}`
											: "Choose a channel"
									}
									className="min-h-[44px] flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-5 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											submitDraft();
										}
									}}
								/>
								<button
									type="submit"
									disabled={
										(!draft.trim() && pendingFiles.length === 0) ||
										!activeId ||
										sendMessage.isPending ||
										pendingFiles.some((f) => f.uploading)
									}
									title="Send message"
									className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
								>
									{sendMessage.isPending ? (
										<Loader2 className="animate-spin" size={17} />
									) : (
										<Send size={17} />
									)}
								</button>
							</div>
							{sendMessage.error && (
								<p className="mt-2 text-xs text-rose-600">
									{(sendMessage.error as Error).message}
								</p>
							)}
						</form>
						</>
						)}
					</section>

					{threadPanelPostId && (
						<ThreadPanel
							rootPostId={threadPanelPostId}
							me={me}
							usersById={usersById}
							onClose={() => setThreadPanelPostId(null)}
						/>
					)}
				</div>

				{pinToast && (
					<div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
						{pinToast}
					</div>
				)}

				{createDialogOpen && (
					<CreateChannelDialog
						allowPrivate={isOperator}
						pending={createChannel.isPending}
						error={(createChannel.error as Error | null)?.message ?? null}
						onClose={() => setCreateDialogOpen(false)}
						onSubmit={(input) => createChannel.mutate(input)}
					/>
				)}

				{dmDialogOpen && (
					<NewDmDialog
						pending={openDm.isPending}
						error={(openDm.error as Error | null)?.message ?? null}
						onClose={() => setDmDialogOpen(false)}
						onSubmit={(kind, userIds) => openDm.mutate({ kind, userIds })}
					/>
				)}
			</div>
		);
	}

	return <WorkspaceShell title="Chat" secondaryNav={secondaryNav}>{body}</WorkspaceShell>;
}

// ─── Global search panel (Wave 3, plan 31-04) ────────────────────────
//
// Replaces the message list when search mode is active. Debounced fetch is
// driven by the parent (ChatPane) via the `value`/`results` props; this is a
// pure presentational list. Clicking a result jumps to its channel.

function SearchPanel({
	value,
	onChange,
	loading,
	results,
	usersById,
	channels,
	dms,
	myUsername,
	onJump,
	onClose,
}: {
	value: string;
	onChange: (v: string) => void;
	loading: boolean;
	results: MmPost[] | null;
	usersById: Map<string, MmUser>;
	channels: MmChannel[];
	dms: MmChannel[];
	myUsername?: string;
	onJump: (channelId: string) => void;
	onClose: () => void;
}) {
	const channelById = useMemo(() => {
		const map = new Map<string, MmChannel>();
		for (const ch of [...channels, ...dms]) map.set(ch.id, ch);
		return map;
	}, [channels, dms]);

	function labelFor(channelId: string): string {
		const ch = channelById.get(channelId);
		if (!ch) return "channel";
		if (ch.type === "D" || ch.type === "G") return dmLabel(ch);
		return `#${channelLabel(ch)}`;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-slate-50">
			<div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
				<div className="relative flex-1">
					<Search
						size={15}
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
					/>
					<input
						value={value}
						onChange={(e) => onChange(e.target.value)}
						placeholder="Search all messages…"
						autoFocus
						className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
					/>
				</div>
				<button
					type="button"
					aria-label="Close search"
					onClick={onClose}
					className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
				>
					<X size={16} />
				</button>
			</div>

			<div className="min-h-0 flex-1 space-y-1 overflow-auto p-3 sm:p-4">
				{loading ? (
					<div className="flex items-center gap-2 text-sm text-slate-500">
						<Loader2 className="animate-spin" size={15} />
						Searching
					</div>
				) : results === null ? (
					<p className="px-1 py-2 text-sm text-slate-400">
						Type to search across all your channels and DMs.
					</p>
				) : results.length === 0 ? (
					<div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
						No messages match “{value}”.
					</div>
				) : (
					results.map((post) => {
						const author = displayName(usersById.get(post.user_id));
						return (
							<button
								key={post.id}
								type="button"
								onClick={() => onJump(post.channel_id)}
								className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
							>
								<div className="flex flex-wrap items-baseline gap-x-2">
									<span className="text-xs font-semibold text-sky-700">
										{labelFor(post.channel_id)}
									</span>
									<span className="text-sm font-medium text-slate-800">
										{author}
									</span>
									<span className="text-xs text-slate-400">
										{formatMessageTime(post.create_at)}
									</span>
								</div>
								<p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-600">
									{renderMessageText(post.message, myUsername)}
								</p>
							</button>
						);
					})
				)}
			</div>
		</div>
	);
}

// ─── Thread panel (right-side, 320px) ────────────────────────────────

function ThreadPanel({
	rootPostId,
	me,
	usersById,
	onClose,
}: {
	rootPostId: string;
	me?: MmUser;
	usersById: Map<string, MmUser>;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [reply, setReply] = useState("");
	const threadRef = useRef<HTMLDivElement | null>(null);

	const threadQuery = useQuery({
		queryKey: ["native-chat", "thread", rootPostId],
		refetchInterval: 5_000,
		retry: false,
		queryFn: () =>
			chatFetch<MmPostList>(`/api/chat/posts/${rootPostId}/thread`),
	});

	const threadPosts = useMemo(
		() => threadOrderedPosts(threadQuery.data),
		[threadQuery.data],
	);

	useEffect(() => {
		const node = threadRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [threadPosts.length]);

	const sendReply = useMutation({
		mutationFn: (message: string) =>
			chatFetch<MmPost>(`/api/chat/posts/${rootPostId}/thread`, {
				method: "POST",
				body: JSON.stringify({ message }),
			}),
		onSuccess: async () => {
			setReply("");
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "thread", rootPostId],
			});
			// reply_count on the root post changes — refresh the channel feed too.
			await queryClient.invalidateQueries({
				queryKey: ["native-chat", "posts"],
			});
		},
	});

	function submitReply() {
		const message = reply.trim();
		if (!message || sendReply.isPending) return;
		sendReply.mutate(message);
	}

	return (
		<aside className="flex w-80 min-w-[320px] flex-col border-l border-slate-200 bg-white">
			<header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
				<h3 className="text-sm font-semibold text-slate-900">Thread</h3>
				<button
					type="button"
					aria-label="Close thread"
					onClick={onClose}
					className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
				>
					<X size={16} />
				</button>
			</header>

			<div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
				{threadQuery.isLoading ? (
					<div className="flex items-center gap-2 text-sm text-slate-500">
						<Loader2 className="animate-spin" size={15} />
						Loading thread
					</div>
				) : threadQuery.error ? (
					<div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
						{(threadQuery.error as Error).message}
					</div>
				) : (
					threadPosts.map((post) => {
						const legacyName = parrotAuthor(post);
						const mine = legacyName
							? isParrotAuthoredBy(post, me)
							: post.user_id === me?.id;
						const author = legacyName || displayName(usersById.get(post.user_id));
						return (
							<div key={post.id}>
								<div className="flex flex-wrap items-baseline gap-x-2">
									<span className="text-sm font-semibold text-slate-900">
										{mine ? "You" : author}
									</span>
									<span className="text-xs text-slate-400">
										{formatMessageTime(post.create_at)}
									</span>
									{isEdited(post) && (
										<span className="text-[10px] text-slate-400">
											(edited)
										</span>
									)}
								</div>
								<p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
									{post.message || "(attachment)"}
								</p>
							</div>
						);
					})
				)}
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					submitReply();
				}}
				className="border-t border-slate-200 p-3"
			>
				<div className="flex items-end gap-2">
					<textarea
						value={reply}
						onChange={(e) => setReply(e.target.value)}
						disabled={sendReply.isPending}
						rows={2}
						placeholder="Reply…"
						className="min-h-[40px] flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-5 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submitReply();
							}
						}}
					/>
					<button
						type="submit"
						disabled={!reply.trim() || sendReply.isPending}
						title="Send reply"
						className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
					>
						{sendReply.isPending ? (
							<Loader2 className="animate-spin" size={16} />
						) : (
							<Send size={16} />
						)}
					</button>
				</div>
				{sendReply.error && (
					<p className="mt-2 text-xs text-rose-600">
						{(sendReply.error as Error).message}
					</p>
				)}
			</form>
		</aside>
	);
}

// ─── New-DM user picker dialog (Wave 2, plan 31-03) ──────────────────

function NewDmDialog({
	pending,
	error,
	onClose,
	onSubmit,
}: {
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (kind: "direct" | "group", userIds: string[]) => void;
}) {
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<string[]>([]);

	const membersQuery = useQuery({
		queryKey: ["native-chat", "team-members"],
		staleTime: 60_000,
		retry: false,
		queryFn: () => chatFetch<MmUser[]>("/api/chat/team-members"),
	});

	const members = useMemo(() => {
		const list = membersQuery.data ?? [];
		const q = search.trim().toLowerCase();
		const filtered = q
			? list.filter((u) =>
					mmUserDisplayName(u).toLowerCase().includes(q) ||
					(u.username ?? "").toLowerCase().includes(q),
				)
			: list;
		return [...filtered].sort((a, b) =>
			mmUserDisplayName(a).localeCompare(mmUserDisplayName(b)),
		);
	}, [membersQuery.data, search]);

	function toggle(id: string) {
		setSelected((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	}

	const canDirect = selected.length === 1;
	const canGroup = selected.length >= 2;

	return (
		<>
			<button
				type="button"
				aria-label="Close dialog"
				onClick={onClose}
				className="fixed inset-0 z-40 bg-black/30"
			/>
			<div
				role="dialog"
				aria-label="New direct message"
				className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
			>
				<div className="flex items-center justify-between">
					<h3 className="text-base font-semibold text-slate-900">
						New message
					</h3>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
					>
						<X size={16} />
					</button>
				</div>

				<div className="relative mt-4">
					<Search
						size={15}
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
					/>
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search people…"
						autoFocus
						className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
					/>
				</div>

				<div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-slate-100">
					{membersQuery.isLoading ? (
						<div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
							<Loader2 className="animate-spin" size={15} />
							Loading people
						</div>
					) : membersQuery.error ? (
						<p className="px-3 py-4 text-sm text-rose-600">
							{(membersQuery.error as Error).message}
						</p>
					) : members.length === 0 ? (
						<p className="px-3 py-4 text-sm text-slate-400">
							No teammates found.
						</p>
					) : (
						members.map((user) => {
							const name = mmUserDisplayName(user);
							const checked = selected.includes(user.id);
							return (
								<label
									key={user.id}
									className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50"
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggle(user.id)}
										className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
									/>
									<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
										{initials(name)}
									</span>
									<span className="min-w-0">
										<span className="block truncate font-medium text-slate-800">
											{name}
										</span>
										{user.username && (
											<span className="block truncate text-xs text-slate-400">
												@{user.username}
											</span>
										)}
									</span>
								</label>
							);
						})
					)}
				</div>

				{error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

				<div className="mt-4 flex items-center justify-between">
					<span className="text-xs text-slate-400">
						{selected.length} selected
					</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => canDirect && onSubmit("direct", selected)}
							disabled={!canDirect || pending}
							title={
								canDirect
									? "Open a direct message"
									: "Select exactly one person for a direct message"
							}
							className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{pending && canDirect && (
								<Loader2 className="animate-spin" size={14} />
							)}
							Direct Message
						</button>
						<button
							type="button"
							onClick={() => canGroup && onSubmit("group", selected)}
							disabled={!canGroup || pending}
							title={
								canGroup
									? "Open a group DM"
									: "Select 2 or more people for a group DM"
							}
							className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{pending && canGroup && (
								<Loader2 className="animate-spin" size={14} />
							)}
							Group DM
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

// ─── Create-channel dialog ───────────────────────────────────────────

function CreateChannelDialog({
	allowPrivate,
	pending,
	error,
	onClose,
	onSubmit,
}: {
	allowPrivate: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (input: { name: string; display_name: string; type: "O" | "P" }) => void;
}) {
	const [displayNameInput, setDisplayNameInput] = useState("");
	const [nameTouched, setNameTouched] = useState(false);
	const [nameInput, setNameInput] = useState("");
	const [type, setType] = useState<"O" | "P">("O");

	// Auto-slugify the name from the display name until the user edits it.
	const name = nameTouched ? nameInput : slugify(displayNameInput);

	function submit(e: FormEvent) {
		e.preventDefault();
		const slug = slugify(name);
		const display = displayNameInput.trim();
		if (!slug || !display || pending) return;
		onSubmit({ name: slug, display_name: display, type });
	}

	return (
		<>
			<button
				type="button"
				aria-label="Close dialog"
				onClick={onClose}
				className="fixed inset-0 z-40 bg-black/30"
			/>
			<div
				role="dialog"
				aria-label="Create channel"
				className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
			>
				<div className="flex items-center justify-between">
					<h3 className="text-base font-semibold text-slate-900">New channel</h3>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
					>
						<X size={16} />
					</button>
				</div>

				<form onSubmit={submit} className="mt-4 space-y-3">
					<div>
						<label className="block text-xs font-medium text-slate-600">
							Channel name
						</label>
						<input
							value={displayNameInput}
							onChange={(e) => setDisplayNameInput(e.target.value)}
							placeholder="Marketing Team"
							autoFocus
							className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-slate-600">
							URL slug
						</label>
						<input
							value={name}
							onChange={(e) => {
								setNameTouched(true);
								setNameInput(slugify(e.target.value));
							}}
							placeholder="marketing-team"
							className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-slate-600">
							Visibility
						</label>
						<div className="mt-1 flex gap-2">
							<button
								type="button"
								onClick={() => setType("O")}
								className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
									type === "O"
										? "border-slate-900 bg-slate-900 text-white"
										: "border-slate-200 text-slate-600 hover:bg-slate-50"
								}`}
							>
								<Hash size={14} /> Public
							</button>
							<button
								type="button"
								onClick={() => allowPrivate && setType("P")}
								disabled={!allowPrivate}
								title={
									allowPrivate
										? "Private channel"
										: "Private channels are operator-only"
								}
								className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
									type === "P"
										? "border-slate-900 bg-slate-900 text-white"
										: "border-slate-200 text-slate-600 hover:bg-slate-50"
								}`}
							>
								<Lock size={14} /> Private
							</button>
						</div>
						{!allowPrivate && (
							<p className="mt-1 text-[11px] text-slate-400">
								Only operators can create private channels.
							</p>
						)}
					</div>

					{error && <p className="text-xs text-rose-600">{error}</p>}

					<div className="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!displayNameInput.trim() || !slugify(name) || pending}
							className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
						>
							{pending && <Loader2 className="animate-spin" size={14} />}
							Create
						</button>
					</div>
				</form>
			</div>
		</>
	);
}
