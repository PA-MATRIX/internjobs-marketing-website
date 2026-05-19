// v1.2 Phase 10 Wave 4 (planned): Dashboard pane — the workspace's
// landing surface and the whole point of Parrot.
//
// The "mothership agent" idea: a single per-employee LLM agent
// monitoring every channel (Email, Chat, Meetings, Phone/SMS, Daily.co
// recordings, …) and surfacing actionable todos across the entire
// stack. The Dashboard is where those todos render.
//
// This file is a stub — the real implementation lands in Phase 10
// Wave 4 (cross-pane actions). For now it just frames the shape so
// the nav item is live.

import { SecondaryNavItem, WorkspaceShell } from "../components/WorkspaceShell";

function DashboardSecondaryNav() {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Views
			</p>
			<SecondaryNavItem href="/dashboard" active label="All todos" icon="◎" />
			<SecondaryNavItem href="/dashboard" label="Mentions" icon="@" />
			<SecondaryNavItem href="/dashboard" label="Today" icon="•" />
			<SecondaryNavItem href="/dashboard" label="This week" icon="•" />
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Channels
			</p>
			<SecondaryNavItem href="/inbox" label="Email" icon="✉" />
			<SecondaryNavItem href="/chat" label="Chat" icon="💬" />
			<SecondaryNavItem href="/meetings" label="Meetings" icon="🎥" />
		</nav>
	);
}

export default function DashboardRoute() {
	return (
		<WorkspaceShell secondaryNav={<DashboardSecondaryNav />}>
			<div className="p-8 max-w-3xl mx-auto">
				<header className="mb-6">
					<h1 className="text-2xl font-semibold text-slate-900">
						Dashboard
					</h1>
					<p className="text-sm text-slate-600 mt-1">
						Your todos across email, chat, meetings, phone, and SMS —
						surfaced by your workspace agent.
					</p>
				</header>

				<section className="rounded-xl border border-slate-200 bg-white p-6">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
						Pending
					</h2>
					<p className="text-sm text-slate-600">
						Your agent is warming up. Once it ingests your channels you'll
						see ranked todos here:
					</p>
					<ul className="mt-3 text-sm text-slate-700 list-disc list-inside space-y-1.5">
						<li>Emails requiring a reply</li>
						<li>Chat threads with @mentions you haven't responded to</li>
						<li>Meeting follow-ups from Daily.co recordings</li>
						<li>SMS / phone-call action items</li>
						<li>Recurring tasks the agent has learned for you</li>
					</ul>
				</section>

				<section className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
					<p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
						Wave 4
					</p>
					<p className="text-sm text-slate-700 mt-2">
						Cross-channel todo surfacing ships in Phase 10 Wave 4.
					</p>
				</section>
			</div>
		</WorkspaceShell>
	);
}
