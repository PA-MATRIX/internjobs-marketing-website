// v1.3.1 Agent Lift: Parrot Agent panel.
//
// Stub committed in Commit B to keep the build green while EmailPanel
// references it. The full implementation lands in Commit C — see the
// design notes there.

import { X } from "lucide-react";

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
	onDraftSavedToCompose?: (bodyHtml: string) => void;
}

export function AgentPanel({ onClose }: AgentPanelProps) {
	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
				<span className="text-xs font-semibold text-slate-700">
					Parrot Agent
				</span>
				<button
					type="button"
					onClick={onClose}
					className="text-slate-400 hover:text-slate-700"
					aria-label="Close agent"
				>
					<X size={14} />
				</button>
			</div>
			<div className="flex-1 p-3 text-xs text-slate-500">
				Agent panel coming online…
			</div>
		</div>
	);
}
