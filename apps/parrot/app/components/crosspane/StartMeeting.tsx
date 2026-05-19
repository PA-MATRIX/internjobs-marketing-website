// v1.2 Phase 10 Wave 1: StartMeeting — cross-pane action stub.
//
// Shared between InboxPane (start a meeting from an email thread) and
// ChatPane (start a meeting from a channel). Wave 3 wires the real
// Daily.co provisioning behind this button; the existing
// /api/meetings/create stub already returns the right response shape.

import { useMutation } from "@tanstack/react-query";
import { api } from "~/lib/api";

export function StartMeeting() {
	const action = useMutation({
		mutationFn: () => api.crosspaneStartMeeting(),
		// Wave 4 will replace this with a real API call. The cross-pane
		// stub is currently 501; clicking it shows the user the planned
		// flow without actually doing anything destructive.
	});

	return (
		<button
			type="button"
			onClick={() => action.mutate()}
			disabled={action.isPending}
			title="Wave 3 ships Daily.co; Wave 4 wires the cross-pane shortcut."
			className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
		>
			Start meeting
		</button>
	);
}
