// v1.2 Phase 10 Wave 1: /chat route — Mattermost placeholder.

import { WorkspaceShell } from "~/components/WorkspaceShell";
import { ChatPane } from "~/components/ChatPane";

export default function ChatRoute() {
	return (
		<WorkspaceShell title="Chat">
			<ChatPane />
		</WorkspaceShell>
	);
}
