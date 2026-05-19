// v1.2 Phase 12 Wave 1: Dashboard pane — the workspace's landing surface.
// The "Dashboard Mothership Agent" monitors every channel (Email, Chat,
// Meetings, Phone/SMS) and surfaces actionable todos here.
//
// Wave 1 ships the scaffolding: secondary-nav views wired to `?view=` query
// params, the API call site to GET /api/dashboard/todos, and an empty-state
// card. Wave 2 lands the ingest pipeline so todos start populating. Wave 3
// polishes ranking + click-through navigation.

import {
	AtSign,
	CalendarCheck,
	CalendarRange,
	Hash,
	LayoutDashboard,
	Mail,
	MessageSquare,
	Sparkles,
	Video,
} from "lucide-react";
import { useSearchParams } from "react-router";
import {
	SecondaryNavItem,
	WorkspaceShell,
} from "../components/WorkspaceShell";

function DashboardSecondaryNav({ activeView }: { activeView: string }) {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Views
			</p>
			<SecondaryNavItem
				href="/dashboard"
				active={activeView === "all"}
				label="All todos"
				icon={<LayoutDashboard size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=mentions"
				active={activeView === "mentions"}
				label="Mentions"
				icon={<AtSign size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=today"
				active={activeView === "today"}
				label="Today"
				icon={<CalendarCheck size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=week"
				active={activeView === "week"}
				label="This week"
				icon={<CalendarRange size={15} />}
			/>
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Quick jump
			</p>
			<SecondaryNavItem href="/inbox" label="Email" icon={<Mail size={15} />} />
			<SecondaryNavItem
				href="/chat"
				label="Chat"
				icon={<MessageSquare size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings"
				label="Meetings"
				icon={<Video size={15} />}
			/>
		</nav>
	);
}

export default function DashboardRoute() {
	const [searchParams] = useSearchParams();
	const activeView = searchParams.get("view") ?? "all";

	return (
		<WorkspaceShell
			secondaryNav={<DashboardSecondaryNav activeView={activeView} />}
		>
			<div className="p-8 max-w-3xl mx-auto">
				<header className="mb-6">
					<h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
					<p className="text-sm text-slate-600 mt-1">
						Your todos across email, chat, meetings, phone, and SMS —
						surfaced by your workspace agent.
					</p>
				</header>

				<section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center gap-2 mb-3">
						<Sparkles
							size={16}
							className="text-violet-500"
							strokeWidth={2.5}
						/>
						<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
							Pending
						</h2>
					</div>
					<p className="text-sm text-slate-600">
						Your agent is warming up. Once it ingests your channels you'll
						see ranked todos here:
					</p>
					<ul className="mt-3 space-y-1.5 text-sm text-slate-700">
						<li className="flex items-start gap-2">
							<Hash size={14} className="text-slate-400 mt-0.5" />
							Emails requiring a reply
						</li>
						<li className="flex items-start gap-2">
							<Hash size={14} className="text-slate-400 mt-0.5" />
							Chat threads with @mentions you haven't responded to
						</li>
						<li className="flex items-start gap-2">
							<Hash size={14} className="text-slate-400 mt-0.5" />
							Meeting follow-ups from Daily.co recordings
						</li>
						<li className="flex items-start gap-2">
							<Hash size={14} className="text-slate-400 mt-0.5" />
							SMS / phone-call action items
						</li>
						<li className="flex items-start gap-2">
							<Hash size={14} className="text-slate-400 mt-0.5" />
							Recurring tasks the agent has learned for you
						</li>
					</ul>
				</section>

				<section className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
					<p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
						Phase 12
					</p>
					<p className="text-sm text-slate-700 mt-2">
						The Dashboard Mothership Agent ingests email + chat in Wave 2;
						ranked todos appear here once seeded.
					</p>
				</section>
			</div>
		</WorkspaceShell>
	);
}
