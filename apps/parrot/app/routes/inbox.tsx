// v1.2 Phase 10 Wave 1: /inbox route.

import { WorkspaceShell } from "~/components/WorkspaceShell";
import { InboxPane } from "~/components/InboxPane";

export default function InboxRoute() {
	return (
		<WorkspaceShell title="Inbox">
			<InboxPane />
		</WorkspaceShell>
	);
}
