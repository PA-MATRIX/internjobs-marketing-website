// v1.2 Phase 10 Wave 2b: WorkspaceShell — Slack-style dual-rail layout.
//
// Three columns:
//   1. Icon rail (~72px): compact pane switcher with lucide SVG icons.
//      Active pane highlighted, others greyed.
//   2. Secondary nav (~240px): per-pane sidebar — provided by each pane
//      via the `secondaryNav` prop.
//   3. Main content: the active pane's primary surface.

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type LucideIcon,
	LayoutDashboard,
	Mail,
	MessageSquare,
	Video,
	Phone,
	MessageCircle,
	Shield,
	Settings,
	Bell,
	X,
} from "lucide-react";
import { UserMenu } from "./UserMenu";
import { useCurrentEmployee } from "~/lib/auth";
import { api, apiFetch, type NotificationItem } from "~/lib/api";

interface NavItem {
	href: string;
	label: string;
	Icon: LucideIcon;
}

const NAV: NavItem[] = [
	{ href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
	{ href: "/inbox", label: "Email", Icon: Mail },
	{ href: "/chat", label: "Chat", Icon: MessageSquare },
	{ href: "/meetings", label: "Meetings", Icon: Video },
	// v1.2 Phase 12 Wave 1: Phone + SMS placeholders (seam, not integration).
	// Routes render a "Coming soon — Telnyx via Cloudflare Agents SDK" card.
	// Telephony backend lands in v1.3+ (see apps/parrot/app/routes/phone.tsx).
	{ href: "/phone", label: "Phone", Icon: Phone },
	{ href: "/sms", label: "SMS", Icon: MessageCircle },
];

const ADMIN_NAV: NavItem[] = [
	{ href: "/admin", label: "Admin", Icon: Settings },
	// v1.3 SAFETY-BADGE-01: Safety screening log + red-dot badge for unreviewed flags.
	{ href: "/ops/safety", label: "Safety", Icon: Shield },
];

export interface WorkspaceShellProps {
	children: ReactNode;
	/** Per-pane secondary sidebar (folders for Email, channels for Chat, …). */
	secondaryNav?: ReactNode;
	/** Page heading shown above the main content. */
	title?: string;
}

export function WorkspaceShell({
	children,
	secondaryNav,
	title,
}: WorkspaceShellProps) {
	const location = useLocation();
	const { data: me } = useCurrentEmployee();
	const [drawerOpen, setDrawerOpen] = useState(false);

	// Phase 13 Wave 1: register the push service worker once on mount.
	// The actual push opt-in lives in the onboarding wizard (Plan 13-03);
	// here we just ensure the SW is installed so the wizard can call
	// PushManager.subscribe() without an additional install round-trip.
	useEffect(() => {
		if (typeof navigator === "undefined") return;
		if (!("serviceWorker" in navigator)) return;
		navigator.serviceWorker
			.register("/sw.js", { scope: "/" })
			.catch((err) => console.warn("SW registration failed:", err));
	}, []);

	// Phase 13 Wave 1: poll notifications every 30s for the bell badge.
	const { data: notifData } = useQuery({
		queryKey: ["notifications"],
		queryFn: () => api.getNotifications(20),
		refetchInterval: 30_000,
		// Don't error-spam the console when unauthenticated routes are visited.
		retry: false,
	});
	const unread = notifData?.unread ?? 0;

	// v1.3 SAFETY-BADGE-01: poll unreviewed safety flag count every 60s.
	// Less frequent than notifications since safety flags are rare. Red dot
	// shows on the Safety nav item when any unreviewed flag exists within
	// the last 24h (server-side filter — see /api/ops/safety/unreviewed-count).
	const { data: safetyData } = useQuery({
		queryKey: ["safety-unreviewed"],
		queryFn: () =>
			apiFetch("/api/ops/safety/unreviewed-count").then(
				(r) => r.json() as Promise<{ count: number }>,
			),
		refetchInterval: 60_000,
		retry: false,
	});
	const safetyUnreviewed = safetyData?.count ?? 0;

	const activePane = NAV.find((item) =>
		location.pathname.startsWith(item.href),
	);
	const activeLabel = title || activePane?.label || "Parrot";

	return (
		<div className="flex h-screen bg-slate-50 text-slate-900">
			{/* ─── Column 1: Icon rail ──────────────────────────────────── */}
			<aside className="flex w-[76px] flex-col items-center border-r border-slate-800 bg-slate-900">
				<Link
					to="/"
					title="Parrot"
					className="mt-3 mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-900 text-lg font-black no-underline hover:scale-105 transition-transform"
				>
					∞
				</Link>
				<div className="w-10 border-b border-white/10 mb-2" />

				<nav className="flex-1 w-full">
					<ul className="flex flex-col items-center gap-1 mt-1">
						{NAV.map((item) => {
							const active = location.pathname.startsWith(item.href);
							return (
								<li key={item.href} className="relative w-full flex justify-center">
									{/* Thin colored indicator bar on the active item */}
									{active && (
										<span
											aria-hidden="true"
											className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r bg-white"
										/>
									)}
									<Link
										to={item.href}
										title={item.label}
										className={`group flex flex-col items-center justify-center gap-0.5 w-[60px] h-[60px] rounded-xl no-underline transition-all duration-150 ${
											active
												? "bg-white text-slate-900 shadow-lg shadow-black/20"
												: "text-slate-400 hover:bg-white/10 hover:text-white"
										}`}
									>
										<item.Icon size={20} strokeWidth={active ? 2.5 : 2} />
										<span className="text-[10px] font-semibold leading-none mt-1">
											{item.label}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>

					{me?.role === "operator" && (
						<>
							<div className="mt-4 mx-4 border-t border-white/10" />
							<ul className="flex flex-col items-center gap-1 mt-3">
								{ADMIN_NAV.map((item) => {
									const active = location.pathname.startsWith(item.href);
									// SAFETY-BADGE-01: red dot on the Safety item when unreviewed flags exist
									const showBadge =
										item.href === "/ops/safety" && safetyUnreviewed > 0;
									return (
										<li key={item.href} className="relative">
											<Link
												to={item.href}
												title={item.label}
												className={`relative flex flex-col items-center justify-center gap-0.5 w-[60px] h-[60px] rounded-xl no-underline transition-all ${
													active
														? "bg-white text-slate-900 shadow-lg shadow-black/20"
														: "text-slate-400 hover:bg-white/10 hover:text-white"
												}`}
											>
												<item.Icon size={20} strokeWidth={active ? 2.5 : 2} />
												<span className="text-[10px] font-semibold leading-none mt-1">
													{item.label}
												</span>
												{showBadge && (
													<span
														aria-hidden="true"
														className="absolute top-1 right-1 inline-flex h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900"
													/>
												)}
											</Link>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</nav>

				<div className="mb-3">
					<UserMenu />
				</div>
			</aside>

			{/* ─── Column 2: Secondary nav (per-pane "unfold") ──────────── */}
			{secondaryNav && (
				<aside className="hidden md:flex w-60 flex-col border-r border-slate-200 bg-white">
					<div className="px-5 py-4 border-b border-slate-200">
						<h2 className="text-base font-semibold text-slate-900">
							{activeLabel}
						</h2>
					</div>
					<div className="flex-1 overflow-auto">{secondaryNav}</div>
				</aside>
			)}

			{/* ─── Column 3: Main content ────────────────────────────────── */}
			<div className="flex-1 flex flex-col min-w-0">
				<header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
					<h1 className="text-base font-semibold truncate">{activeLabel}</h1>
					<div className="flex items-center gap-3">
						<input
							type="search"
							placeholder="Search"
							disabled
							className="hidden md:block w-64 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 disabled:cursor-not-allowed"
						/>
						{/* Phase 13 Wave 1: notification bell. Red dot when unread > 0. */}
						<button
							type="button"
							aria-label={
								unread > 0
									? `Notifications (${unread} unread)`
									: "Notifications"
							}
							onClick={() => setDrawerOpen((v) => !v)}
							className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
						>
							<Bell size={18} strokeWidth={2} />
							{unread > 0 && (
								<span
									aria-hidden="true"
									className="absolute top-1 right-1 inline-flex h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white"
								/>
							)}
						</button>
					</div>
				</header>
				<main className="flex-1 min-h-0 overflow-auto">{children}</main>
			</div>

			{/* Phase 13 Wave 1: notification drawer. Mounted at the shell level
			    so it overlays whichever pane is active. */}
			<NotificationDrawer
				open={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				items={notifData?.notifications ?? []}
			/>
		</div>
	);
}

// ─── Notification drawer (Phase 13 Wave 1) ───────────────────────────

interface NotificationDrawerProps {
	open: boolean;
	onClose: () => void;
	items: NotificationItem[];
}

const EVENT_ICON = {
	urgent_todo: Bell,
	starred_email: Mail,
	chat_mention: MessageSquare,
} as const;

function relativeTime(iso: string): string {
	const then = new Date(iso + "Z".replace(/Z+$/, "Z")).getTime();
	// SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (UTC, no Z).
	// new Date() with that string is interpreted as local in some browsers;
	// be defensive and re-parse if NaN.
	const ts = Number.isFinite(then)
		? then
		: new Date(iso.replace(" ", "T") + "Z").getTime();
	const deltaMs = Date.now() - ts;
	const sec = Math.max(0, Math.round(deltaMs / 1000));
	if (sec < 60) return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const days = Math.round(hr / 24);
	return `${days}d ago`;
}

function NotificationDrawer({ open, onClose, items }: NotificationDrawerProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const markRead = useMutation({
		mutationFn: (ids?: string[]) => api.markNotificationsRead(ids),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	// On open, mark all unread as read after a short delay (lets the user
	// see the unread highlight first). Bell badge clears on success.
	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => {
			if (items.some((n) => n.read === 0)) {
				markRead.mutate(undefined);
			}
		}, 600);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	if (!open) return null;

	return (
		<>
			{/* Click-off backdrop (transparent — doesn't dim the page) */}
			<button
				type="button"
				aria-label="Close notifications"
				onClick={onClose}
				className="fixed inset-0 z-40 bg-transparent"
			/>
			<aside
				className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-slate-200 bg-white shadow-2xl"
				role="dialog"
				aria-label="Notifications"
			>
				<header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
					<h2 className="text-sm font-semibold text-slate-900">
						Notifications
					</h2>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => markRead.mutate(undefined)}
							className="text-xs font-medium text-slate-500 hover:text-slate-900"
						>
							Mark all read
						</button>
						<button
							type="button"
							aria-label="Close"
							onClick={onClose}
							className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
						>
							<X size={16} />
						</button>
					</div>
				</header>

				<div className="flex-1 overflow-auto">
					{items.length === 0 ? (
						<p className="px-4 py-6 text-sm text-slate-400">
							No notifications yet.
						</p>
					) : (
						<ul className="divide-y divide-slate-100">
							{items.map((n) => {
								const Icon = EVENT_ICON[n.event_type] ?? Bell;
								const isUnread = n.read === 0;
								return (
									<li key={n.id}>
										<button
											type="button"
											onClick={() => {
												markRead.mutate([n.id]);
												if (n.url) navigate(n.url);
												onClose();
											}}
											className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
												isUnread
													? "bg-sky-50/60 hover:bg-sky-50"
													: "hover:bg-slate-50"
											}`}
										>
											<span
												className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
													n.event_type === "urgent_todo"
														? "bg-rose-100 text-rose-600"
														: n.event_type === "starred_email"
															? "bg-violet-100 text-violet-600"
															: "bg-sky-100 text-sky-600"
												}`}
												aria-hidden="true"
											>
												<Icon size={14} />
											</span>
											<span className="min-w-0 flex-1">
												<span className="flex items-center gap-2">
													<span className="truncate text-sm font-medium text-slate-900">
														{n.title}
													</span>
													{isUnread && (
														<span
															aria-hidden="true"
															className="h-2 w-2 flex-shrink-0 rounded-full bg-sky-500"
														/>
													)}
												</span>
												{n.body && (
													<span className="mt-0.5 block truncate text-xs text-slate-500">
														{n.body}
													</span>
												)}
												<span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
													{relativeTime(n.created_at)}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</aside>
		</>
	);
}

/**
 * Reusable sidebar list-item used by per-pane secondary navs.
 */
export function SecondaryNavItem({
	href,
	active,
	icon,
	label,
	count,
}: {
	href: string;
	active?: boolean;
	icon?: ReactNode;
	label: string;
	count?: number;
}) {
	return (
		<Link
			to={href}
			className={`flex items-center justify-between gap-2 px-4 py-2 text-sm no-underline transition-colors ${
				active
					? "bg-slate-100 text-slate-900 font-semibold"
					: "text-slate-600 hover:bg-slate-50"
			}`}
		>
			<span className="flex items-center gap-2 min-w-0">
				{icon && <span className="text-slate-400 flex-shrink-0">{icon}</span>}
				<span className="truncate">{label}</span>
			</span>
			{typeof count === "number" && count > 0 && (
				<span className="text-[10px] font-bold text-slate-400">{count}</span>
			)}
		</Link>
	);
}
