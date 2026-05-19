// v1.2 Phase 13 Wave 2: ChatToEmail — opens a draft compose modal
// pre-filled with the chat post body quoted.
//
// The full compose flow (send via /api/inbox/send) lands in v1.3 when
// the real Inbox composer ships. For now we stash the user-edited
// draft in sessionStorage and route to /inbox?compose=1, where the
// future composer will pick it up.
//
// Skills referenced:
//   cloudflare/skills: agents-sdk

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "~/lib/api";

interface Props {
	postId?: string;
	postBody?: string;
}

interface DraftModal {
	to: string;
	subject: string;
	body: string;
}

export function ChatToEmail({ postId = "", postBody = "" }: Props) {
	const [draft, setDraft] = useState<DraftModal | null>(null);

	const action = useMutation({
		mutationFn: () => api.crosspaneChatToEmail(postId, postBody),
		onSuccess: (data) => {
			if (data.ok && data.draft) setDraft(data.draft);
		},
	});

	return (
		<>
			<button
				type="button"
				onClick={() => action.mutate()}
				disabled={action.isPending || !postBody}
				title="Attach this chat post to an email draft"
				className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
			>
				{action.isPending ? "Preparing…" : "Attach to Email"}
			</button>

			{draft && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
					<div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
						<h2 className="mb-4 text-sm font-semibold text-slate-900">
							Compose Email
						</h2>
						<div className="space-y-3">
							<div>
								<label
									htmlFor="ChatToEmail-to"
									className="mb-1 block text-xs text-slate-500"
								>
									To
								</label>
								<input
									id="ChatToEmail-to"
									type="email"
									value={draft.to}
									onChange={(e) =>
										setDraft({ ...draft, to: e.target.value })
									}
									placeholder="recipient@example.com"
									className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
								/>
							</div>
							<div>
								<label
									htmlFor="ChatToEmail-subject"
									className="mb-1 block text-xs text-slate-500"
								>
									Subject
								</label>
								<input
									id="ChatToEmail-subject"
									type="text"
									value={draft.subject}
									onChange={(e) =>
										setDraft({ ...draft, subject: e.target.value })
									}
									className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
								/>
							</div>
							<div>
								<label
									htmlFor="ChatToEmail-body"
									className="mb-1 block text-xs text-slate-500"
								>
									Body
								</label>
								<textarea
									id="ChatToEmail-body"
									rows={6}
									value={draft.body}
									onChange={(e) =>
										setDraft({ ...draft, body: e.target.value })
									}
									className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
								/>
							</div>
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setDraft(null)}
								className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									// Stash draft for the v1.3 full composer to pick up.
									sessionStorage.setItem(
										"parrot_compose_draft",
										JSON.stringify(draft),
									);
									setDraft(null);
									window.location.href = "/inbox?compose=1";
								}}
								className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
							>
								Open in Inbox
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
