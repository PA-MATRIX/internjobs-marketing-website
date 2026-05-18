// v1.2 Phase 10 Wave 1: WorkspaceShell — sidebar nav + top bar.
//
// Three-pane chrome shared across the Inbox / Chat / Meetings routes.
// Per user-locked decisions in PLAN.md: submodule names are the plain
// "Inbox" / "Chat" / "Meetings" — not the cosmetic "Parrot Squawk" /
// "Parrot Roost" alternatives explored in Decision C.

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useCurrentEmployee } from "~/lib/auth";

interface NavItem {
	href: string;
	label: string;
}

const NAV: NavItem[] = [
	{ href: "/inbox", label: "Inbox" },
	{ href: "/chat", label: "Chat" },
	{ href: "/meetings", label: "Meetings" },
];

export interface WorkspaceShellProps {
	children: ReactNode;
	/** Optional override for the page heading shown in the top bar. */
	title?: string;
}

export function WorkspaceShell({ children, title }: WorkspaceShellProps) {
	const location = useLocation();
	const { data: me } = useCurrentEmployee();

	const activeLabel =
		title || NAV.find((item) => location.pathname.startsWith(item.href))?.label
		|| "Parrot";

	const initial = (me?.display_name || me?.email || "?")
		.trim()
		.charAt(0)
		.toUpperCase();

	return (
		<div className="flex min-h-screen bg-slate-50 text-slate-900">
			<aside className="hidden md:flex w-56 flex-col border-r border-slate-200 bg-white">
				<div className="px-5 py-4 border-b border-slate-200">
					<Link to="/" className="text-lg font-semibold no-underline text-slate-900">
						Parrot
					</Link>
					<p className="text-xs text-slate-500 mt-0.5">InternJobs workspace</p>
				</div>
				<nav className="flex-1 py-4">
					<ul className="space-y-1 px-3">
						{NAV.map((item) => {
							const active = location.pathname.startsWith(item.href);
							return (
								<li key={item.href}>
									<Link
										to={item.href}
										className={`block rounded-md px-3 py-2 text-sm no-underline transition-colors ${
											active
												? "bg-slate-900 text-white"
												: "text-slate-700 hover:bg-slate-100"
										}`}
									>
										{item.label}
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>
				<div className="border-t border-slate-200 px-3 py-3 text-xs text-slate-500">
					<p>Wave 1 scaffolding</p>
					<p className="mt-1">Mattermost &amp; Daily.co land in Waves 2–3.</p>
				</div>
			</aside>

			<div className="flex-1 flex flex-col min-w-0">
				<header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
					<div className="flex items-center gap-3 min-w-0">
						<h1 className="text-base font-semibold truncate">{activeLabel}</h1>
					</div>
					<div className="flex items-center gap-3">
						<input
							type="search"
							placeholder="Search (Wave 5)"
							disabled
							className="hidden md:block w-64 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 disabled:cursor-not-allowed"
						/>
						<div
							title={me?.email}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
						>
							{initial}
						</div>
					</div>
				</header>

				<main className="flex-1 min-h-0 overflow-auto">{children}</main>
			</div>
		</div>
	);
}
