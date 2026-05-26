// v1.3.1 BACKFILL: ComposePane — modal-style compose/reply/forward UI.
//
// Functional analog of apps/agentic-inbox/app/components/ComposeEmail.tsx
// + ComposePanel.tsx, rewritten in Tailwind to drop the @cloudflare/kumo
// dependency. Parrot doesn't use Kumo anywhere else (see InboxPane.tsx,
// WorkspaceShell.tsx) and we're not going to take it on just for compose.
//
// Three modes:
//   - mode='compose'  — fresh email, POSTs to /api/inbox/send
//   - mode='reply'    — threaded reply, POSTs to /api/inbox/messages/:id/reply
//   - mode='forward'  — new thread, POSTs to /api/inbox/messages/:id/forward
//
// Pre-filled fields:
//   - reply: to = original sender, subject prefixed with "Re:"
//   - forward: subject prefixed with "Fwd:", body quotes original
//
// The Banner-style error display, the Send button states, and the close
// behavior all follow Parrot's existing slate-tone Tailwind palette so
// the pane visually matches InboxPane / WorkspaceShell.

import { Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type InboxMessage } from "~/lib/api";
import { fireConfetti, incrementEmailRespondedCount } from "~/lib/confetti";
import RichTextEditor from "./RichTextEditor";

export type ComposeMode = "compose" | "reply" | "forward";

interface ComposePaneProps {
	mode: ComposeMode;
	/**
	 * Original message for reply/forward modes.
	 *
	 * v1.3.1 Agent Lift: `agent_draft_body` is an optional shadow field
	 * injected by InboxPane when the user clicks "Edit in compose" on an
	 * agent-generated draft. When present, the reply body is pre-filled
	 * with the agent text followed by the standard quoted block.
	 */
	original?:
		| (InboxMessage & { body?: string; agent_draft_body?: string })
		| null;
	onClose: () => void;
	onSent?: (sentMessageId: string) => void;
}

function prefixSubject(prefix: string, subject: string | null | undefined): string {
	const s = (subject ?? "").trim();
	if (!s) return prefix;
	if (s.toLowerCase().startsWith(prefix.toLowerCase())) return s;
	return `${prefix} ${s}`;
}

function buildQuotedHtml(
	original: (InboxMessage & { body?: string }) | null | undefined,
): string {
	if (!original?.body) return "";
	// Sanitize-ish: we render the original body inside a blockquote — the
	// server-side reader iframes the original separately, so this is for
	// editing context only. The DO doesn't re-render this HTML elsewhere.
	const safeSender = (original.sender ?? "unknown").replace(/[<>]/g, "");
	const safeDate = (original.date ?? "").replace(/[<>]/g, "");
	return `<p></p><blockquote>On ${safeDate}, ${safeSender} wrote:<br>${original.body}</blockquote>`;
}

export function ComposePane({
	mode,
	original,
	onClose,
	onSent,
}: ComposePaneProps) {
	const [to, setTo] = useState<string>("");
	const [cc, setCc] = useState<string>("");
	const [bcc, setBcc] = useState<string>("");
	const [showCcBcc, setShowCcBcc] = useState<boolean>(false);
	const [subject, setSubject] = useState<string>("");
	const [body, setBody] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const [isSending, setIsSending] = useState<boolean>(false);

	// Pre-fill on mount when reply/forward.
	useEffect(() => {
		if (mode === "reply" && original) {
			setTo(original.sender ?? "");
			setSubject(prefixSubject("Re:", original.subject));
			// v1.3.1 Agent Lift: when InboxPane injected an agent_draft_body,
			// pre-fill the editor with it (wrapped in a simple <p> so the
			// TipTap editor renders the linebreaks) followed by the standard
			// quoted-original block. Otherwise fall back to just the quoted
			// block (existing behavior).
			const agentText = original.agent_draft_body?.trim();
			if (agentText) {
				const agentHtml = `<p>${agentText
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/\n/g, "</p><p>")}</p>`;
				setBody(`${agentHtml}${buildQuotedHtml(original)}`);
			} else {
				setBody(buildQuotedHtml(original));
			}
		} else if (mode === "forward" && original) {
			setTo("");
			setSubject(prefixSubject("Fwd:", original.subject));
			setBody(buildQuotedHtml(original));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const formTitle =
		mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "New message";

	async function handleSend(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!to.trim()) {
			setError("Please enter at least one recipient.");
			return;
		}
		if (!subject.trim()) {
			setError("Please enter a subject.");
			return;
		}

		setIsSending(true);
		try {
			// Split comma-separated email lists into arrays; the server schema
			// accepts both a single string and an array, so single-recipient
			// flows stay simple.
			const splitList = (s: string) =>
				s
					.split(/[,;]/)
					.map((x) => x.trim())
					.filter(Boolean);

			const toList = splitList(to);
			const ccList = cc ? splitList(cc) : undefined;
			const bccList = bcc ? splitList(bcc) : undefined;

			const payload = {
				to: toList.length === 1 ? toList[0] : toList,
				...(ccList && ccList.length > 0
					? { cc: ccList.length === 1 ? ccList[0] : ccList }
					: {}),
				...(bccList && bccList.length > 0
					? { bcc: bccList.length === 1 ? bccList[0] : bccList }
					: {}),
				subject,
				html: body,
			};

			let result: { id: string; status: string };
			if (mode === "reply" && original) {
				result = await api.replyEmail(original.id, payload);
			} else if (mode === "forward" && original) {
				result = await api.forwardEmail(original.id, payload);
			} else {
				result = await api.sendEmail(payload);
			}

			onSent?.(result.id);
			// v1.4 Phase 26 GENZ-02: 5-emails-responded confetti (per-session).
			// Increment the localStorage counter (key: parrot_emails_responded_count)
			// and fire confetti exactly when it hits 5. The fireConfetti
			// once-per-session gate ensures this fires only once per browser session.
			const emailCount = incrementEmailRespondedCount();
			if (emailCount === 5) {
				void fireConfetti("5_emails_responded");
			}
			onClose();
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				setError((err as Error).message ?? "Failed to send email.");
			}
		} finally {
			setIsSending(false);
		}
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="compose-pane-title"
			className="fixed inset-0 z-40 flex items-end justify-end p-4 sm:p-6 bg-slate-900/30"
			onClick={(e) => {
				// Close when clicking the dim overlay (but not when interacting
				// with the pane itself).
				if (e.target === e.currentTarget && !isSending) onClose();
			}}
		>
			<div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
					<h2
						id="compose-pane-title"
						className="text-sm font-semibold text-slate-900"
					>
						{formTitle}
					</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={isSending}
						aria-label="Close compose"
						className="text-slate-500 hover:text-slate-900 disabled:opacity-40"
					>
						<X size={18} />
					</button>
				</div>

				{/* Form */}
				<form
					onSubmit={handleSend}
					className="flex flex-col flex-1 min-h-0 overflow-y-auto"
				>
					<div className="p-5 space-y-3">
						{error && (
							<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
								{error}
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="w-14 shrink-0 text-xs font-medium text-slate-600">
								To
							</label>
							<input
								type="text"
								value={to}
								onChange={(e) => setTo(e.target.value)}
								placeholder="recipient@example.com"
								required
								className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
							/>
							{!showCcBcc && (
								<button
									type="button"
									onClick={() => setShowCcBcc(true)}
									className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-900"
								>
									Cc/Bcc
								</button>
							)}
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="w-14 shrink-0 text-xs font-medium text-slate-600">
									Cc
								</label>
								<input
									type="text"
									value={cc}
									onChange={(e) => setCc(e.target.value)}
									placeholder="Comma-separated"
									className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
								/>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="w-14 shrink-0 text-xs font-medium text-slate-600">
									Bcc
								</label>
								<input
									type="text"
									value={bcc}
									onChange={(e) => setBcc(e.target.value)}
									placeholder="Comma-separated"
									className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
								/>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="w-14 shrink-0 text-xs font-medium text-slate-600">
								Subject
							</label>
							<input
								type="text"
								value={subject}
								onChange={(e) => setSubject(e.target.value)}
								placeholder="Email subject"
								required
								className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
							/>
						</div>

						<RichTextEditor value={body} onChange={setBody} />
					</div>

					{/* Footer */}
					<div className="mt-auto flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
						<button
							type="button"
							onClick={onClose}
							disabled={isSending}
							className="text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40"
						>
							Discard
						</button>
						<button
							type="submit"
							disabled={isSending}
							className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Send size={13} />
							{isSending ? "Sending…" : "Send"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
