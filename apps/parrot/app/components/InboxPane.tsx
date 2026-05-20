// v1.2 Phase 10 Wave 1: InboxPane — list view + reader stub.
//
// Real "port from agentic-inbox" of the EmailPanel/EmailIframe stack
// is deferred. This Wave 1 version renders the bare list (subject,
// sender, snippet) so the API contract can be exercised end-to-end.
// When InboxPane grows up, lift apps/agentic-inbox/app/components/EmailPanel.tsx.
//
// v1.3.1 BACKFILL: Compose / Reply / Forward buttons are now real.
//   - Compose button (top of the list pane) opens ComposePane in 'compose' mode.
//   - Reply / Forward buttons on the reader pane open ComposePane in the
//     matching mode pre-filled from the selected message.
// The pane closes after a successful send and the inbox list is
// invalidated so the new message lands in Sent on next pane switch.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Forward, PenSquare, Reply } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type InboxMessage } from "~/lib/api";
import { ComposePane, type ComposeMode } from "./ComposePane";
import { EmailAttachmentList } from "./EmailAttachmentList";
import { EmailToChat } from "./crosspane/EmailToChat";
import { StartMeeting } from "./crosspane/StartMeeting";

function formatDate(iso: string | null) {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString();
}

export function InboxPane() {
	const [folder] = useState("inbox");
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

	const [selectedId, setSelectedId] = useState<string | null>(null);

	const { data: selected } = useQuery({
		queryKey: ["parrot", "inbox", "message", selectedId],
		queryFn: () => (selectedId ? api.getMessage(selectedId) : null),
		enabled: !!selectedId,
	});

	// v1.3.1 BACKFILL: compose state. `composeMode` non-null means the
	// modal is open. `composeOriginal` is only set for reply/forward.
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);

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

	return (
		<div className="flex h-full min-h-0">
			<div className="w-full md:w-80 lg:w-96 border-r border-slate-200 overflow-y-auto bg-white">
				{/* v1.3.1 BACKFILL: Compose button. */}
				<div className="px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10">
					<button
						type="button"
						onClick={() => openCompose("compose")}
						className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
					>
						<PenSquare size={13} />
						Compose
					</button>
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
			</div>

			<div className="hidden md:flex flex-1 min-w-0 flex-col bg-slate-50">
				{selectedId && selected ? (
					<>
						<div className="border-b border-slate-200 bg-white px-6 py-4">
							<h2 className="text-base font-semibold mb-1">
								{selected.subject || "(no subject)"}
							</h2>
							<p className="text-sm text-slate-600">
								From {selected.sender} → {selected.recipient}
							</p>
							<div className="mt-3 flex flex-wrap gap-2">
								{/* v1.3.1 BACKFILL: Reply + Forward */}
								<button
									type="button"
									onClick={() => openCompose("reply")}
									className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
								>
									<Reply size={12} />
									Reply
								</button>
								<button
									type="button"
									onClick={() => openCompose("forward")}
									className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
								>
									<Forward size={12} />
									Forward
								</button>
								<EmailToChat emailId={selectedId ?? ""} />
								<StartMeeting />
							</div>
						</div>
						<div className="flex-1 overflow-auto px-6 py-4 text-sm text-slate-800 whitespace-pre-wrap">
							{selected.body || "(empty body)"}
							{/* v1.3.1 BACKFILL: attachment metadata display.
							    Real download endpoint isn't wired yet (see
							    EmailAttachmentList.tsx) but the metadata renders. */}
							{selected.attachments && selected.attachments.length > 0 && (
								<div className="mt-6">
									<EmailAttachmentList
										emailId={selectedId}
										attachments={selected.attachments}
										showHeading
									/>
								</div>
							)}
						</div>
					</>
				) : (
					<div className="flex-1 flex items-center justify-center text-sm text-slate-400">
						Select a message to read it.
					</div>
				)}
			</div>

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
