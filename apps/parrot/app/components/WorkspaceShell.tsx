// v1.2 Phase 10 Wave 2b: WorkspaceShell — Slack-style dual-rail layout.
//
// Three columns:
//   1. Icon rail (~72px): compact pane switcher with icons + labels.
//      Active pane is highlighted, others greyed out.
//   2. Secondary nav (~240px): per-pane sidebar — provided by each pane
//      via the `secondaryNav` prop. Email gets folders, Chat gets
//      Mattermost's channel list, etc. "Unfolds" when the pane is
//      active (just a layout consequence of the active pane mounting
//      its own secondaryNav).
//   3. Main content: the active pane's primary surface.
//
// Per user-locked decisions: pane names are plain "Dashboard / Email /
// Chat / Meetings".

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useCurrentEmployee } from "~/lib/auth";

interface NavItem {
	href: string;
	label: string;
	icon: string;
}

const NAV: NavItem[] = [
	{ href: "/dashboard", label: "Dashboard", icon: "◎" },
	{ href: "/inbox", label: "Email", icon: "✉" },
	{ href: "/chat", label: "Chat", icon: "💬" },
	{ href: "/meetings", label: "Meetings", icon: "🎥" },
];

const ADMIN_NAV: NavItem[] = [
	{ href: "/admin/invite", label: "Invite", icon: "+" },
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

	const activePane = NAV.find((item) =>
		location.pathname.startsWith(item.href),
	);
	const activeLabel = title || activePane?.label || "Parrot";

	const initial = (me?.display_name || me?.email || "?")
		.trim()
		.charAt(0)
		.toUpperCase();

	return (
		<div className="flex min-h-screen bg-slate-50 text-slate-900">
			{/* ─── Column 1: Icon rail ──────────────────────────────────── */}
			<aside className="flex w-[72px] flex-col items-center border-r border-slate-200 bg-slate-900">
				<Link
					to="/"
					className="mt-3 mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-900 text-base font-black no-underline"
					title="Parrot"
				>
					∞
				</Link>
				<nav className="flex-1 w-full">
					<ul className="flex flex-col items-center gap-1 mt-3">
						{NAV.map((item) => {
							const active = location.pathname.startsWith(item.href);
							return (
								<li key={item.href}>
									<Link
										to={item.href}
										title={item.label}
										className={`flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-lg no-underline transition-colors ${
											active
												? "bg-white/15 text-white"
												: "text-slate-400 hover:bg-white/10 hover:text-slate-200"
										}`}
									>
										<span className="text-xl leading-none">{item.icon}</span>
										<span className="text-[10px] font-semibold leading-none">
											{item.label}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>

					{me?.role === "operator" && (
						<>
							<div className="mt-4 mx-3 border-t border-white/10" />
							<ul className="flex flex-col items-center gap-1 mt-3">
								{ADMIN_NAV.map((item) => {
									const active = location.pathname.startsWith(item.href);
									return (
										<li key={item.href}>
											<Link
												to={item.href}
												title={item.label}
												className={`flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-lg no-underline transition-colors ${
													active
														? "bg-white/15 text-white"
														: "text-slate-400 hover:bg-white/10 hover:text-slate-200"
												}`}
											>
												<span className="text-xl leading-none">{item.icon}</span>
												<span className="text-[10px] font-semibold leading-none">
													{item.label}
												</span>
											</Link>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</nav>
				<div
					title={me?.email}
					className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-900"
				>
					{initial}
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
					<input
						type="search"
						placeholder="Search (Wave 5)"
						disabled
						className="hidden md:block w-64 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 disabled:cursor-not-allowed"
					/>
				</header>
				<main className="flex-1 min-h-0 overflow-auto">{children}</main>
			</div>
		</div>
	);
}

/**
 * Reusable sidebar list-item used by per-pane secondary navs. Keeps
 * "Inbox / Sent / Drafts" in the Email pane visually consistent with
 * the channel list in Chat, etc.
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
	icon?: string;
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
				{icon && <span className="text-slate-400">{icon}</span>}
				<span className="truncate">{label}</span>
			</span>
			{typeof count === "number" && count > 0 && (
				<span className="text-[10px] font-bold text-slate-400">{count}</span>
			)}
		</Link>
	);
}
