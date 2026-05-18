// v1.2 Phase 10 Wave 1: /meetings route — Daily.co placeholder.

import { WorkspaceShell } from "~/components/WorkspaceShell";
import { MeetingsPane } from "~/components/MeetingsPane";

export default function MeetingsRoute() {
	return (
		<WorkspaceShell title="Meetings">
			<MeetingsPane />
		</WorkspaceShell>
	);
}
