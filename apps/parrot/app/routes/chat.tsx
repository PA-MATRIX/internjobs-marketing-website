// v1.3.1 → Phase 31 Wave 1 (plan 31-02): /chat route — native Parrot chat
// backed by Mattermost.
//
// Parrot owns the interface and session boundary. Mattermost is an internal
// chat engine reached through /api/chat/*, so the browser never depends on a
// separate Mattermost cookie to render the Workspace chat tab.
//
// ChatPane renders the WorkspaceShell itself so it can pass the live channel
// browser into the shell's `secondaryNav` rail (Column 2). The route just
// resolves whether the employee is an operator (gates private-channel
// creation) and hands that flag down.

import { ChatPane } from "~/components/ChatPane";
import { useCurrentEmployee } from "~/lib/auth";

export default function ChatRoute() {
	const { data: me } = useCurrentEmployee();
	return <ChatPane isOperator={me?.role === "operator"} />;
}
