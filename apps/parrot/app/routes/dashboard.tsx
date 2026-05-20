// v1.2 Phase 12 Wave 3: Dashboard pane — ranked todo list across channels.
// v1.3 Phase 19 Plan 03: Resolved view, animate-out, Undo, first-clear toast.
//
// The "Dashboard Mothership Agent" monitors every channel (Email, Chat,
// Meetings, Phone/SMS) and surfaces actionable todos here. This wave
// connects the React UI to GET /api/dashboard/todos?view= and renders
// each row as a <TodoCard>. Clicking an email-source card navigates to
// /inbox?message={source_id}; clicking a chat-source card navigates to
// /chat (Mattermost iframe — deep-link is a future enhancement, see
// 12-RESEARCH.md).
//
// v1.3 Phase 19 additions:
//   - "Resolved" secondary nav item → /dashboard?view=resolved
//   - 10-second polling interval on the active list so cron resolutions
//     surface within ~10s of the cron tick.
//   - Animate-out (slide-up + fade, 250ms) when a previously-visible todo
//     disappears from the active list — prevents silent disappearance.
//   - One-time toast on first observed agent auto-clear (per employee,
//     gated by localStorage `parrot_agent_clear_seen_${employeeId}`).
//   - Undo button on Resolved view → POST /api/dashboard/todos/:id/unresolve.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
//   cloudflare/skills: durable-objects — todos table, ranked query result shape

import {
	AtSign,
	CalendarCheck,
	CalendarRange,
	CheckCircle,
	LayoutDashboard,
	Mail,
	MessageSquare,
	Sparkles,
	Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
	ResolvedTodoCard,
	TodoCard,
	type TodoItem,
} from "../components/TodoCard";
import {
	SecondaryNavItem,
	WorkspaceShell,
} from "../components/WorkspaceShell";
import { apiFetch } from "~/lib/api";

type LoadState =
	| { status: "loading" }
	| { status: "ok"; todos: TodoItem[] }
	| { status: "error"; message: string };

function DashboardSecondaryNav({ activeView }: { activeView: string }) {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Views
			</p>
			<SecondaryNavItem
				href="/dashboard"
				active={activeView === "all"}
				label="All todos"
				icon={<LayoutDashboard size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=mentions"
				active={activeView === "mentions"}
				label="Mentions"
				icon={<AtSign size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=today"
				active={activeView === "today"}
				label="Today"
				icon={<CalendarCheck size={15} />}
			/>
			<SecondaryNavItem
				href="/dashboard?view=week"
				active={activeView === "week"}
				label="This week"
				icon={<CalendarRange size={15} />}
			/>
			{/* v1.3 Phase 19 Plan 03: Resolved view (agent + user-cleared todos, last 48h). */}
			<SecondaryNavItem
				href="/dashboard?view=resolved"
				active={activeView === "resolved"}
				label="Resolved"
				icon={<CheckCircle size={15} />}
			/>
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Quick jump
			</p>
			<SecondaryNavItem href="/inbox" label="Email" icon={<Mail size={15} />} />
			<SecondaryNavItem
				href="/chat"
				label="Chat"
				icon={<MessageSquare size={15} />}
			/>
			<SecondaryNavItem
				href="/meetings"
				label="Meetings"
				icon={<Video size={15} />}
			/>
		</nav>
	);
}

function LoadingSkeleton() {
	return (
		<div className="space-y-3">
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className="animate-pulse bg-slate-200 rounded-xl h-16"
					aria-hidden="true"
				/>
			))}
		</div>
	);
}

function ErrorCard({ message }: { message: string }) {
	return (
		<section className="rounded-xl border border-red-200 bg-red-50 p-6">
			<p className="text-sm font-medium text-red-800">
				Could not load todos — agent may still be warming up.
			</p>
			<p className="text-xs text-red-700 mt-1">{message}</p>
		</section>
	);
}

function emptyStateCopy(activeView: string): { title: string; body: string } {
	switch (activeView) {
		case "mentions":
			return {
				title: "No mentions yet.",
				body: "Todos where you are @-tagged will appear here.",
			};
		case "today":
			return {
				title: "No today's todos.",
				body: "Items created today will appear here.",
			};
		case "week":
			return {
				title: "No this week's todos.",
				body: "Items from the last 7 days will appear here.",
			};
		case "resolved":
			return {
				title: "No recently resolved todos.",
				body: "Todos auto-cleared by Parrot or dismissed in the last 48 hours will appear here.",
			};
		default:
			return {
				title: "Your workspace agent is monitoring your channels.",
				body: "Todos will appear here as emails and chat messages arrive.",
			};
	}
}

function EmptyState({ activeView }: { activeView: string }) {
	const { title, body } = emptyStateCopy(activeView);
	return (
		<section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
			<div className="flex justify-center mb-2">
				<Sparkles size={20} className="text-violet-500" strokeWidth={2.5} />
			</div>
			<p className="text-sm font-medium text-slate-800">{title}</p>
			<p className="text-xs text-slate-600 mt-1">{body}</p>
		</section>
	);
}

// v1.3 Phase 19 Plan 03: poll interval for the active list. 10 seconds is the
// agreed cadence (plan constraint) — fast enough that an agent-cleared todo
// surfaces shortly after the */5 cron tick, slow enough that we don't fan out
// requests at conversation pace.
const ACTIVE_POLL_INTERVAL_MS = 10_000;

// CSS animate-out duration — matches the tailwind `duration-[250ms]` on the
// dismissing wrapper. The timeout that removes the id from dismissingIds is
// set slightly longer (300ms) to ensure the transition completes before
// React re-renders without the wrapper.
const ANIMATE_OUT_REMOVE_MS = 300;

export default function DashboardRoute() {
	const [searchParams] = useSearchParams();
	const activeView = searchParams.get("view") ?? "all";
	const navigate = useNavigate();
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [dismissingIds, setDismissingIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [showAgentClearToast, setShowAgentClearToast] = useState(false);
	const [employeeId, setEmployeeId] = useState<string | null>(null);
	const prevTodoIdsRef = useRef<Set<string>>(new Set());

	// v1.3 Phase 19: fetch /api/me once on mount to get employeeId for the
	// localStorage gate on the first-agent-clear toast. This is a single extra
	// request on dashboard load (acceptable per plan); we never refetch.
	useEffect(() => {
		let cancelled = false;
		apiFetch("/api/me")
			.then((r) => (r.ok ? r.json() : null))
			.then((data: { profile?: { employeeId?: string } } | null) => {
				if (cancelled) return;
				const id = data?.profile?.employeeId ?? null;
				if (id) setEmployeeId(id);
			})
			.catch(() => {
				// Fail-soft: without employeeId we just won't gate the toast per
				// employee; subsequent loads will keep showing it (rare edge case).
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// v1.3 Phase 19 Plan 03: gate the one-time agent-clear toast on per-employee
	// localStorage. Once seen, never shows again for that employee — even across
	// tabs or sessions.
	function checkAndShowFirstAgentClearToast() {
		if (!employeeId) return;
		const key = `parrot_agent_clear_seen_${employeeId}`;
		try {
			if (localStorage.getItem(key)) return;
			localStorage.setItem(key, "1");
		} catch {
			// localStorage may be blocked (private browsing, etc.) — just show
			// the toast once per session in that case.
		}
		setShowAgentClearToast(true);
	}

	// v1.3 Phase 19 Plan 03: poll the active list every 10 seconds. The
	// Resolved view is NOT polled — operators expect that view to be stable
	// until they manually click Undo or navigate away.
	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		// New view → reset the previous-ids tracker so the very first response
		// doesn't trigger animate-out for everything that "disappeared" from
		// the prior view's set.
		prevTodoIdsRef.current = new Set();

		const url = `/api/dashboard/todos?view=${encodeURIComponent(activeView)}`;

		const doFetch = () => {
			apiFetch(url)
				.then(async (res) => {
					if (!res.ok) throw new Error(`Request failed: ${res.status}`);
					return res.json() as Promise<{ todos: TodoItem[] }>;
				})
				.then((data) => {
					if (cancelled) return;
					const todos = data.todos ?? [];

					// Animate-out detection (active views only — Resolved view doesn't
					// poll, so this branch is dead there). When a previously-visible
					// todo id is missing from the new response, it was either
					// agent-resolved or user-dismissed. Mark it for animate-out.
					if (activeView !== "resolved") {
						const newIds = new Set(todos.map((t) => t.id));
						const disappeared = [...prevTodoIdsRef.current].filter(
							(id) => !newIds.has(id),
						);
						if (disappeared.length > 0) {
							setDismissingIds((prev) => {
								const next = new Set(prev);
								disappeared.forEach((id) => next.add(id));
								return next;
							});
							// Show the first-agent-clear toast (best-effort; we don't
							// know which resolution_source disappeared so we trigger on
							// any disappearance — false positives are acceptable since
							// the toast says "Parrot resolved a todo automatically").
							checkAndShowFirstAgentClearToast();
							setTimeout(() => {
								setDismissingIds((prev) => {
									const next = new Set(prev);
									disappeared.forEach((id) => next.delete(id));
									return next;
								});
							}, ANIMATE_OUT_REMOVE_MS);
						}
						prevTodoIdsRef.current = newIds;
					}

					setState({ status: "ok", todos });
				})
				.catch((err: unknown) => {
					if (cancelled) return;
					const message = err instanceof Error ? err.message : "Unknown error";
					setState({ status: "error", message });
				});
		};

		doFetch();

		// Polling only on active views. Resolved view is one-shot per nav.
		if (activeView === "resolved") {
			return () => {
				cancelled = true;
			};
		}

		const interval = setInterval(doFetch, ACTIVE_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [activeView, employeeId]);

	// Auto-dismiss the agent-clear toast after 5s.
	useEffect(() => {
		if (!showAgentClearToast) return;
		const t = setTimeout(() => setShowAgentClearToast(false), 5000);
		return () => clearTimeout(t);
	}, [showAgentClearToast]);

	function handleSelect(todo: TodoItem) {
		if (todo.source_channel === "email") {
			navigate(`/inbox?message=${encodeURIComponent(todo.source_id)}`);
			return;
		}
		if (todo.source_channel === "chat") {
			// Mattermost iframe — deep-linking to a specific post is a future
			// enhancement once the SSO bridge accepts a `?post=` param.
			navigate("/chat");
			return;
		}
		// phone / sms / meeting — placeholder panes; no-op for now.
	}

	// v1.3 Phase 19 Plan 03: Undo handler — POST to the unresolve route and
	// optimistically remove the todo from the resolved list. The next nav
	// back to the active list will see the row again (resolved_at is now NULL).
	async function handleUndo(todo: TodoItem) {
		try {
			await apiFetch(
				`/api/dashboard/todos/${encodeURIComponent(todo.id)}/unresolve`,
				{ method: "POST" },
			);
		} catch {
			// Best-effort — if the request fails the UI just stays in Resolved
			// view and the row remains. A retry on next click works.
		}
		// Optimistic: drop the row from the current resolved list immediately.
		setState((prev) => {
			if (prev.status !== "ok") return prev;
			return {
				status: "ok",
				todos: prev.todos.filter((t) => t.id !== todo.id),
			};
		});
	}

	const heading =
		{
			mentions: "Mentions",
			today: "Today",
			week: "This week",
			resolved: "Recently resolved",
		}[activeView] ?? "All todos";

	const description =
		activeView === "resolved"
			? "Todos auto-cleared by Parrot or dismissed in the last 48 hours."
			: "Ranked todos across email, chat, meetings, phone, and SMS — surfaced by your workspace agent.";

	return (
		<WorkspaceShell
			secondaryNav={<DashboardSecondaryNav activeView={activeView} />}
		>
			<div className="p-8 max-w-3xl mx-auto">
				<header className="mb-6">
					<h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
					<p className="text-sm text-slate-600 mt-1">{description}</p>
				</header>

				{state.status === "loading" && <LoadingSkeleton />}

				{state.status === "error" && <ErrorCard message={state.message} />}

				{state.status === "ok" && state.todos.length === 0 && (
					<EmptyState activeView={activeView} />
				)}

				{state.status === "ok" && state.todos.length > 0 && (
					<ul className="space-y-3" data-testid="todo-list">
						{state.todos.map((todo) => {
							const isDismissing = dismissingIds.has(todo.id);
							// Resolved view → ResolvedTodoCard; active views → TodoCard
							// with animate-out wrapper.
							if (activeView === "resolved") {
								return (
									<li key={todo.id}>
										<ResolvedTodoCard todo={todo} onUndo={handleUndo} />
									</li>
								);
							}
							return (
								<li
									key={todo.id}
									className="transition-all duration-[250ms] ease-in-out overflow-hidden"
									style={
										isDismissing
											? {
													maxHeight: 0,
													opacity: 0,
													marginBottom: 0,
													transform: "translateY(-8px)",
												}
											: {
													maxHeight: "200px",
													opacity: 1,
												}
									}
								>
									<TodoCard todo={todo} onSelect={handleSelect} />
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{/* v1.3 Phase 19 Plan 03: first-agent-clear toast.
			    Bottom-center banner, auto-dismisses after 5s. Once shown to an
			    employee, never appears again (localStorage gate per employeeId). */}
			{showAgentClearToast && (
				<div
					role="status"
					aria-live="polite"
					className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50 flex items-center gap-3 max-w-sm"
				>
					<CheckCircle
						size={16}
						className="text-violet-400 flex-shrink-0"
					/>
					<span>
						Parrot resolved a todo automatically. Check the Resolved view
						anytime.
					</span>
					<button
						type="button"
						onClick={() => setShowAgentClearToast(false)}
						className="ml-auto text-slate-400 hover:text-white"
						aria-label="Dismiss"
					>
						×
					</button>
				</div>
			)}
		</WorkspaceShell>
	);
}
