// v1.3.1 Agent Lift: Parrot tools discoverability panel.
//
// Lifted in spirit from apps/agentic-inbox/app/components/MCPPanel.tsx.
// The agentic-inbox version surfaces a true MCP server endpoint (/mcp)
// for external coding assistants (Claude Code, Cursor, etc.) to connect.
// Parrot does NOT ship a full MCP transport in v1.3.1 — the @modelcontextprotocol
// /sdk dep alone weighs ~150KB and the multi-employee security review for
// exposing tools externally hasn't happened.
//
// Instead, this panel:
//   - Reads the canonical tool catalog from GET /api/inbox/agent/tools
//     (workers/lib/agent-tools.ts::PARROT_AGENT_TOOLS).
//   - Surfaces the in-app HTTP equivalent (/api/inbox/agent/{tool}).
//   - Documents what each tool does so the operator / future MCP work
//     can use this as the source of truth.
//
// White-label: header reads "Parrot Agent Tools". No MCP-as-protocol
// mention except a deferred-features note.

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Wrench } from "lucide-react";
import { useState } from "react";
import { api } from "~/lib/api";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API unavailable — ignore silently
		}
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
			aria-label={copied ? "Copied" : "Copy"}
		>
			{copied ? (
				<>
					<Check size={11} className="text-emerald-600" />
					<span className="text-emerald-700">Copied</span>
				</>
			) : (
				<>
					<Copy size={11} />
					<span>Copy</span>
				</>
			)}
		</button>
	);
}

export function MCPPanel() {
	const baseUrl =
		typeof window !== "undefined"
			? window.location.origin
			: "https://workspace.internjobs.ai";
	const agentBase = `${baseUrl}/api/inbox/agent`;

	const { data, isLoading, error } = useQuery({
		queryKey: ["parrot", "agent", "tools"],
		queryFn: () => api.agentTools(),
	});

	return (
		<div className="flex h-full flex-col">
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
				{/* Intro */}
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100">
							<Wrench size={16} className="text-indigo-700" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-slate-800">
								Parrot Agent Tools
							</h3>
							<p className="text-[11px] text-slate-500">
								In-app HTTP endpoints
							</p>
						</div>
					</div>
					<p className="text-xs text-slate-500 leading-relaxed">
						These are the capabilities exposed to Parrot Agent
						when it operates on your inbox. They run as
						authenticated HTTP endpoints scoped to your
						signed-in mailbox — no other employee's data is
						reachable.
					</p>
				</div>

				{/* Base URL */}
				<div className="space-y-1">
					<div className="flex items-center justify-between">
						<label className="text-xs font-medium text-slate-700">
							Base URL
						</label>
						<CopyButton text={agentBase} />
					</div>
					<div className="bg-slate-100 text-slate-700 font-mono text-[11px] px-3 py-2 rounded-md border border-slate-200 break-all">
						{agentBase}
					</div>
				</div>

				{/* Tools */}
				<div className="space-y-2">
					<h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 px-0.5">
						Available Tools
					</h4>
					{isLoading ? (
						<div className="text-xs text-slate-500">Loading…</div>
					) : error ? (
						<div className="text-xs text-red-600">
							Failed to load tool list: {(error as Error).message}
						</div>
					) : (
						<div className="border border-slate-200 rounded-md divide-y divide-slate-100">
							{(data?.tools ?? []).map((tool) => (
								<div
									key={tool.name}
									className="flex items-center gap-2 px-3 py-2"
								>
									<Wrench
										size={11}
										className="text-indigo-600 shrink-0"
									/>
									<div className="min-w-0 flex-1">
										<span className="text-xs font-mono font-medium text-slate-800">
											{tool.name}
										</span>
									</div>
									<span className="text-[11px] text-slate-500 shrink-0">
										{tool.description}
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Deferred: full MCP transport */}
				<div className="space-y-1 pt-2 border-t border-slate-100">
					<h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 px-0.5">
						Roadmap
					</h4>
					<p className="text-[11px] text-slate-500 leading-relaxed">
						A public MCP server endpoint (so external coding
						assistants can drive your inbox over the Model
						Context Protocol) is deferred until the multi-employee
						auth model is reviewed. The in-app agent uses these
						same tools via authenticated HTTP today.
					</p>
				</div>
			</div>
		</div>
	);
}
