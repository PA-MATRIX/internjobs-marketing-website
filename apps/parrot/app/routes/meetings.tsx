// v1.2 Phase 10 Wave 2b: /meetings route — Daily.co placeholder.

import { CalendarCheck, CalendarPlus, CalendarRange, Clapperboard, Play } from "lucide-react";
import { MeetingsPane } from "~/components/MeetingsPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

function MeetingsSecondaryNav() {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Meetings
			</p>
			<SecondaryNavItem
				href="/meetings"
				active
				label="Today"
				icon={<CalendarCheck size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings"
				label="Upcoming"
				icon={<CalendarRange size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings"
				label="Recordings"
				icon={<Clapperboard size={15} />}
			/>
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Quick start
			</p>
			<SecondaryNavItem
				href="/meetings"
				label="Start instant"
				icon={<Play size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings"
				label="Schedule"
				icon={<CalendarPlus size={15} />}
			/>
		</nav>
	);
}

export default function MeetingsRoute() {
	return (
		<WorkspaceShell title="Meetings" secondaryNav={<MeetingsSecondaryNav />}>
			<MeetingsPane />
		</WorkspaceShell>
	);
}
