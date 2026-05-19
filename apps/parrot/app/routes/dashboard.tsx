// v1.2 Phase 12 Wave 3: Dashboard pane — ranked todo list across channels.
//
// The "Dashboard Mothership Agent" monitors every channel (Email, Chat,
// Meetings, Phone/SMS) and surfaces actionable todos here. This wave
// connects the React UI to GET /api/dashboard/todos?view= and renders
// each row as a <TodoCard>. Clicking an email-source card navigates to
// /inbox?message={source_id}; clicking a chat-source card navigates to
// /chat (Mattermost iframe — deep-link is a future enhancement, see
// 12-RESEARCH.md).
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
//   cloudflare/skills: durable-objects — todos table, ranked query result shape

import {
	AtSign,
	CalendarCheck,
	CalendarRange,
	LayoutDashboard,
	Mail,
	MessageSquare,
	Sparkles,
	Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { TodoCard, type TodoItem } from "../components/TodoCard";
import {
	SecondaryNavItem,
	WorkspaceShell,
} from "../components/WorkspaceShell";

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

export default function DashboardRoute() {
	const [searchParams] = useSearchParams();
	const activeView = searchParams.get("view") ?? "all";
	const navigate = useNavigate();
	const [state, setState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });

		const url = `/api/dashboard/todos?view=${encodeURIComponent(activeView)}`;
		fetch(url, {
			credentials: "include",
			headers: { Accept: "application/json" },
		})
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`Request failed: ${res.status}`);
				}
				return res.json() as Promise<{ todos: TodoItem[] }>;
			})
			.then((data) => {
				if (cancelled) return;
				setState({ status: "ok", todos: data.todos ?? [] });
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const message =
					err instanceof Error ? err.message : "Unknown error";
				setState({ status: "error", message });
			});

		return () => {
			cancelled = true;
		};
	}, [activeView]);

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

	const heading =
		{
			mentions: "Mentions",
			today: "Today",
			week: "This week",
		}[activeView] ?? "All todos";

	return (
		<WorkspaceShell
			secondaryNav={<DashboardSecondaryNav activeView={activeView} />}
		>
			<div className="p-8 max-w-3xl mx-auto">
				<header className="mb-6">
					<h1 className="text-2xl font-semibold text-slate-900">
						{heading}
					</h1>
					<p className="text-sm text-slate-600 mt-1">
						Ranked todos across email, chat, meetings, phone, and SMS —
						surfaced by your workspace agent.
					</p>
				</header>

				{state.status === "loading" && <LoadingSkeleton />}

				{state.status === "error" && <ErrorCard message={state.message} />}

				{state.status === "ok" && state.todos.length === 0 && (
					<EmptyState activeView={activeView} />
				)}

				{state.status === "ok" && state.todos.length > 0 && (
					<ul className="space-y-3" data-testid="todo-list">
						{state.todos.map((todo) => (
							<li key={todo.id}>
								<TodoCard todo={todo} onSelect={handleSelect} />
							</li>
						))}
					</ul>
				)}
			</div>
		</WorkspaceShell>
	);
}
