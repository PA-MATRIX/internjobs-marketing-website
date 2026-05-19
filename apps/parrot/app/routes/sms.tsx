// v1.2 Phase 12 Wave 1: SMS channel placeholder — SEAM, not integration.
//
// This route exists so the icon rail can ship the SMS seam now, without
// committing to a telephony stack. The actual SMS backend lands in v1.3+
// once the rest of the workspace is stable.
//
// FUTURE IMPLEMENTATION (do NOT install these packages in Phase 12):
//
//   import { Agent } from "agents";
//   import { withVoice } from "@cloudflare/voice";
//   // For SMS: Telnyx REST API via fetch() OR Twilio SMS via
//   // @cloudflare/voice-twilio SMS bindings (if available at v1.3 time).
//   //
//   // Pattern for inbound SMS handler on the Agent:
//   //   async onTurn(transcript: string, context: TurnContext) {
//   //     // transcript = inbound SMS body
//   //     // context.send() = outbound SMS reply
//   //     const result = await streamText({ model: kimiK2, prompt: transcript });
//   //     await context.send(result.text);
//   //   }
//
//   // Model: Workers AI kimi-k2.6 via AI Gateway (existing pattern in
//   // workers/lib/ai.ts). Same per-employee quota guarantees apply.
//
// See: https://developers.cloudflare.com/agents/api-reference/voice/
//      apps/parrot/workers/lib/ai.ts (callAiGateway — Parrot's AI Gateway pattern)

import { MessageCircle } from "lucide-react";
import { WorkspaceShell } from "../components/WorkspaceShell";

export default function SmsRoute() {
	return (
		<WorkspaceShell title="SMS">
			<div className="flex flex-col items-center justify-center h-full min-h-[480px] gap-5 p-8 text-center">
				<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
					<MessageCircle
						size={32}
						className="text-slate-500"
						strokeWidth={1.5}
					/>
				</div>
				<div>
					<h2 className="text-lg font-semibold text-slate-900">SMS</h2>
					<p className="mt-1 text-sm text-slate-500 max-w-xs">
						Coming soon — Telnyx via Cloudflare Agents SDK
					</p>
				</div>
			</div>
		</WorkspaceShell>
	);
}
