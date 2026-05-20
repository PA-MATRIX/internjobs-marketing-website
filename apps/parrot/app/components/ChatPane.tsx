// v1.3.1: ChatPane — native Parrot chat surface backed by Mattermost.
//
// Mattermost remains the source of truth for teams, channels, posts, and
// durable message storage. Parrot owns the user-facing session boundary:
// this component only calls /api/chat/* with the Clerk-backed Workspace
// session, and the Worker talks to Mattermost internally.

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	Hash,
	Loader2,
	RefreshCw,
	Send,
} from "lucide-react";
import { ChatToEmail } from "./crosspane/ChatToEmail";
import { StartMeeting } from "./crosspane/StartMeeting";
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
}

interface MmPost {
	id: string;
	channel_id: string;
	user_id: string;
	message: string;
	create_at: number;
	update_at?: number;
	root_id?: string;
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

async function chatFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
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
			| { message?: string; error?: string }
			| null;
		throw new ChatApiError(
			res.status,
			body?.message || body?.error || `Chat request failed (${res.status})`,
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

function formatMessageTime(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

export function ChatPane() {
	const queryClient = useQueryClient();
	const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);

	const bootstrap = useQuery({
		queryKey: ["native-chat", "bootstrap"],
		retry: false,
		queryFn: async (): Promise<BootstrapData> => {
			const data = await chatFetch<BootstrapData>("/api/chat/bootstrap");
			return { ...data, channels: sortChannels(data.channels) };
		},
	});

	const channels = bootstrap.data?.channels ?? [];
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

	const posts = useMemo(() => orderedPosts(postsQuery.data), [postsQuery.data]);
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

	function submitDraft() {
		const message = draft.trim();
		if (!message || !activeId || sendMessage.isPending) return;
		sendMessage.mutate(message);
	}

	function onSubmit(e: FormEvent) {
		e.preventDefault();
		submitDraft();
	}

	if (bootstrap.isLoading) {
		return (
			<div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
				<Loader2 className="mr-2 animate-spin" size={16} />
				Loading chat
			</div>
		);
	}

	if (bootstrap.error) {
		const err = bootstrap.error as Error;
		return (
			<div className="flex h-full items-center justify-center bg-slate-50 p-4">
				<div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex items-start gap-3">
						<AlertCircle className="mt-0.5 text-slate-400" size={18} />
						<div>
							<h2 className="text-sm font-semibold text-slate-900">
								Chat is unavailable
							</h2>
							<p className="mt-1 text-sm text-slate-500">
								{err.message}
							</p>
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
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-slate-50">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-slate-900">
						{bootstrap.data?.team.display_name || "InternJobs"}
					</p>
					<p className="truncate text-xs text-slate-500">
						Signed in as {displayName(bootstrap.data?.me)}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ChatToEmail
						postId={selectedPost?.id ?? ""}
						postBody={selectedPost?.message ?? ""}
					/>
					<StartMeeting />
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
				<aside className="min-h-0 border-b border-slate-200 bg-white md:border-r md:border-b-0">
					<div className="border-b border-slate-100 px-4 py-3">
						<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
							Channels
						</p>
					</div>
					<nav className="flex max-h-44 gap-1 overflow-auto p-2 md:max-h-none md:flex-col">
						{channels.map((channel) => {
							const active = channel.id === activeId;
							return (
								<button
									key={channel.id}
									type="button"
									onClick={() => {
										setActiveChannelId(channel.id);
										setSelectedPostId(null);
									}}
									className={`flex min-w-[180px] items-center gap-2 rounded-md px-3 py-2 text-left text-sm md:min-w-0 ${
										active
											? "bg-slate-900 text-white"
											: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
									}`}
								>
									<Hash size={15} className="shrink-0" />
									<span className="truncate">{channelLabel(channel)}</span>
								</button>
							);
						})}
					</nav>
				</aside>

				<section className="flex min-h-0 flex-col">
					<div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
						<div className="min-w-0">
							<h2 className="truncate text-sm font-semibold text-slate-900">
								#{activeChannel ? channelLabel(activeChannel) : "channel"}
							</h2>
						</div>
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
								const mine =
									post.user_id === bootstrap.data?.me.id ||
									isParrotAuthoredBy(post, bootstrap.data?.me);
								const selected = post.id === selectedPost?.id;
								const author =
									parrotAuthor(post) || displayName(usersById.get(post.user_id));
								return (
									<button
										key={post.id}
										type="button"
										onClick={() => setSelectedPostId(post.id)}
										className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
											selected
												? "bg-white ring-1 ring-slate-300"
												: "hover:bg-white/80"
										}`}
									>
										<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
											<span className="text-sm font-semibold text-slate-900">
												{mine ? "You" : author}
											</span>
											<span className="text-xs text-slate-400">
												{formatMessageTime(post.create_at)}
											</span>
										</div>
										<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
											{post.message || "(attachment)"}
										</p>
									</button>
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
			</div>
		</div>
	);
}
