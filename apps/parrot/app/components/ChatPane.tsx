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
	Hash,
	Loader2,
	Lock,
	MessageSquare,
	Pencil,
	Pin,
	Plus,
	RefreshCw,
	Reply,
	Send,
	Trash2,
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
}

interface MmPost {
	id: string;
	channel_id: string;
	user_id: string;
	message: string;
	create_at: number;
	update_at?: number;
	root_id?: string;
	reply_count?: number;
	props?: Record<string, unknown>;
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

export function ChatPane({ isOperator = false }: { isOperator?: boolean }) {
	const queryClient = useQueryClient();
	const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
	const [threadPanelPostId, setThreadPanelPostId] = useState<string | null>(null);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editingPostId, setEditingPostId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState("");
	const [pinToast, setPinToast] = useState<string | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);

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
	const activeChannel =
		channels.find((channel) => channel.id === activeChannelId) ?? channels[0];
	const activeId = activeChannel?.id ?? null;

	useEffect(() => {
		if (!activeChannelId && channels[0]) {
			setActiveChannelId(channels[0].id);
		}
	}, [activeChannelId, channels]);

	const postsQuery = useQuery({
		queryKey: ["native-chat", "posts", activeId],
		enabled: Boolean(activeId),
		refetchInterval: 5_000,
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

	const sendMessage = useMutation({
		mutationFn: (message: string) =>
			chatFetch<MmPost>("/api/chat/posts", {
				method: "POST",
				body: JSON.stringify({ channel_id: activeId, message }),
			}),
		onSuccess: async () => {
			setDraft("");
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

	function submitDraft() {
		const message = draft.trim();
		if (!message || !activeId || sendMessage.isPending) return;
		sendMessage.mutate(message);
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

	// ── Secondary nav: the channel browser rail ──────────────────────
	const secondaryNav: ReactNode = (
		<div className="flex h-full flex-col">
			<div className="flex-1 overflow-auto py-1">
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
								onClick={() => {
									setActiveChannelId(channel.id);
									setSelectedPostId(null);
									setThreadPanelPostId(null);
								}}
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
								{channel.has_unreads && (
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
							#{activeChannel ? channelLabel(activeChannel) : "channel"}
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
												{post.update_at && post.update_at > post.create_at && (
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
												<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
													{post.message || "(attachment)"}
												</p>
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

											{/* Hover action row */}
											{!editing && (
												<div className="absolute right-2 top-1 hidden items-center gap-0.5 rounded-md border border-slate-200 bg-white px-0.5 py-0.5 shadow-sm group-hover:flex">
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

						<form
							onSubmit={onSubmit}
							className="border-t border-slate-200 bg-white p-3 sm:p-4"
						>
							<div className="flex items-end gap-2">
								<textarea
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									disabled={!activeId || sendMessage.isPending}
									rows={2}
									placeholder={
										activeChannel
											? `Message #${channelLabel(activeChannel)}`
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
									disabled={!draft.trim() || !activeId || sendMessage.isPending}
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
			</div>
		);
	}

	return <WorkspaceShell title="Chat" secondaryNav={secondaryNav}>{body}</WorkspaceShell>;
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
