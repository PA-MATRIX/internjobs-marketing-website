// v1.2 Phase 13 Wave 2: StartMeeting — UI seam for Phase 11 (Daily.co).
//
// Daily.co integration is DEFERRED to Phase 11. This button:
//   1. POSTs /api/crosspane/start-meeting (which records audit demand
//      via the notifications table — see workers/index.ts).
//   2. Shows a toast "Meetings coming soon — Daily.co integration is
//      on the roadmap." for ~3.5 seconds.
//
// When Phase 11 ships, the backend handler gains a real Daily.co
// /rooms POST and this component will navigate to /meetings on
// success. No @daily-co/* package is installed here or anywhere in
// this phase.
//
// Skills referenced:
//   cloudflare/skills: agents-sdk

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "~/lib/api";

export function StartMeeting() {
	const [toast, setToast] = useState(false);

	const action = useMutation({
		mutationFn: () => api.crosspaneStartMeeting(),
		onSuccess: () => {
			setToast(true);
			setTimeout(() => setToast(false), 3500);
		},
	});

	return (
		<>
			<button
				type="button"
				onClick={() => action.mutate()}
				disabled={action.isPending}
				title="Start a meeting — Daily.co integration coming in Phase 11"
				className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
			>
				{action.isPending ? "Requesting…" : "Start Meeting"}
			</button>

			{toast && (
				<div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm text-white shadow-lg">
					Meetings coming soon — Daily.co integration is on the roadmap.
				</div>
			)}
		</>
	);
}
