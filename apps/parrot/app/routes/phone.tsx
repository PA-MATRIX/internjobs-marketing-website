// v1.2 Phase 12 Wave 1: Phone channel placeholder — SEAM, not integration.
//
// This route exists so the icon rail can ship the Phone seam now, without
// committing to a telephony stack. The actual voice/SIP backend lands in
// v1.3+ once the rest of the workspace is stable.
//
// FUTURE IMPLEMENTATION (do NOT install these packages in Phase 12):
//
//   import { Agent } from "agents";
//   import { withVoice } from "@cloudflare/voice";
//   import { TelnyxSTT, TelnyxTTS } from "@cloudflare/voice-telnyx";
//   // ^ NOTE: @cloudflare/voice-telnyx does NOT yet exist (2026-05-19).
//   // Cloudflare's official telephony package is @cloudflare/voice-twilio.
//   // Evaluate Telnyx once an official @cloudflare/voice-telnyx ships.
//   // Alternative: use @cloudflare/voice-twilio for SIP + Telnyx SIP trunk.
//
//   class PhoneAgent extends withVoice(Agent) {
//     async onTurn(transcript: string, context: VoiceContext) {
//       const result = await streamText({
//         model: createWorkersAI({ binding: env.AI }),
//         system: "You are Parrot, the InternJobs internal workspace assistant.",
//         prompt: transcript,
//       });
//       return result;
//     }
//   }
//
// Packages to install when this ships (v1.3+):
//   pnpm add @cloudflare/voice agents
//   pnpm add @cloudflare/voice-twilio   # OR a Telnyx adapter when available
//   pnpm add ai @cloudflare/workers-ai-provider
//
// See: https://developers.cloudflare.com/agents/api-reference/voice/
//      https://developers.cloudflare.com/agents/guides/build-a-voice-agent/

import { Phone } from "lucide-react";
import { WorkspaceShell } from "../components/WorkspaceShell";

export default function PhoneRoute() {
	return (
		<WorkspaceShell title="Phone">
			<div className="flex flex-col items-center justify-center h-full min-h-[480px] gap-5 p-8 text-center">
				<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
					<Phone size={32} className="text-slate-500" strokeWidth={1.5} />
				</div>
				<div>
					<h2 className="text-lg font-semibold text-slate-900">Phone</h2>
					<p className="mt-1 text-sm text-slate-500 max-w-xs">
						Coming soon — Telnyx via Cloudflare Agents SDK
					</p>
				</div>
			</div>
		</WorkspaceShell>
	);
}
