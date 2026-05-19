// v1.2 Phase 11 Wave 3: StartMeeting — Daily.co ephemeral room.
//
// Replaces the Phase 13 UI seam. When DAILY_API_KEY is set on the Worker,
// this button creates a real ephemeral Daily.co room (1-hour exp), opens
// it in a new tab, and navigates to /meetings.
//
// Phase 17 (2026-05-19): on the first successful real-room start (per
// browser, gated by localStorage in lib/confetti.ts), fire a tasteful
// confetti burst — small dose of joy for the HS/college intern audience.

import { fireConfetti } from "~/lib/confetti";
//
// Fallback: when the server returns reason:'meetings_coming_soon' (i.e.
// DAILY_API_KEY is absent or Daily.co is down), the Phase 13 toast is
// shown instead — zero regression.
//
// Skills referenced:
//   cloudflare/skills: durable-objects — ephemeral room via EmployeeMailboxDO
//   cloudflare/skills: cloudflare — Workers fetch() against Daily.co REST

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "~/lib/api";

export function StartMeeting() {
	const [toast, setToast] = useState(false);
	const navigate = useNavigate();

	const action = useMutation({
		mutationFn: () => api.crosspaneStartMeeting(),
		onSuccess: (data) => {
			if (data.url) {
				// Real-room path: open the Daily.co room in a new tab so the
				// employee starts the call immediately, AND navigate to
				// /meetings so the Parrot Meetings pane shows the room and
				// other employees can join from there.
				window.open(data.url, "_blank", "noopener,noreferrer");
				// Phase 17: confetti on first real meeting (once per browser).
				void fireConfetti("first_meeting_started");
				navigate("/meetings");
				return;
			}
			if (data.reason === "meetings_coming_soon") {
				// Fallback path (DAILY_API_KEY absent or Daily.co outage):
				// preserve the Phase 13 toast — zero regression for pilots
				// running without the Daily.co key.
				setToast(true);
				setTimeout(() => setToast(false), 3500);
			}
		},
	});

	return (
		<>
			<button
				type="button"
				onClick={() => action.mutate()}
				disabled={action.isPending}
				title="Start a meeting — creates an ephemeral Daily.co room"
				className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
			>
				{action.isPending ? "Starting…" : "Start Meeting"}
			</button>

			{toast && (
				<div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm text-white shadow-lg">
					Meetings coming soon — Daily.co integration is on the roadmap.
				</div>
			)}
		</>
	);
}
