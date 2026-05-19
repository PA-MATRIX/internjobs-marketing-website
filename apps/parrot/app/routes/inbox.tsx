// v1.2 Phase 10 Wave 2b: /inbox route ("Email" pane).

import {
	Archive,
	FileEdit,
	Inbox as InboxIcon,
	Send,
	Tag,
} from "lucide-react";
import { InboxPane } from "~/components/InboxPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

function EmailSecondaryNav() {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Folders
			</p>
			<SecondaryNavItem
				href="/inbox"
				active
				label="Inbox"
				icon={<InboxIcon size={15} />}
			/>
			<SecondaryNavItem href="/inbox" label="Sent" icon={<Send size={15} />} />
			<SecondaryNavItem
				href="/inbox"
				label="Drafts"
				icon={<FileEdit size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox"
				label="Archived"
				icon={<Archive size={15} />}
			/>
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Labels
			</p>
			<SecondaryNavItem
				href="/inbox"
				label="Investors"
				icon={<Tag size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox"
				label="Candidates"
				icon={<Tag size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox"
				label="Newsletters"
				icon={<Tag size={15} />}
			/>
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
