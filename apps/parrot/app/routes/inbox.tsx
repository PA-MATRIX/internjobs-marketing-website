// v1.2 Phase 10 Wave 2b: /inbox route ("Email" pane).
//
// Secondary nav surfaces the folder tree (Inbox / Sent / Drafts /
// Archived) so the agent-inbox model from apps/agentic-inbox lifts in
// cleanly when we port the EmailPanel.

import { InboxPane } from "~/components/InboxPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

function EmailSecondaryNav() {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Folders
			</p>
			<SecondaryNavItem href="/inbox" active label="Inbox" icon="📥" />
			<SecondaryNavItem href="/inbox" label="Sent" icon="📤" />
			<SecondaryNavItem href="/inbox" label="Drafts" icon="📝" />
			<SecondaryNavItem href="/inbox" label="Archived" icon="🗄" />
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Labels
			</p>
			<SecondaryNavItem href="/inbox" label="Investors" icon="•" />
			<SecondaryNavItem href="/inbox" label="Candidates" icon="•" />
			<SecondaryNavItem href="/inbox" label="Newsletters" icon="•" />
		</nav>
	);
}

export default function InboxRoute() {
	return (
		<WorkspaceShell title="Email" secondaryNav={<EmailSecondaryNav />}>
			<InboxPane />
		</WorkspaceShell>
	);
}
