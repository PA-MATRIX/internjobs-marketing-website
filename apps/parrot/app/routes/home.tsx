// v1.2 Phase 10 Wave 1: Parrot home — three-pane landing.
//
// The landing redirects effectively to Inbox by rendering it inside the
// WorkspaceShell. We avoid a hard <Navigate> so the URL stays stable
// (Cloudflare's Worker logs are easier to reason about with a fixed
// route table).

import type { MetaFunction } from "react-router";
import { WorkspaceShell } from "~/components/WorkspaceShell";
import { InboxPane } from "~/components/InboxPane";

export const meta: MetaFunction = () => [
	{ title: "Parrot — InternJobs Workspace" },
];

export default function HomeRoute() {
	return (
		<WorkspaceShell title="Inbox">
			<InboxPane />
		</WorkspaceShell>
	);
}
