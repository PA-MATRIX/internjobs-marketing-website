// v1.2 Phase 10 Wave 1: InboxPane — list view + reader.
//
// v1.3.1 Agent Lift: the inline reader has been replaced by EmailPanel
// (sandboxed iframe via EmailIframe) and an optional right-side AgentPanel
// (Summarize / Draft / Extract / Translate / Chat).
//
// Layout:
//   - md+: three panes — message list | EmailPanel | AgentPanel
//   - sm: single pane, list <→ EmailPanel transitions
//
// v1.3.1 BACKFILL: Compose / Reply / Forward buttons:
//   - Compose button (top of the list pane) opens ComposePane in 'compose'.
//   - Reply / Forward buttons on EmailPanel open ComposePane pre-filled.
// The pane closes after a successful send and the inbox list is
// invalidated so the new message lands in Sent on next pane switch.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PenSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type InboxMessage } from "~/lib/api";
import { AgentPanel, type AgentInitialAction } from "./AgentPanel";
import { ComposePane, type ComposeMode } from "./ComposePane";
import { EmailPanel } from "./EmailPanel";

function formatDate(iso: string | null) {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString();
}

interface InboxPaneProps {
	folder?: string;
	initialMessageId?: string | null;
}

// PARROT-FOLDER-ACTIONS-01: inline archive/delete toast.
interface ToastState {
	message: string;
	undoFn?: () => void;
}

function folderTitle(folder: string): string {
	switch (folder) {
		case "sent":
			return "Sent";
		case "draft":
			return "Drafts";
		case "archive":
			return "Archive";
		case "trash":
			return "Trash";
		case "starred":
			return "Starred";
		default:
			return "Inbox";
	}
}

export function InboxPane({
	folder = "inbox",
	initialMessageId = null,
}: InboxPaneProps) {
	const queryClient = useQueryClient();

	const {
		data,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["parrot", "inbox", folder],
		queryFn: () => api.listInbox(folder),
		retry: (count, err) => {
			if (err instanceof ApiError && err.status === 401) return false;
			return count < 1;
		},
	});

	const [selectedId, setSelectedId] = useState<string | null>(
		initialMessageId,
	);

	useEffect(() => {
		setSelectedId(initialMessageId);
	}, [folder, initialMessageId]);

	// EmailPanel pulls the full message via React Query itself — we still
	// fetch a copy here so the ComposePane (reply/forward) gets the same
	// original payload without a second round-trip.
	const { data: selected } = useQuery({
		queryKey: ["parrot", "inbox", "message", selectedId],
		queryFn: () => (selectedId ? api.getMessage(selectedId) : null),
		enabled: !!selectedId,
	});

	// v1.3.1 BACKFILL: compose state. `composeMode` non-null means the
	// modal is open. `composeOriginal` is only set for reply/forward.
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);

	// v1.3.1 Agent Lift: agent panel state. `agentOpen` controls the
	// right-side AgentPanel visibility; `agentInitialAction` triggers a
	// quick-action on open (summarize / draft / extract / translate).
	const [agentOpen, setAgentOpen] = useState(false);
	const [agentInitialAction, setAgentInitialAction] =
		useState<AgentInitialAction | null>(null);

	// PARROT-FOLDER-ACTIONS-01: inline toast for archive/delete feedback.
	// undoFn is undefined for hard-deletes (no undo possible).
	const [toast, setToast] = useState<ToastState | null>(null);

	function showToast(message: string, undoFn?: () => void) {
		setToast({ message, undoFn });
		setTimeout(() => setToast(null), 4000);
	}

	// PARROT-FOLDER-ACTIONS-01: EmailPanel calls this after a successful
	// archive/delete. We clear the selection (EmailPanel unmounts), invalidate
	// the inbox queries (prefix match cascades to folder lists + message
	// caches), and show the matching toast. Archive / move-to-trash get an
	// Undo that re-moves the message back to the folder we were viewing.
	async function handleActioned(
		action: "archived" | "unarchived" | "deleted" | "moved-to-trash",
	) {
		const previousFolder = folder;
		const previousId = selectedId;

		setSelectedId(null);
		queryClient.invalidateQueries({ queryKey: ["parrot", "inbox"] });

		if (
			action === "archived" ||
			action === "unarchived" ||
			action === "moved-to-trash"
		) {
			const label =
				action === "archived"
					? "Archived — Undo"
					: action === "unarchived"
						? "Moved to Inbox — Undo"
						: "Moved to Trash — Undo";
			showToast(label, async () => {
				if (previousId) {
					await api.moveMessage(previousId, previousFolder);
					queryClient.invalidateQueries({ queryKey: ["parrot", "inbox"] });
				}
				setToast(null);
			});
		} else {
			// hard-deleted: no undo possible
			showToast("Deleted permanently");
		}
	}

	function openCompose(mode: ComposeMode) {
		setComposeMode(mode);
	}

	function closeCompose() {
		setComposeMode(null);
	}

	function handleSent() {
		// Invalidate so the Sent folder (and inbox unread counts) refresh on
		// next pane switch. Compose pane already closes itself.
		queryClient.invalidateQueries({ queryKey: ["parrot", "inbox"] });
	}

	function openAgent(action?: AgentInitialAction) {
		setAgentInitialAction(action ?? null);
		setAgentOpen(true);
	}

	function handleDraftSavedToCompose(body: string) {
		if (!selectedId) return;
		queryClient.setQueryData(
			["parrot", "inbox", "message", selectedId],
			(prev: InboxMessage & { agent_draft_body?: string } | undefined) =>
				prev ? { ...prev, agent_draft_body: body } : prev,
		);
		setAgentOpen(false);
		openCompose("reply");
	}

	if (isLoading) {
		return (
			<div className="p-6 text-sm text-slate-500">Loading inbox…</div>
		);
	}

	if (error instanceof ApiError && error.status === 401) {
		return (
			<div className="p-6">
				<p className="text-sm text-slate-600 mb-2">
					You need to sign in to load your inbox.
				</p>
				<a
					href="/sign-in"
					className="text-sm font-medium text-slate-900 underline"
				>
					Go to sign-in
				</a>
			</div>
		);
	}

	if (error) {
		return (
			<div className="p-6 text-sm text-red-600">
				Failed to load inbox: {(error as Error).message}
			</div>
		);
	}

	const messages: InboxMessage[] = data?.emails ?? [];
	const title = folderTitle(folder);

	return (
		<div className="relative flex h-full min-h-0">
			<div
				className={`relative w-full shrink-0 overflow-y-auto border-r border-slate-200 bg-white md:block md:w-80 lg:w-96 ${
					selectedId ? "hidden" : "block"
				}`}
			>
				{/* v1.3.1 BACKFILL: Compose button. The Parrot Agent is now
				    opened from the Agent button inside an open email
				    (EmailPanel), since the agent always operates on the
				    currently-viewed message. */}
				<div className="px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10 flex items-center justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-900">
							{title}
						</p>
						<p className="text-xs text-slate-400">{messages.length} messages</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={() => openCompose("compose")}
							className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
						>
							<PenSquare size={13} />
							Compose
						</button>
					</div>
				</div>
				{messages.length === 0 ? (
					<div className="p-6 text-sm text-slate-500">
						<p className="font-medium text-slate-700 mb-1">No messages yet</p>
						<p>
							Inbound mail starts arriving once apex *@internjobs.ai routing
							points at the Parrot worker (orchestrator step).
						</p>
					</div>
				) : (
					<ul className="divide-y divide-slate-100">
						{messages.map((msg) => (
							<li key={msg.id}>
								<button
									type="button"
									onClick={() => setSelectedId(msg.id)}
									className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${
										selectedId === msg.id ? "bg-slate-100" : ""
									}`}
								>
									<div className="flex items-baseline justify-between gap-2">
										<span
											className={`text-sm truncate ${
												msg.read ? "text-slate-700" : "font-semibold text-slate-900"
											}`}
										>
											{msg.sender || "(unknown sender)"}
										</span>
										<span className="text-xs text-slate-400 shrink-0">
											{formatDate(msg.date)}
										</span>
									</div>
									<p
										className={`text-sm truncate ${
											msg.read ? "text-slate-600" : "text-slate-900"
										}`}
									>
										{msg.subject || "(no subject)"}
									</p>
									{msg.snippet && (
										<p className="text-xs text-slate-500 truncate mt-0.5">
											{msg.snippet}
										</p>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
				{/* PARROT-FOLDER-ACTIONS-01: archive/delete toast with Undo. */}
				{toast && (
					<div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-800 px-4 py-2.5 text-xs text-white shadow-lg">
						<span>{toast.message}</span>
						{toast.undoFn && (
							<button
								type="button"
								onClick={toast.undoFn}
								className="font-semibold underline hover:no-underline"
							>
								Undo
							</button>
						)}
					</div>
				)}
			</div>

			{/* Email viewer pane — uses EmailPanel which itself uses
			    EmailIframe for sandboxed HTML body rendering. */}
			<div
				className={`min-w-0 flex-1 flex-col bg-slate-50 ${
					selectedId ? "flex" : "hidden md:flex"
				}`}
			>
				{selectedId && (
					<div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
						<button
							type="button"
							onClick={() => setSelectedId(null)}
							className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
							aria-label="Back to messages"
						>
							<ArrowLeft size={17} />
						</button>
						<p className="min-w-0 truncate text-sm font-semibold text-slate-900">
							{title}
						</p>
					</div>
				)}
				{selectedId ? (
					<div className="min-h-0 flex-1">
						<EmailPanel
							emailId={selectedId}
							folder={folder}
							onReply={() => openCompose("reply")}
							onForward={() => openCompose("forward")}
							onOpenAgent={() => openAgent()}
							onActioned={handleActioned}
						/>
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center text-sm text-slate-400">
						Select a message to read it.
					</div>
				)}
			</div>

			{/* v1.3.1 Agent Lift: right-side AgentPanel. Only mounted when
			    open AND a message is selected — the agent always operates
			    on the currently-viewed email's context. */}
			{agentOpen && selectedId && (
				<div className="hidden lg:flex w-96 shrink-0 flex-col border-l border-slate-200 bg-white">
					<AgentPanel
						emailId={selectedId}
						initialAction={agentInitialAction}
						onClose={() => setAgentOpen(false)}
						onDraftSavedToCompose={handleDraftSavedToCompose}
					/>
				</div>
			)}

			{agentOpen && selectedId && (
				<div className="fixed inset-0 z-30 flex bg-slate-900/30 lg:hidden">
					<button
						type="button"
						aria-label="Close Parrot Agent"
						className="flex-1"
						onClick={() => setAgentOpen(false)}
					/>
					<aside className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-slate-200 bg-white shadow-2xl">
						<AgentPanel
							emailId={selectedId}
							initialAction={agentInitialAction}
							onClose={() => setAgentOpen(false)}
							onDraftSavedToCompose={handleDraftSavedToCompose}
						/>
					</aside>
				</div>
			)}

			{/* v1.3.1 BACKFILL: ComposePane portal-ish overlay. */}
			{composeMode && (
				<ComposePane
					mode={composeMode}
					original={composeMode === "compose" ? null : selected ?? null}
					onClose={closeCompose}
					onSent={handleSent}
				/>
			)}
		</div>
	);
}
