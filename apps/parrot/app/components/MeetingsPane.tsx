// v1.2 Phase 11 Wave 2: MeetingsPane — Daily.co embedded room.
//
// Three tabs (driven by the activeTab prop owned by the route):
//
//   "your-room": (default)
//     1. On mount, GET /api/meetings/my-room.
//     2. On 404 (room_not_provisioned), POST /api/meetings/ensure-room
//        and refetch.
//     3. On success, GET /api/meetings/room-token (best-effort; token
//        is optional — Daily.co allows entry to private rooms via the
//        room URL alone when the key isn't provisioned).
//     4. Render a prejoin card. The Daily.co iframe is only mounted
//        after the employee explicitly clicks Join room.
//     5. If any step fails (DAILY_API_KEY absent / ensure-room 503),
//        render a non-crashing placeholder card — never a red error
//        screen.
//
//   "active":
//     - GET /api/meetings/active; render { rooms: [...] } as cards.
//     - Empty list (incl. fail-soft when key absent) shows
//       "No active meetings right now."
//
//   "history":
//     - v1.3 placeholder (Daily.co webhook ingest deferred). Static
//       "Meeting history coming soon." row.
//
// Skills referenced:
//   cloudflare/skills: durable-objects — personal room scoped to the
//     signed-in employee's EmployeeMailboxDO.

import { useQuery } from "@tanstack/react-query";
import { Clock, ExternalLink, Loader2, Users, Video } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "~/lib/api";

export type MeetingsTab = "your-room" | "active" | "history";

interface Props {
	activeTab: MeetingsTab;
}

export function MeetingsPane({ activeTab }: Props) {
	if (activeTab === "active") return <ActiveRoomsTab />;
	if (activeTab === "history") return <HistoryTab />;
	return <YourRoomTab />;
}

// ── Your room ─────────────────────────────────────────────────────

function YourRoomTab() {
	const [joined, setJoined] = useState(false);

	// 1. Read the stored room URL. On 404 the catch path POSTs ensure-room.
	const roomQuery = useQuery({
		queryKey: ["meetings", "my-room"],
		// retry:false so we can intercept the 404 and provision lazily
		// without React Query backing off exponentially in between.
		retry: false,
		queryFn: async (): Promise<{
			ok: boolean;
			url?: string;
			name?: string;
			error?: string;
		}> => {
			try {
				return await api.getMyRoom();
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) {
					// Lazily provision; ensure-room is idempotent (Wave 1).
					const ensured = await api.ensurePersonalRoom();
					if (!ensured.ok) {
						return { ok: false, error: ensured.error ?? "ensure_failed" };
					}
					// Re-read via my-room to confirm persistence.
					return await api.getMyRoom();
				}
				throw err;
			}
		},
	});

	// 2. Mint a token for the room (best-effort — UI falls back if absent).
	const tokenQuery = useQuery({
		queryKey: ["meetings", "room-token", roomQuery.data?.url ?? null],
		enabled: !!roomQuery.data?.ok && !!roomQuery.data?.url,
		retry: false,
		queryFn: () => api.getRoomToken(),
	});

	if (roomQuery.isLoading) {
		return (
			<div className="flex items-center gap-2 p-6 text-sm text-slate-500">
				<Loader2 className="animate-spin" size={16} />
				Loading your room…
			</div>
		);
	}

	if (!roomQuery.data?.ok || !roomQuery.data?.url) {
		return (
			<div className="p-6 max-w-2xl">
				<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
					<p className="font-medium text-slate-700">
						Your room is being set up.
					</p>
					<p className="mt-1 text-slate-500">
						Room provisioning is in progress — check back in a moment. If
						this persists, contact your admin.
					</p>
				</div>
			</div>
		);
	}

	const roomUrl = roomQuery.data.url;
	// Token is best-effort. When DAILY_API_KEY is absent the GET returns
	// { ok:false } (HTTP 200) and we proceed without a token — entry into
	// the private room still works via the URL alone.
	const token =
		tokenQuery.data && tokenQuery.data.ok && tokenQuery.data.token
			? tokenQuery.data.token
			: undefined;
	const iframeSrc = buildDailyIframeSrc(roomUrl, token);

	return (
		<div className="p-6">
			<div className="mb-3 flex items-center gap-2">
				<Video size={16} className="text-slate-400" />
				<h2 className="text-base font-semibold text-slate-900">Your room</h2>
				<span className="ml-2 truncate text-xs text-slate-500">
					{roomQuery.data.name}
				</span>
			</div>
			{joined ? (
				<DailyEmbed iframeSrc={iframeSrc} onLeave={() => setJoined(false)} />
			) : (
				<div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="text-sm font-medium text-slate-900">
								Ready when you are
							</p>
							<p className="mt-1 text-sm text-slate-500">
								Your personal room is set up. Joining opens the camera and
								microphone prompts.
							</p>
						</div>
						<Video size={18} className="mt-0.5 shrink-0 text-slate-400" />
					</div>
					<div className="mt-5 flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => setJoined(true)}
							className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
						>
							<Video size={15} />
							Join room
						</button>
						<a
							href={iframeSrc}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50"
						>
							<ExternalLink size={15} />
							Open in new tab
						</a>
					</div>
				</div>
			)}
		</div>
	);
}

function buildDailyIframeSrc(roomUrl: string, token?: string): string {
	if (!token) return roomUrl;
	try {
		const url = new URL(roomUrl);
		url.searchParams.set("t", token);
		return url.toString();
	} catch {
		return `${roomUrl}${roomUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
	}
}

function DailyEmbed({
	iframeSrc,
	onLeave,
}: {
	iframeSrc: string;
	onLeave: () => void;
}) {
	return (
		<div>
			<div className="mb-3 flex justify-end">
				<button
					type="button"
					onClick={onLeave}
					className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					Close room
				</button>
			</div>
			<div
				className="overflow-hidden rounded-lg border border-slate-200 bg-black"
				style={{ width: "100%", height: "600px" }}
				data-daily-embed-parent
			>
				<iframe
					title="Daily.co meeting"
					src={iframeSrc}
					allow="camera; microphone; fullscreen; speaker; display-capture"
					style={{ width: "100%", height: "100%", border: "none" }}
				/>
			</div>
		</div>
	);
}

// ── Active rooms ──────────────────────────────────────────────────

function ActiveRoomsTab() {
	const active = useQuery({
		queryKey: ["meetings", "active"],
		queryFn: () => api.getActiveRooms(),
	});

	if (active.isLoading) {
		return (
			<div className="flex items-center gap-2 p-6 text-sm text-slate-500">
				<Loader2 className="animate-spin" size={16} />
				Loading active rooms…
			</div>
		);
	}

	const rooms = active.data?.rooms ?? [];
	if (rooms.length === 0) {
		return (
			<div className="p-6 max-w-2xl">
				<div className="mb-3 flex items-center gap-2">
					<Users size={16} className="text-slate-400" />
					<h2 className="text-base font-semibold text-slate-900">
						Active rooms
					</h2>
				</div>
				<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
					No active meetings right now.
				</div>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="mb-3 flex items-center gap-2">
				<Users size={16} className="text-slate-400" />
				<h2 className="text-base font-semibold text-slate-900">
					Active rooms
				</h2>
				<span className="ml-2 text-xs text-slate-500">
					{rooms.length} active
				</span>
			</div>
			<ul className="space-y-2">
				{rooms.map((room) => (
					<li
						key={room.name}
						className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
					>
						<span className="truncate text-sm font-medium text-slate-900">
							{room.name}
						</span>
						<a
							href={room.url}
							target="_blank"
							rel="noreferrer"
							className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
						>
							Join
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

// ── History ───────────────────────────────────────────────────────

function HistoryTab() {
	return (
		<div className="p-6 max-w-2xl">
			<div className="mb-3 flex items-center gap-2">
				<Clock size={16} className="text-slate-400" />
				<h2 className="text-base font-semibold text-slate-900">History</h2>
			</div>
			<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
				Meeting history coming soon.
			</div>
		</div>
	);
}
