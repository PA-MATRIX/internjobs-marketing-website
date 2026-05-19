// v1.2 Phase 10 Wave 2: ChatPane — embeds the self-hosted Mattermost
// Team Edition instance (apps/parrot-mattermost) as an iframe.
//
// The Mattermost URL is plumbed from the worker `MATTERMOST_URL` env
// var via the /chat route loader, so we can swap fly.dev → custom
// domain without a code change.
//
// Auth model (2026-05-19): Parrot uses phone-OTP-only Clerk
// (clerk.workspace.internjobs.ai); Mattermost has its own session.
// An employee signs in to Parrot via Clerk, then signs in to the
// embedded Mattermost iframe separately using the email/password
// their admin generated (or via the OIDC bridge in workers/routes/oidc.ts
// once enabled — currently shipped but not active per the
// session-handoff 2026-05-19 decision to run on two dedicated Clerk
// apps instead of one shared OIDC issuer).
//
// Cross-origin iframes are opaque, so we can't detect whether the
// inner Mattermost session is live. The overlay below is a one-time
// hint the user dismisses once they've signed into the iframe. Single
// sign-on (the OIDC bridge → automatic Mattermost session) is a v1.3
// polish item.

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
					Chat is backed by self-hosted Mattermost. Click the{" "}
					<span className="font-medium">"GitLab"</span> button in the panel below to
					single-sign-on with your Parrot session — no separate password needed.
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
									Click the <span className="font-medium">"GitLab"</span>{" "}
									button below — it bridges to your Parrot session via OIDC
									so you sign in once and Mattermost picks up the same identity.
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
