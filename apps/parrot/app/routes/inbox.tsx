// v1.2 Phase 10 Wave 2b: /inbox route ("Email" pane).

import {
	Archive,
	FileEdit,
	Inbox as InboxIcon,
	Send,
	Tag,
	Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { InboxPane } from "~/components/InboxPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

const FOLDERS = new Set(["inbox", "sent", "draft", "archive", "trash"]);

function normalizeFolder(value: string | null): string {
	if (!value) return "inbox";
	const folder = value.toLowerCase();
	return FOLDERS.has(folder) ? folder : "inbox";
}

function EmailSecondaryNav({ activeFolder }: { activeFolder: string }) {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Folders
			</p>
			<SecondaryNavItem
				href="/inbox"
				active={activeFolder === "inbox"}
				label="Inbox"
				icon={<InboxIcon size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox?folder=sent"
				active={activeFolder === "sent"}
				label="Sent"
				icon={<Send size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox?folder=draft"
				active={activeFolder === "draft"}
				label="Drafts"
				icon={<FileEdit size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox?folder=archive"
				active={activeFolder === "archive"}
				label="Archive"
				icon={<Archive size={15} />}
			/>
			<SecondaryNavItem
				href="/inbox?folder=trash"
				active={activeFolder === "trash"}
				label="Trash"
				icon={<Trash2 size={15} />}
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
	const [searchParams] = useSearchParams();
	const folder = normalizeFolder(searchParams.get("folder"));
	const messageId = searchParams.get("message");

	return (
		<WorkspaceShell
			title="Email"
			secondaryNav={<EmailSecondaryNav activeFolder={folder} />}
		>
			<InboxPane folder={folder} initialMessageId={messageId} />
		</WorkspaceShell>
	);
}
