// v1.2 Phase 10 Wave 1: InboxPane — list view + reader stub.
//
// Real "port from agentic-inbox" of the EmailPanel/EmailIframe stack
// is deferred. This Wave 1 version renders the bare list (subject,
// sender, snippet) so the API contract can be exercised end-to-end.
// When InboxPane grows up, lift apps/agentic-inbox/app/components/EmailPanel.tsx.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, type InboxMessage } from "~/lib/api";
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
							<div className="mt-3 flex gap-2">
								<EmailToChat />
								<StartMeeting />
							</div>
						</div>
						<div className="flex-1 overflow-auto px-6 py-4 text-sm text-slate-800 whitespace-pre-wrap">
							{selected.body || "(empty body)"}
						</div>
					</>
				) : (
					<div className="flex-1 flex items-center justify-center text-sm text-slate-400">
						Select a message to read it.
					</div>
				)}
			</div>
		</div>
	);
}
