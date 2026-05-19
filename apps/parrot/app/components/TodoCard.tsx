// v1.2 Phase 12 Wave 3: TodoCard — reusable card for the Dashboard pane.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers AI via AI Gateway (per-employee quota + prompt cache)
//   cloudflare/skills: agents-sdk — Agent state, scheduling, onMessage patterns
//   cloudflare/skills: durable-objects — todos table, ranked query result shape
//
// NOTE: All LLM calls in the Parrot app route through the Cloudflare AI
// Gateway (gateway.ai.cloudflare.com), NOT direct Workers AI REST. See
// workers/lib/ai.ts. The student app at apps/app/ uses direct Workers AI
// REST — do not conflate.
//
// Anatomy:
//   [Source icon 36px]  [Title — 2-line clamp]                        [Urgency dot]
//                       [Preview — 1-line clamp, text-xs slate-500]
//                       [Age badge]  [Deadline chip (optional)]
//
// The component is presentation-only — navigation lives in the parent
// (dashboard.tsx) via the `onSelect` callback. This keeps the card
// reusable from other surfaces (search, settings, etc.) without baking
// in any particular route.

import {
	Mail,
	MessageCircle,
	MessageSquare,
	Phone,
	Video,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

/** Shape returned by EmployeeMailboxDO.getTodos() — keep in lockstep with workers/durableObject/index.ts. */
export interface TodoItem {
	id: string;
	employee_id: string;
	source_channel: "email" | "chat" | "phone" | "sms" | "meeting";
	source_id: string;
	title: string;
	preview?: string | null;
	urgency_score: number;
	deadline_at?: string | null;
	mentioned_actors?: string[];
	is_mention: boolean;
	created_at: string;
	resolved_at?: string | null;
	/**
	 * v1.3 Phase 19: HOW the todo was resolved. Optional so existing callers
	 * that construct TodoItem objects (smoke tests, stubs, Phase 12 ranked
	 * query result before the migration runs) remain valid without updates.
	 *   - 'agent' : auto-cleared by the cron — render with violet Agent pill + Undo
	 *   - 'user'  : explicit manual dismiss (future) — render with grey You pill
	 *   - null/undefined : active todo (NULL in SQLite) OR legacy resolved
	 *     row from cleanupTodosForEmail — UI treats this as "You" in the Resolved view.
	 */
	resolution_source?: "agent" | "user" | null;
	/** Active-list rank score. Absent in resolved-view payload. */
	rank?: number;
}

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

const SOURCE_ICON: Record<
	TodoItem["source_channel"],
	{ Icon: LucideIcon; color: string; bg: string }
> = {
	email: { Icon: Mail, color: "text-violet-600", bg: "bg-violet-100" },
	chat: { Icon: MessageSquare, color: "text-sky-600", bg: "bg-sky-100" },
	phone: { Icon: Phone, color: "text-slate-400", bg: "bg-slate-100" },
	sms: { Icon: MessageCircle, color: "text-slate-400", bg: "bg-slate-100" },
	meeting: { Icon: Video, color: "text-amber-600", bg: "bg-amber-100" },
};

function urgencyDotColor(score: number): string {
	if (score >= 70) return "bg-red-500";
	if (score >= 40) return "bg-amber-400";
	return "bg-slate-300";
}

function formatAge(createdAt: string): string {
	const created = new Date(createdAt).getTime();
	if (Number.isNaN(created)) return "";
	const diffMs = Date.now() - created;
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function formatDeadline(deadlineAt: string): {
	label: string;
	tone: "overdue" | "soon" | "default";
} {
	const deadline = new Date(deadlineAt);
	if (Number.isNaN(deadline.getTime())) {
		return { label: "", tone: "default" };
	}
	const now = Date.now();
	const diffMs = deadline.getTime() - now;
	const within24h = diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
	const tone: "overdue" | "soon" | "default" =
		diffMs < 0 ? "overdue" : within24h ? "soon" : "default";

	// Pick the right human format depending on how far away it is.
	const sameWeek = Math.abs(diffMs) < 7 * 24 * 60 * 60 * 1000;
	const label = sameWeek
		? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(deadline)
		: new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
			}).format(deadline);
	return { label: `Due ${label}`, tone };
}

interface TodoCardProps {
	todo: TodoItem;
	onSelect: (todo: TodoItem) => void;
}

export function TodoCard({ todo, onSelect }: TodoCardProps) {
	const { Icon, color, bg } = SOURCE_ICON[todo.source_channel] ?? SOURCE_ICON.email;
	const age = formatAge(todo.created_at);
	const deadline = todo.deadline_at ? formatDeadline(todo.deadline_at) : null;

	const deadlineToneClass =
		deadline?.tone === "overdue"
			? "bg-red-100 text-red-700"
			: deadline?.tone === "soon"
				? "bg-amber-100 text-amber-700"
				: "bg-slate-100 text-slate-600";

	return (
		<button
			type="button"
			onClick={() => onSelect(todo)}
			className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md transition-all flex items-start gap-3 group"
		>
			<div
				className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${bg}`}
				aria-label={`${todo.source_channel} source`}
			>
				<Icon size={18} className={color} strokeWidth={2} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-start gap-2">
					<h3 className="text-sm font-medium text-slate-900 line-clamp-2 flex-1 group-hover:text-slate-700">
						{todo.title}
					</h3>
					<span
						aria-label={`urgency ${todo.urgency_score}`}
						title={`Urgency ${todo.urgency_score}`}
						className={`flex-shrink-0 mt-1.5 w-2 h-2 rounded-full ${urgencyDotColor(todo.urgency_score)}`}
					/>
				</div>

				{todo.preview && (
					<p className="text-xs text-slate-500 mt-1 line-clamp-1">
						{todo.preview}
					</p>
				)}

				<div className="mt-2 flex items-center gap-2 flex-wrap">
					{age && (
						<span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
							{age}
						</span>
					)}
					{deadline && deadline.label && (
						<span
							className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${deadlineToneClass}`}
						>
							{deadline.label}
						</span>
					)}
					{todo.is_mention && (
						<span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
							@mention
						</span>
					)}
				</div>
			</div>
		</button>
	);
}

export default TodoCard;

// ─── v1.3 Phase 19 Plan 03: ResolvedTodoCard ───────────────────────────────────
//
// Variant of TodoCard for the Resolved view (/dashboard?view=resolved).
//
// Visual differences from TodoCard:
//   - Lower visual weight (opacity-80, muted title color).
//   - Pill badge: violet "Agent" for resolution_source='agent',
//     grey "You" for null/'user'.
//   - Relative timestamp shows resolved_at, not created_at.
//   - Inline "Undo" button (only when resolution_source='agent') — calls
//     onUndo(todo) which the parent wires to POST /api/dashboard/todos/:id/unresolve.
//
// NOT a boolean-prop variant of TodoCard: the two have meaningfully different
// interaction models (TodoCard navigates to inbox/chat on click; ResolvedTodoCard
// has no primary click action and renders a stand-alone Undo button), so a
// single component with `resolved?: boolean` would muddle both.
//
// AUTO-CLEAR-UX-01, AUTO-CLEAR-UX-02

interface ResolvedTodoCardProps {
	todo: TodoItem;
	onUndo: (todo: TodoItem) => void;
}

export function ResolvedTodoCard({ todo, onUndo }: ResolvedTodoCardProps) {
	const { Icon, color, bg } =
		SOURCE_ICON[todo.source_channel] ?? SOURCE_ICON.email;
	const resolvedAge = todo.resolved_at ? formatAge(todo.resolved_at) : "";

	const isAgent = todo.resolution_source === "agent";
	const pillClass = isAgent
		? "bg-violet-100 text-violet-700"
		: "bg-slate-100 text-slate-500";
	const pillLabel = isAgent ? "Agent" : "You";

	return (
		<div className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-start gap-3 opacity-80">
			<div
				className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${bg}`}
				aria-label={`${todo.source_channel} source`}
			>
				<Icon size={18} className={color} strokeWidth={2} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-start gap-2">
					<h3 className="text-sm font-medium text-slate-500 line-clamp-2 flex-1">
						{todo.title}
					</h3>
				</div>

				<div className="mt-2 flex items-center gap-2 flex-wrap">
					<span
						className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${pillClass}`}
					>
						{pillLabel}
					</span>
					{resolvedAge && (
						<span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
							resolved {resolvedAge}
						</span>
					)}
					{isAgent && (
						<button
							type="button"
							onClick={() => onUndo(todo)}
							className="ml-auto text-xs text-slate-400 hover:text-slate-600 underline"
						>
							Undo
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
