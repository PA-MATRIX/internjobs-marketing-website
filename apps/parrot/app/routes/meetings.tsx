// v1.2 Phase 11 Wave 2: /meetings route — Daily.co embed.
//
// Replaces the Phase 10 Wave 2b placeholder. The route owns the
// secondary-nav (Your room / Active rooms / History) and threads the
// active tab into MeetingsPane via the ?tab= query param. MeetingsPane
// renders the actual tab content (DailyProvider + iframe embed for
// "Your room"; list of active rooms; history placeholder).
//
// Skills referenced:
//   cloudflare/skills: durable-objects — personal room read from
//     EmployeeMailboxDO via GET /api/meetings/my-room.

import { Clock, Users, Video } from "lucide-react";
import { useSearchParams } from "react-router";
import { MeetingsPane, type MeetingsTab } from "~/components/MeetingsPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

function isMeetingsTab(value: string | null): value is MeetingsTab {
	return value === "your-room" || value === "active" || value === "history";
}

function MeetingsSecondaryNav({ activeTab }: { activeTab: MeetingsTab }) {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Meetings
			</p>
			<SecondaryNavItem
				href="/meetings?tab=your-room"
				active={activeTab === "your-room"}
				label="Your room"
				icon={<Video size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings?tab=active"
				active={activeTab === "active"}
				label="Active rooms"
				icon={<Users size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings?tab=history"
				active={activeTab === "history"}
				label="History"
				icon={<Clock size={15} />}
			/>
		</nav>
	);
}

export default function MeetingsRoute() {
	const [searchParams] = useSearchParams();
	const tabParam = searchParams.get("tab");
	const activeTab: MeetingsTab = isMeetingsTab(tabParam) ? tabParam : "your-room";

	return (
		<WorkspaceShell
			title="Meetings"
			secondaryNav={<MeetingsSecondaryNav activeTab={activeTab} />}
		>
			<MeetingsPane activeTab={activeTab} />
		</WorkspaceShell>
	);
}
