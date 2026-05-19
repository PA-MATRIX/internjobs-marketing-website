// v1.2 Phase 10 Wave 2b: UserMenu — avatar + dropdown.
//
// Renders the small circular avatar in the bottom-left of the icon rail.
// On click, opens a popover with the employee's identity (name + email
// or phone + role), plus a Sign out action that hits Clerk and bounces
// back to /sign-in.

import { useClerk } from "@clerk/clerk-react";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { useCurrentEmployee } from "~/lib/auth";

export function UserMenu() {
	const { data: me } = useCurrentEmployee();
	const clerk = useClerk();
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const initial = (me?.display_name || me?.email || "?")
		.trim()
		.charAt(0)
		.toUpperCase();

	const identifier = me?.email || "";
	const isPhone = identifier.startsWith("+");
	const displayName = me?.display_name || (isPhone ? identifier : identifier.split("@")[0]);
	const role = me?.role === "operator" ? "Operator" : "Employee";

	useEffect(() => {
		if (!open) return;
		function onDocClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [open]);

	function handleSignOut() {
		clerk.signOut({ redirectUrl: "/sign-in" });
	}

	return (
		<div className="relative" ref={menuRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-900 hover:ring-2 hover:ring-white/30 transition-shadow"
				title={displayName}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				{initial}
			</button>

			{open && (
				<div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-30">
					<div className="px-4 py-3 border-b border-slate-100">
						<p className="text-sm font-semibold text-slate-900 truncate">
							{displayName}
						</p>
						<p className="text-xs text-slate-500 truncate">{identifier}</p>
						<span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
							{role}
						</span>
					</div>
					<nav className="py-1">
						<a
							href="/profile"
							className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 no-underline"
						>
							<UserIcon size={16} className="text-slate-400" />
							Profile
						</a>
						<a
							href="/settings"
							className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 no-underline"
						>
							<Settings size={16} className="text-slate-400" />
							Settings
						</a>
					</nav>
					<div className="border-t border-slate-100">
						<button
							type="button"
							onClick={handleSignOut}
							className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
						>
							<LogOut size={16} className="text-slate-400" />
							Sign out
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
