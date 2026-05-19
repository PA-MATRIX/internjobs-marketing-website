// v1.2 Phase 10 Wave 1: EmailToChat — cross-pane action stub.
//
// Wave 4 backs this with a real endpoint that creates a Mattermost
// channel from the email participants and posts the email body as
// the first message.

import { useMutation } from "@tanstack/react-query";
import { api } from "~/lib/api";

export function EmailToChat() {
	const action = useMutation({ mutationFn: () => api.crosspaneEmailToChat() });

	return (
		<button
			type="button"
			onClick={() => action.mutate()}
			disabled={action.isPending}
			title="Wave 4: spin up a Mattermost channel from this email's participants."
			className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
		>
			Move to chat
		</button>
	);
}
