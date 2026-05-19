// v1.2 Phase 10 Wave 2b: WorkspaceShell — Slack-style dual-rail layout.
//
// Three columns:
//   1. Icon rail (~72px): compact pane switcher with lucide SVG icons.
//      Active pane highlighted, others greyed.
//   2. Secondary nav (~240px): per-pane sidebar — provided by each pane
//      via the `secondaryNav` prop.
//   3. Main content: the active pane's primary surface.

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import {
	type LucideIcon,
	LayoutDashboard,
	Mail,
	MessageSquare,
	Video,
	UserPlus,
} from "lucide-react";
import { UserMenu } from "./UserMenu";
import { useCurrentEmployee } from "~/lib/auth";

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
];

const ADMIN_NAV: NavItem[] = [
	{ href: "/admin/invite", label: "Invite", Icon: UserPlus },
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
									return (
										<li key={item.href}>
											<Link
												to={item.href}
												title={item.label}
												className={`flex flex-col items-center justify-center gap-0.5 w-[60px] h-[60px] rounded-xl no-underline transition-all ${
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
