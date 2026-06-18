// v1.3.1 Agent Lift: Parrot email viewer pane.
//
// This is a Parrot-idiomatic adaptation of
// apps/agentic-inbox/app/components/EmailPanel.tsx. The agentic-inbox
// version is heavily tied to its stack:
//   - @cloudflare/kumo design system + useKumoToastManager
//   - useUIStore (zustand) for compose flow
//   - useParams to read :mailboxId from the URL
//   - Per-thread reply hooks (useReplyToEmail / useSendEmail) bound to
//     mailboxId-keyed API endpoints
//   - 5-piece sub-component split (EmailPanelHeader/Toolbar/Dialogs/
//     SingleMessageView/ThreadMessage)
//
// Parrot doesn't have Kumo, has only one implicit mailbox per signed-in
// employee (no URL param), and ships a flatter UI. So this file lifts the
// SEMANTICS — sandboxed iframe body render, header metadata, attachment
// chips, action toolbar (Reply/Forward/Star/Delete) — into a single
// React-Query-driven component that plugs into InboxPane.
//
// Differences from the previous inline reader in InboxPane:
//   - Email body is rendered inside EmailIframe (sandboxed iframe with
//     DOMPurify + strict CSP) instead of `<div whitespace-pre-wrap>`.
//   - Star toggle (calls future /api/inbox/messages/:id PATCH — not wired
//     in v1.3.1 because the toggle endpoint doesn't exist yet; the button
//     is shown but visually disabled with a TODO).
//   - Inline Summarize / Draft / Extract buttons that open the AgentPanel
//     (when wired in Commit C; for v1.3.1 they call the onAgentAction
//     callback that InboxPane plumbs).

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	ArchiveRestore,
	Forward,
	PaperclipIcon,
	Reply,
	Sparkles,
	Star,
	Trash2,
} from "lucide-react";
import EmailIframe from "./EmailIframe";
import { EmailAttachmentList } from "./EmailAttachmentList";
import { EmailToChat } from "./crosspane/EmailToChat";
import { StartMeeting } from "./crosspane/StartMeeting";
import { api, type Attachment, type InboxMessage } from "~/lib/api";

interface EmailPanelProps {
	emailId: string;
	/**
	 * The folder currently being viewed. When "archive", the Archive action
	 * becomes "Unarchive" (moves the message back to the Inbox).
	 */
	folder?: string;
	onReply: () => void;
	onForward: () => void;
	/** Opens the right-side Parrot Agent panel for the current email. */
	onOpenAgent?: () => void;
	/**
	 * PARROT-FOLDER-ACTIONS-01: fired after a successful archive/unarchive/
	 * delete so InboxPane can clear the selection, invalidate the inbox
	 * queries, and show a toast (with Undo for archive / unarchive /
	 * move-to-trash).
	 */
	onActioned?: (
		action: "archived" | "unarchived" | "deleted" | "moved-to-trash",
	) => void;
}

function formatDate(iso: string | null | undefined) {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString();
}

export function EmailPanel({
	emailId,
	folder = "inbox",
	onReply,
	onForward,
	onOpenAgent,
	onActioned,
}: EmailPanelProps) {
	const queryClient = useQueryClient();
	const { data, isLoading, error } = useQuery({
		queryKey: ["parrot", "inbox", "message", emailId],
		queryFn: () => api.getMessage(emailId),
		enabled: !!emailId,
	});

	// STAR-API-01: live star toggle. Initialised from the query result; once
	// the user clicks, local state drives the icon (optimistic update).
	const [starred, setStarred] = useState(false);
	// Keep local star state in sync with the loaded message.
	const [starredEmailId, setStarredEmailId] = useState<string | null>(null);
	if (data && starredEmailId !== emailId) {
		setStarredEmailId(emailId);
		setStarred(data.starred ?? false);
	}

	// READ-ON-OPEN-01: mark an unread message read as soon as it is opened, so
	// the bold/unread styling in the list clears. The guard on `data.read`
	// means the PATCH fires once; the subsequent inbox invalidation refetches
	// the message with read=true, which keeps the effect from re-firing.
	useEffect(() => {
		if (data && !data.read) {
			api
				.patchMessage(emailId, { read: true })
				.then(() => {
					queryClient.invalidateQueries({ queryKey: ["parrot", "inbox"] });
				})
				.catch(() => {
					// Non-fatal: failing to mark read just leaves the row bold.
				});
		}
	}, [data, emailId, queryClient]);

	async function handleStar() {
		const next = !starred;
		setStarred(next); // optimistic
		try {
			await api.patchMessage(emailId, { starred: next });
			// Invalidate so the list view reflects the new starred state.
			queryClient.invalidateQueries({ queryKey: ["parrot", "inbox"] });
		} catch {
			setStarred(!next); // revert on error
		}
	}

	// PARROT-FOLDER-ACTIONS-01: archive moves the message to the Archive
	// folder; InboxPane handles list refresh + Undo via onActioned. When the
	// message is already in the Archive folder, the same button unarchives it
	// (moves it back to the Inbox).
	const isArchiveFolder = folder === "archive";
	async function handleArchive() {
		if (isArchiveFolder) {
			await api.moveMessage(emailId, "inbox");
			onActioned?.("unarchived");
		} else {
			await api.moveMessage(emailId, "archive");
			onActioned?.("archived");
		}
	}

	// PARROT-FOLDER-ACTIONS-01: two-stage delete. The server moves a
	// non-Trash message to Trash (movedToTrash) or hard-deletes a message
	// already in Trash (hardDeleted). InboxPane shows the matching toast.
	async function handleDelete() {
		const result = await api.deleteMessage(emailId);
		onActioned?.(result.movedToTrash ? "moved-to-trash" : "deleted");
	}

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center text-sm text-slate-400">
				Loading…
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center p-6 text-sm text-red-600">
				Failed to load: {(error as Error).message}
			</div>
		);
	}
	if (!data) {
		return (
			<div className="flex-1 flex items-center justify-center text-sm text-slate-400">
				Select a message to read it.
			</div>
		);
	}

	const email = data as InboxMessage & {
		body?: string;
		attachments?: Attachment[];
	};
	const hasAttachments =
		Array.isArray(email.attachments) && email.attachments.length > 0;
	const isHtml = !!email.body && /<[a-z][\s\S]*>/i.test(email.body);

	return (
		<div className="flex h-full flex-col bg-slate-50">
			{/* Header */}
			<div className="border-b border-slate-200 bg-white px-6 py-4">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-base font-semibold mb-1 truncate">
							{email.subject || "(no subject)"}
						</h2>
						<p className="text-sm text-slate-600 truncate">
							From <span className="font-medium">{email.sender}</span> →{" "}
							{email.recipient}
						</p>
						<p className="text-xs text-slate-400 mt-1">
							{formatDate(email.date)}
							{hasAttachments && (
								<>
									{" · "}
									<PaperclipIcon
										size={11}
										className="inline-block -mt-0.5"
									/>{" "}
									{email.attachments?.length} attachment
									{(email.attachments?.length ?? 0) > 1 ? "s" : ""}
								</>
							)}
						</p>
					</div>
					{/* STAR-API-01: live star toggle wired to PATCH
					    /api/inbox/messages/:id via api.patchMessage. */}
					<button
						type="button"
						title={starred ? "Unstar" : "Star"}
						aria-label={starred ? "Unstar" : "Star"}
						onClick={handleStar}
						className={`transition-colors ${
							starred
								? "text-amber-400 hover:text-amber-500"
								: "text-slate-300 hover:text-amber-400"
						}`}
					>
						<Star
							size={16}
							fill={starred ? "currentColor" : "none"}
						/>
					</button>
				</div>

				{/* Action toolbar.
				 *
				 * The primary mail actions (Reply / Forward / Archive / Delete)
				 * are icon-only to keep the bar compact; each carries a title +
				 * aria-label so hovering reveals what it does. */}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onReply}
						title="Reply"
						aria-label="Reply"
						className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
					>
						<Reply size={15} />
					</button>
					<button
						type="button"
						onClick={onForward}
						title="Forward"
						aria-label="Forward"
						className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
					>
						<Forward size={15} />
					</button>
					<button
						type="button"
						onClick={handleArchive}
						title={isArchiveFolder ? "Unarchive" : "Archive"}
						aria-label={isArchiveFolder ? "Unarchive" : "Archive"}
						className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
					>
						{isArchiveFolder ? (
							<ArchiveRestore size={15} />
						) : (
							<Archive size={15} />
						)}
					</button>
					<button
						type="button"
						onClick={handleDelete}
						title="Delete"
						aria-label="Delete"
						className="inline-flex items-center justify-center rounded-md border border-red-100 bg-white p-2 text-red-600 hover:bg-red-50"
					>
						<Trash2 size={15} />
					</button>
					<EmailToChat emailId={emailId} />
					<StartMeeting />
					{/* v1.3.1 Agent Lift: a single Agent button opens the side
					    AgentPanel, which hosts the Summarize / Draft reply /
					    Action items quick-actions. */}
					{onOpenAgent && (
						<>
							<span className="mx-1 self-center text-slate-300">|</span>
							<button
								type="button"
								onClick={onOpenAgent}
								title="Open Parrot Agent"
								className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
							>
								<Sparkles size={12} />
								Agent
							</button>
						</>
					)}
				</div>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-auto bg-white">
				{email.body ? (
					isHtml ? (
						<EmailIframe body={email.body} />
					) : (
						<div className="px-6 py-4 text-sm text-slate-800 whitespace-pre-wrap">
							{email.body}
						</div>
					)
				) : (
					<div className="px-6 py-4 text-sm text-slate-500 italic">
						(empty body)
					</div>
				)}
			</div>

			{/* Attachments
			 *
			 * v1.4 Phase 23-03 ATTACH-DOWN-01..03: each chip rendered by
			 * EmailAttachmentList is an <a href download> anchor pointing at
			 *   GET /api/inbox/messages/:messageId/attachments/:attachmentId
			 * on the Workspace Worker. Direct browser download — no fetch(),
			 * no React Query intermediary. Worker enforces Clerk auth +
			 * per-employee DO ownership; non-owners get 403, missing blobs
			 * get 404. Tested in Chrome + Safari (deferred to operator).
			 */}
			{hasAttachments && (
				<div className="border-t border-slate-200 bg-white px-6 py-3">
					<EmailAttachmentList
						emailId={emailId}
						attachments={email.attachments ?? []}
						showHeading
					/>
				</div>
			)}
		</div>
	);
}
