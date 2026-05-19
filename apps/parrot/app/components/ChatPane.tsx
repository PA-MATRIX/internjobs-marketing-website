// v1.2 Phase 10 Wave 2: ChatPane — embeds the self-hosted Mattermost
// Team Edition instance (apps/parrot-mattermost) as an iframe.
//
// The Mattermost URL is plumbed from the worker `MATTERMOST_URL` env
// var via the /chat route loader, so we can swap fly.dev → custom
// domain without a code change.
//
// Wave 2 SSO model: the employee signs in to Parrot via Clerk and
// SEPARATELY signs in to Mattermost via Mattermost's built-in Google
// OAuth flow (same `@internjobs.ai` Google account, two sessions).
// We can't tell from the parent frame whether the inner iframe holds
// a logged-in Mattermost session — cross-origin frames are opaque —
// so we surface a manual "Sign in to Chat" overlay the user can
// dismiss once they're authenticated inside the iframe. Wave 3 will
// replace this with a header-bridge SSO that injects a Mattermost
// session cookie from the Parrot worker.

import { useState } from "react";
import { ChatToEmail } from "./crosspane/ChatToEmail";
import { StartMeeting } from "./crosspane/StartMeeting";

interface ChatPaneProps {
	/**
	 * Public URL of the self-hosted Mattermost instance. Sourced from
	 * the worker env (`MATTERMOST_URL`); falls back at the loader layer
	 * to `https://internjobs-mattermost.fly.dev` so local dev still
	 * renders something sensible.
	 */
	mattermostUrl: string;
}

export function ChatPane({ mattermostUrl }: ChatPaneProps) {
	const [overlayDismissed, setOverlayDismissed] = useState(false);

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
				<p className="text-sm text-slate-600">
					Chat is backed by Mattermost Team Edition. Sign in with your{" "}
					<span className="font-medium">@internjobs.ai</span> Google
					account if prompted.
				</p>
				<div className="flex gap-2">
					<ChatToEmail />
					<StartMeeting />
				</div>
			</div>
			<div className="flex-1 min-h-0 bg-slate-100 relative">
				<iframe
					src={mattermostUrl}
					title="Mattermost"
					className="absolute inset-0 h-full w-full border-0"
					// `allow-popups` lets Mattermost's Google OAuth flow open
					// the consent screen in a new tab. `allow-storage-access-
					// by-user-activation` is required by Mattermost for its
					// localStorage-backed session.
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
				/>
				{!overlayDismissed && (
					<div className="absolute inset-x-0 top-0 flex justify-center pt-4 pointer-events-none">
						<div className="pointer-events-auto rounded-lg bg-white/95 border border-slate-200 shadow-sm px-4 py-3 max-w-md flex items-start gap-3">
							<div className="flex-1">
								<p className="text-sm font-medium text-slate-700">
									Sign in to Chat
								</p>
								<p className="text-xs text-slate-500 mt-0.5">
									Use the Mattermost panel below to sign in with
									your @internjobs.ai Google account. Wave 3
									will make this automatic.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setOverlayDismissed(true)}
								className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 bg-white"
							>
								Dismiss
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
