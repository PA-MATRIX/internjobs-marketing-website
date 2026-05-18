// v1.2 Phase 10 Wave 1: ChatPane — Mattermost iframe placeholder.
//
// Wave 2 deploys Mattermost Team Edition on Fly (internjobs-mattermost.fly.dev)
// and replaces this placeholder with a real iframe + SSO bridge. We pin the
// URL to the expected production host so the wiring lands cleanly when Wave 2
// flips the switch.

import { ChatToEmail } from "./crosspane/ChatToEmail";
import { StartMeeting } from "./crosspane/StartMeeting";

const MATTERMOST_URL = "https://internjobs-mattermost.fly.dev";

export function ChatPane() {
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
				<p className="text-sm text-slate-600">
					Chat is backed by Mattermost Team Edition (Wave 2). The iframe
					below is a placeholder until <code>{MATTERMOST_URL}</code> is
					deployed.
				</p>
				<div className="flex gap-2">
					<ChatToEmail />
					<StartMeeting />
				</div>
			</div>
			<div className="flex-1 min-h-0 bg-slate-100 relative">
				<iframe
					src={MATTERMOST_URL}
					title="Mattermost"
					className="absolute inset-0 h-full w-full border-0 opacity-30"
					sandbox="allow-scripts allow-same-origin allow-forms"
				/>
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<div className="rounded-lg bg-white/90 border border-slate-200 shadow-sm px-6 py-4 text-center max-w-md">
						<p className="text-sm font-medium text-slate-700 mb-1">
							Mattermost not deployed yet
						</p>
						<p className="text-xs text-slate-500">
							Wave 2 of Phase 10 deploys the Mattermost Team Edition
							instance and wires the Clerk-SSO header bridge.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
