// v1.3.1 Agent Lift: Parrot Agent panel.
//
// Lifted in spirit from apps/agentic-inbox/app/components/AgentPanel.tsx,
// re-implemented to fit Parrot's stack:
//
//   agentic-inbox       →  parrot
//   @cloudflare/kumo    →  Tailwind classes + lucide icons
//   @phosphor-icons     →  lucide-react
//   @cloudflare/ai-chat →  HTTP POST to /api/inbox/agent/chat
//   agents/react        →  React useState (stateless conversation)
//   react-markdown      →  plain whitespace-pre-wrap (no markdown needed
//                          for our short summaries / drafts; markdown lift
//                          can come later if user feedback wants it)
//   useUIStore (zustand)→  prop callback (onDraftSavedToCompose)
//
// The agent is REQUEST-RESPONSE, not streaming, in v1.3.1. The Cloudflare
// AI Gateway path used by callAiGateway in workers/lib/ai.ts could be
// taught to stream later, but the per-employee quota + cache benefits
// of going through the gateway are more valuable for v1.3.1 than the UX
// gain from streaming.
//
// White-label: every label says "Parrot Agent" or just "Agent". No mention
// of agentic-inbox, the donor app, or Maya.

import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	Bot,
	Copy,
	Loader2,
	PenLine,
	Send,
	Sparkles,
	StickyNote,
	User,
	Wrench,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "~/lib/api";
import { MCPPanel } from "./MCPPanel";

export type AgentInitialAction =
	| "summarize"
	| "draft"
	| "translate"
	| "extract"
	| "chat";

export interface AgentPanelProps {
	emailId: string;
	initialAction?: AgentInitialAction | null;
	onClose: () => void;
	/** Called when the user clicks "Open in compose" on a generated draft. */
	onDraftSavedToCompose?: (bodyText: string) => void;
}

interface AgentMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	/** When true, render a "Edit in compose" button on this message. */
	isDraft?: boolean;
	/** When true, render a "Save to Drafts folder" button on this message. */
	canSaveAsDraft?: boolean;
	/** When set, render a bulleted action list. */
	actions?: string[];
	error?: string;
	blocked?: boolean;
}

function uid() {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SAMPLE_TARGET_LANGUAGES = [
	"Spanish",
	"Hindi",
	"French",
	"German",
	"Mandarin",
];

export function AgentPanel({
	emailId,
	initialAction,
	onClose,
	onDraftSavedToCompose,
}: AgentPanelProps) {
	const [tab, setTab] = useState<"chat" | "tools">("chat");
	const [messages, setMessages] = useState<AgentMessage[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [draftInstructions, setDraftInstructions] = useState("");
	const [translateLang, setTranslateLang] = useState("Spanish");
	const [showTranslateMenu, setShowTranslateMenu] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Server-suggested prompts (cheap GET that also validates the
	// emailId belongs to this employee before exposing hints).
	const { data: conversation } = useQuery({
		queryKey: ["parrot", "agent", "conversation", emailId],
		queryFn: () => api.agentConversation(emailId),
		retry: (count, err) => {
			if (err instanceof ApiError && err.status === 404) return false;
			return count < 1;
		},
	});

	// ── Mutations ──────────────────────────────────────────────────

	const summarizeMut = useMutation({
		mutationFn: () => api.agentSummarize(emailId),
		onSuccess: (data) => {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					role: "assistant",
					content: data.summary ?? "",
					error: data.error,
					blocked: data.blocked,
				},
			]);
		},
	});

	const extractMut = useMutation({
		mutationFn: () => api.agentExtractActions(emailId),
		onSuccess: (data) => {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					role: "assistant",
					content:
						data.actions && data.actions.length > 0
							? `Found ${data.actions.length} action item${data.actions.length > 1 ? "s" : ""}:`
							: data.actions && data.actions.length === 0
								? "No action items in this email."
								: "",
					actions: data.actions,
					error: data.error,
					blocked: data.blocked,
				},
			]);
		},
	});

	const translateMut = useMutation({
		mutationFn: (lang: string) => api.agentTranslate(emailId, lang),
		onSuccess: (data) => {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					role: "assistant",
					content: data.translation ?? "",
					error: data.error,
				},
			]);
		},
	});

	const draftMut = useMutation({
		mutationFn: (input: { instructions?: string; save?: boolean }) =>
			api.agentDraftReply(emailId, input.instructions, input.save ?? false),
		onSuccess: (data) => {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					role: "assistant",
					content: data.draft_text ?? "",
					isDraft: !!data.draft_text,
					canSaveAsDraft: !!data.draft_text && !data.draft_id,
					error: data.error,
					blocked: data.blocked,
				},
			]);
		},
	});

	const chatMut = useMutation({
		mutationFn: (
			conversation: Array<{ role: "user" | "assistant"; content: string }>,
		) => api.agentChat(conversation, emailId),
		onSuccess: (data) => {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					role: "assistant",
					content: data.reply ?? "",
					error: data.error,
				},
			]);
		},
	});

	const isStreaming =
		summarizeMut.isPending ||
		extractMut.isPending ||
		translateMut.isPending ||
		draftMut.isPending ||
		chatMut.isPending;

	// ── Effects ────────────────────────────────────────────────────

	// Auto-scroll to bottom when messages change.
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, isStreaming]);

	// Focus input on mount.
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Reset conversation when emailId changes (each email gets its own
	// fresh agent context).
	useEffect(() => {
		setMessages([]);
		setInputValue("");
		setDraftInstructions("");
		setShowTranslateMenu(false);
	}, [emailId]);

	// Fire initial action on mount.
	useEffect(() => {
		if (!initialAction) return;
		// Use a microtask to ensure messages reset first.
		queueMicrotask(() => {
			if (initialAction === "summarize") summarizeMut.mutate();
			else if (initialAction === "extract") extractMut.mutate();
			else if (initialAction === "draft") draftMut.mutate({});
			else if (initialAction === "translate") setShowTranslateMenu(true);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialAction, emailId]);

	// ── Helpers ────────────────────────────────────────────────────

	function sendChat() {
		const text = inputValue.trim();
		if (!text || isStreaming) return;
		const userMessage: AgentMessage = {
			id: uid(),
			role: "user",
			content: text,
		};
		const next = [...messages, userMessage];
		setMessages(next);
		setInputValue("");
		// Only forward role+content to the server (strip UI-only fields).
		chatMut.mutate(
			next.map((m) => ({ role: m.role, content: m.content })),
		);
	}

	function copy(text: string) {
		void navigator.clipboard.writeText(text).catch(() => {
			/* clipboard unavailable — ignore silently */
		});
	}

	// ── Render ─────────────────────────────────────────────────────

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white">
				<div className="flex items-center gap-2">
					<div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
						<Sparkles size={12} />
					</div>
					<span className="text-xs font-semibold text-slate-700">
						Parrot Agent
					</span>
				</div>
				<div className="flex items-center gap-1">
					{/* Segmented tab: Agent */}
					<button
						type="button"
						onClick={() => setTab("chat")}
						className={`inline-flex items-center gap-0.5 rounded-l border px-2 py-0.5 text-[10px] font-medium ${
							tab === "chat"
								? "border-indigo-300 bg-indigo-50 text-indigo-700"
								: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
						}`}
						title="Agent chat and quick actions"
					>
						<Sparkles size={10} />
						Agent
					</button>
					{/* Segmented tab: MCP */}
					<button
						type="button"
						onClick={() => setTab("tools")}
						className={`inline-flex items-center gap-0.5 rounded-r border-t border-r border-b px-2 py-0.5 text-[10px] font-medium ${
							tab === "tools"
								? "border-indigo-300 bg-indigo-50 text-indigo-700"
								: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
						}`}
						title="MCP tool catalog"
					>
						<Wrench size={10} />
						MCP
					</button>
					<button
						type="button"
						onClick={onClose}
						className="text-slate-400 hover:text-slate-700 ml-1"
						aria-label="Close agent"
					>
						<X size={14} />
					</button>
				</div>
			</div>

			{/* When the Tools tab is active, hand off to MCPPanel. */}
			{tab === "tools" ? (
				<div className="flex-1 min-h-0">
					<MCPPanel />
				</div>
			) : (
			<>

			{/* Quick-action bar */}
			<div className="border-b border-slate-100 bg-slate-50 px-3 py-2 flex flex-wrap gap-1.5">
				<button
					type="button"
					disabled={isStreaming}
					onClick={() => summarizeMut.mutate()}
					className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					<StickyNote size={11} />
					Summarize
				</button>
				<button
					type="button"
					disabled={isStreaming}
					onClick={() => draftMut.mutate({})}
					className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					<PenLine size={11} />
					Draft reply
				</button>
				<button
					type="button"
					disabled={isStreaming}
					onClick={() => extractMut.mutate()}
					className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					<Sparkles size={11} />
					Action items
				</button>
				<div className="relative inline-block">
					<button
						type="button"
						disabled={isStreaming}
						onClick={() => setShowTranslateMenu((v) => !v)}
						className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
					>
						<Sparkles size={11} />
						Translate
					</button>
					{showTranslateMenu && (
						<div className="absolute right-0 mt-1 z-10 w-40 rounded-md border border-slate-200 bg-white shadow-lg">
							{SAMPLE_TARGET_LANGUAGES.map((lang) => (
								<button
									key={lang}
									type="button"
									className="block w-full text-left px-2 py-1 text-xs hover:bg-slate-50"
									onClick={() => {
										setTranslateLang(lang);
										setShowTranslateMenu(false);
										translateMut.mutate(lang);
									}}
								>
									{lang}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-3 text-center px-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
							<Bot size={20} className="text-indigo-700" />
						</div>
						<p className="text-[11px] text-slate-500 leading-relaxed">
							I can summarize this thread, draft a reply, extract
							action items, translate the body, or answer freeform
							questions about it.
						</p>
						{conversation?.suggested_prompts && (
							<div className="flex flex-col gap-1.5 w-full">
								{conversation.suggested_prompts.map((prompt) => (
									<button
										key={prompt}
										type="button"
										onClick={() => {
											setInputValue(prompt);
											setTimeout(() => sendChat(), 0);
										}}
										className="text-left px-2.5 py-1.5 rounded-md border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50"
									>
										{prompt}
									</button>
								))}
							</div>
						)}
					</div>
				) : (
					<div className="flex flex-col gap-2.5">
						{messages.map((msg) => (
							<MessageBubble
								key={msg.id}
								msg={msg}
								onCopy={copy}
								onEditInCompose={
									onDraftSavedToCompose
										? () => onDraftSavedToCompose(msg.content)
										: undefined
								}
								onSaveAsDraft={
									msg.canSaveAsDraft
										? () => draftMut.mutate({ save: true })
										: undefined
								}
							/>
						))}
						{isStreaming && (
							<div className="flex items-center gap-2 text-[11px] text-slate-500">
								<Loader2 size={12} className="animate-spin" />
								<span>Thinking…</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Draft instructions row (visible when last action is draft) */}
			{messages.some((m) => m.isDraft) && (
				<div className="border-t border-slate-100 bg-slate-50 px-3 py-2 flex items-center gap-1.5">
					<input
						type="text"
						value={draftInstructions}
						onChange={(e) => setDraftInstructions(e.target.value)}
						placeholder="Refine: 'make it shorter', 'more formal', ..."
						className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
					/>
					<button
						type="button"
						disabled={isStreaming || !draftInstructions.trim()}
						onClick={() => {
							draftMut.mutate({
								instructions: draftInstructions.trim(),
							});
							setDraftInstructions("");
						}}
						className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
					>
						Re-draft
					</button>
				</div>
			)}

			{/* Input */}
			<div className="border-t border-slate-200 bg-white px-3 py-2 flex items-end gap-1.5">
				<textarea
					ref={inputRef}
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							sendChat();
						}
					}}
					placeholder="Ask the agent…"
					rows={1}
					aria-label="Ask the agent"
					className="flex-1 resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 min-h-[32px] max-h-[120px]"
					onInput={(e) => {
						const t = e.target as HTMLTextAreaElement;
						t.style.height = "auto";
						t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
					}}
				/>
				<button
					type="button"
					onClick={sendChat}
					disabled={!inputValue.trim() || isStreaming}
					className="rounded-md bg-slate-900 p-1.5 text-white hover:bg-slate-800 disabled:opacity-50"
					aria-label="Send"
				>
					<Send size={14} />
				</button>
			</div>
			</>
			)}
		</div>
	);
}

function MessageBubble({
	msg,
	onCopy,
	onEditInCompose,
	onSaveAsDraft,
}: {
	msg: AgentMessage;
	onCopy: (text: string) => void;
	onEditInCompose?: () => void;
	onSaveAsDraft?: () => void;
}) {
	const isUser = msg.role === "user";

	if (msg.error) {
		return (
			<div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
				<AlertTriangle size={12} className="mt-0.5 shrink-0" />
				<div>
					{msg.blocked
						? "Blocked: the email contains untrusted instructions. The agent refused to act on it."
						: msg.error}
				</div>
			</div>
		);
	}

	return (
		<div
			className={`flex gap-1.5 ${
				isUser ? "flex-row-reverse" : "flex-row"
			}`}
		>
			<div
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
					isUser
						? "bg-slate-900 text-white"
						: "bg-indigo-100 text-indigo-700"
				}`}
			>
				{isUser ? <User size={10} /> : <Bot size={10} />}
			</div>
			<div
				className={`flex flex-col gap-1 max-w-[88%] min-w-0 ${
					isUser ? "items-end" : "items-start"
				}`}
			>
				<div
					className={`rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
						isUser
							? "bg-slate-900 text-white rounded-br-sm"
							: "bg-slate-100 text-slate-800 rounded-bl-sm"
					}`}
				>
					{msg.content || (msg.actions ? "" : "(empty response)")}
					{msg.actions && msg.actions.length > 0 && (
						<ul className="mt-1.5 list-disc pl-4 space-y-0.5">
							{msg.actions.map((a, i) => (
								<li key={i}>{a}</li>
							))}
						</ul>
					)}
				</div>
				{!isUser && msg.content && (
					<div className="flex gap-1">
						<button
							type="button"
							className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
							onClick={() => onCopy(msg.content)}
							title="Copy"
						>
							<Copy size={10} />
							Copy
						</button>
						{msg.isDraft && onEditInCompose && (
							<button
								type="button"
								className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100"
								onClick={onEditInCompose}
								title="Open in compose"
							>
								<PenLine size={10} />
								Edit in compose
							</button>
						)}
						{onSaveAsDraft && (
							<button
								type="button"
								className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
								onClick={onSaveAsDraft}
								title="Save to Drafts folder"
							>
								Save to Drafts
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
