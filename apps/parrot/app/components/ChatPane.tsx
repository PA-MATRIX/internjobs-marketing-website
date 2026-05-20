// v1.3.1: ChatPane — embeds Parrot Chat (the team chat backend) as an
// iframe inside the Parrot Workspace.
//
// White-label posture: the chat backend is self-hosted infrastructure we
// own — its brand is irrelevant to the employee. The UI presents this as
// "Chat" with no mention of the underlying server, and surfaces only the
// cross-pane affordances (ChatToEmail, StartMeeting) that bridge into
// the rest of Parrot.
//
// The chat URL is plumbed via the worker `MATTERMOST_URL` env var, which
// in v1.3.1 points at chat.internjobs.ai — a CSP-rewriting proxy that
// allows the chat backend to be iframe-embedded from
// workspace.internjobs.ai. Both domains share the .internjobs.ai root so
// session cookies are same-site.

import { ChatToEmail } from "./crosspane/ChatToEmail";
import { StartMeeting } from "./crosspane/StartMeeting";

interface ChatPaneProps {
	/**
	 * Public URL of the chat backend. Sourced from the worker env
	 * (`MATTERMOST_URL`); in production this resolves to the
	 * chat.internjobs.ai proxy.
	 */
	mattermostUrl: string;
}

export function ChatPane({ mattermostUrl }: ChatPaneProps) {
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-end gap-2">
				<ChatToEmail />
				<StartMeeting />
			</div>
			<div className="flex-1 min-h-0 bg-slate-100 relative">
				<iframe
					src={mattermostUrl}
					title="Parrot Chat"
					className="absolute inset-0 h-full w-full border-0"
					// `allow-popups` for any OAuth handoff. `allow-storage-
					// access-by-user-activation` required by the chat backend
					// for its localStorage-backed session.
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
				/>
			</div>
		</div>
	);
}
