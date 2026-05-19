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
//     4. Mount the Daily.co iframe via <DailyProvider url=... token=...>
//        wrapping a DailyEmbed child that uses useCallFrame() against a
//        parent div ref.
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

import DailyIframe from "@daily-co/daily-js";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, Users, Video } from "lucide-react";
import { useEffect, useRef } from "react";
import { api, ApiError } from "~/lib/api";

/**
 * "Campus Aurora" — InternJobs Daily.co Prebuilt theme.
 *
 * Picked 2026-05-19 for the college-student recruiting context:
 *   - Vivid violet accent (#7C3AED indigo-600) — energetic without being
 *     childish; matches Gen-Z-coded recruiting tools (Standout, Wellfound)
 *   - Off-white background in light mode reads premium, not corporate
 *   - Lighter violet (#A78BFA violet-400) in dark mode for contrast
 *
 * Slate text/border palette ties into the rest of the Parrot workspace
 * UI which is Tailwind slate-* throughout.
 *
 * Applied via @daily-co/daily-js createFrame({ theme }) — Daily.co does
 * NOT accept `theme` via the REST API, it's a client-side SDK call.
 */
const CAMPUS_AURORA_THEME = {
	colors: {
		// Light mode (default)
		accent: "#7C3AED",
		accentText: "#FFFFFF",
		background: "#FAFAFA",
		backgroundAccent: "#F1F5F9",
		baseText: "#1E293B",
		border: "#E2E8F0",
		mainAreaBg: "#FFFFFF",
		mainAreaBgAccent: "#F8FAFC",
		mainAreaText: "#0F172A",
		supportiveText: "#64748B",
	},
} as const;

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

	return (
		<div className="p-6">
			<div className="mb-3 flex items-center gap-2">
				<Video size={16} className="text-slate-400" />
				<h2 className="text-base font-semibold text-slate-900">Your room</h2>
				<span className="ml-2 truncate text-xs text-slate-500">
					{roomQuery.data.name}
				</span>
			</div>
			{/*
			 * No <DailyProvider> wrapper — DailyPrebuiltFrame uses
			 * DailyIframe.createFrame() which OWNS the call object lifecycle.
			 * Wrapping with DailyProvider creates a SECOND callObject for the
			 * same URL and Daily.co throws "Duplicate DailyIframe instances
			 * are not allowed". The inner frame reads url + token from the
			 * existing react-query cache (no Provider needed).
			 */}
			<DailyEmbed roomUrl={roomUrl} token={token} />
		</div>
	);
}

/**
 * Mounts the actual Daily.co iframe inside a parent div ref. The
 * `useCallFrame()` hook (from @daily-co/daily-react) creates an iframe
 * Call object inside parentElRef when DailyProvider has provided the
 * `url` + `token` factory options.
 *
 * Style: full-width, 600px tall, rounded — same visual envelope as the
 * placeholder card in Phase 10. The iframe itself comes from daily.co
 * and is opaque to us beyond url/token; we only own the parent box.
 */
interface DailyEmbedProps {
	roomUrl: string;
	token?: string;
}

function DailyEmbed({ roomUrl, token }: DailyEmbedProps) {
	return (
		<div
			className="rounded-lg overflow-hidden border border-slate-200"
			style={{ width: "100%", height: "600px", background: "#FAFAFA" }}
			data-daily-embed-parent
		>
			<DailyPrebuiltFrame roomUrl={roomUrl} token={token} />
		</div>
	);
}

/**
 * Renders a Daily.co Prebuilt CallFrame with the Campus Aurora theme.
 *
 * Earlier (Wave-2) implementation rendered a raw `<iframe src={roomUrl}>`
 * which loads Daily.co's hosted UI WITHOUT theming. To apply the
 * CAMPUS_AURORA_THEME we must use the @daily-co/daily-js SDK's
 * `createFrame()` — which accepts a `theme` config and produces a
 * theme-wired iframe under the hood.
 *
 * Lifecycle:
 *   - On mount: createFrame({ url, token, theme, ... }) attached to
 *     parentRef, then frame.join().
 *   - On unmount: frame.destroy() (idempotent — Daily.co handles double-call).
 *   - URL/token changes: tear down + recreate (uncommon — a single
 *     personal room URL is stable for the employee's session).
 */
interface DailyPrebuiltFrameProps {
	roomUrl: string;
	token?: string;
}

function DailyPrebuiltFrame({ roomUrl, token }: DailyPrebuiltFrameProps) {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const frameRef = useRef<ReturnType<typeof DailyIframe.createFrame> | null>(
		null,
	);

	useEffect(() => {
		if (!parentRef.current || !roomUrl) return;

		// Defensive: tear down any prior frame before creating a new one.
		// Daily.co throws "Duplicate DailyIframe instances are not allowed"
		// if createFrame is called twice for the same parent without
		// destroy() in between (e.g., on a fast-refresh in dev).
		if (frameRef.current) {
			try {
				frameRef.current.destroy();
			} catch {
				/* no-op */
			}
			frameRef.current = null;
		}

		const frame = DailyIframe.createFrame(parentRef.current, {
			url: roomUrl,
			token: token ?? undefined,
			theme: CAMPUS_AURORA_THEME,
			iframeStyle: {
				width: "100%",
				height: "100%",
				border: "none",
			},
		});
		frameRef.current = frame;

		// Best-effort auto-join — Daily.co Prebuilt's UI also has a Join
		// button if this fails (e.g., user denies camera permission).
		frame.join().catch((err) => {
			console.warn("Daily.co frame.join() failed (non-fatal)", err);
		});

		return () => {
			try {
				frame.destroy();
			} catch {
				/* no-op */
			}
			if (frameRef.current === frame) frameRef.current = null;
		};
	}, [roomUrl, token]);

	return (
		<div
			ref={parentRef}
			style={{ width: "100%", height: "100%" }}
			data-daily-prebuilt-parent
		/>
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
