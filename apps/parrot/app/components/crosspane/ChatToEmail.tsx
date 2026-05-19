// v1.2 Phase 10 Wave 1: ChatToEmail — cross-pane action stub.
//
// Wave 4 backs this with a real endpoint that serializes a Mattermost
// thread and seeds the email compose form. For Wave 1 the button +
// handler shape is in place so Wave 4 only fills the backend, no UI
// rework needed.

import { useMutation } from "@tanstack/react-query";
import { api } from "~/lib/api";

export function ChatToEmail() {
	const action = useMutation({ mutationFn: () => api.crosspaneChatToEmail() });

	return (
		<button
			type="button"
			onClick={() => action.mutate()}
			disabled={action.isPending}
			title="Wave 4: serialize this chat thread into an email compose."
			className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
		>
			Email this thread
		</button>
	);
}
