// v1.2 Phase 10 Wave 1: MeetingsPane — Daily.co embed placeholder.
//
// Wave 3 swaps the placeholder iframe for the real Daily.co embedded
// UI (@daily-co/daily-js). Until then the "Start meeting" button POSTs
// to /api/meetings/create, which currently returns
// { url: "https://daily.co/room-stub" }.

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "~/lib/api";

export function MeetingsPane() {
	const [roomUrl, setRoomUrl] = useState<string | null>(null);

	const startMeeting = useMutation({
		mutationFn: () => api.createMeeting(),
		onSuccess: (data) => setRoomUrl(data.url),
	});

	return (
		<div className="p-6 max-w-2xl">
			<h2 className="text-lg font-semibold mb-2">Meetings</h2>
			<p className="text-sm text-slate-600 mb-4">
				Video and audio meetings are powered by Daily.co (Wave 3 of
				Phase 10). The flat-rate plan covers the InternJobs internal
				workspace.
			</p>

			<button
				type="button"
				onClick={() => startMeeting.mutate()}
				disabled={startMeeting.isPending}
				className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
			>
				{startMeeting.isPending ? "Starting…" : "Start meeting"}
			</button>

			{startMeeting.isError && (
				<p className="mt-3 text-sm text-red-600">
					Failed to create a meeting: {(startMeeting.error as Error).message}
				</p>
			)}

			{roomUrl && (
				<div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
					<p className="text-sm text-slate-700 mb-2">
						Meeting URL (Wave 3 stub):
					</p>
					<a
						href={roomUrl}
						target="_blank"
						rel="noreferrer"
						className="text-sm font-medium text-slate-900 underline break-all"
					>
						{roomUrl}
					</a>
					<p className="text-xs text-slate-500 mt-2">
						Wave 3 replaces this link with an embedded Daily prebuilt UI.
					</p>
				</div>
			)}
		</div>
	);
}
