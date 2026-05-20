// v1.3.1: /chat route — native Parrot chat backed by Mattermost.
//
// Parrot owns the interface and session boundary. Mattermost is an internal
// chat engine reached through /api/chat/*, so the browser never depends on a
// separate Mattermost cookie to render the Workspace chat tab.

import { ChatPane } from "~/components/ChatPane";
import { WorkspaceShell } from "~/components/WorkspaceShell";

export default function ChatRoute() {
	return (
		<WorkspaceShell title="Chat">
			<ChatPane />
		</WorkspaceShell>
	);
}
