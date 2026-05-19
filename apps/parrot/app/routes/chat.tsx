// v1.2 Phase 10 Wave 2: /chat route — embedded Mattermost.

import { Hash, MessageCircle } from "lucide-react";
import type { Route } from "./+types/chat";
import { ChatPane } from "~/components/ChatPane";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";

const DEFAULT_MATTERMOST_URL = "https://internjobs-mattermost.fly.dev";

export async function loader({ context }: Route.LoaderArgs) {
	const env = context.cloudflare?.env as
		| { MATTERMOST_URL?: string }
		| undefined;
	return {
		mattermostUrl: env?.MATTERMOST_URL ?? DEFAULT_MATTERMOST_URL,
	};
}

function ChatSecondaryNav() {
	return (
		<nav className="py-3">
			<p className="px-5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Channels
			</p>
			<SecondaryNavItem
				href="/chat"
				active
				label="general"
				icon={<Hash size={15} />}
			/>
			<SecondaryNavItem
				href="/chat"
				label="engineering"
				icon={<Hash size={15} />}
			/>
			<SecondaryNavItem
				href="/chat"
				label="ops"
				icon={<Hash size={15} />}
			/>
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Direct messages
			</p>
			<p className="px-5 py-2 text-xs text-slate-500 leading-relaxed">
				Mattermost is mounted to the right — its own channel list lives
				inside the iframe. The list here mirrors it for quick switching
				once we wire Mattermost's REST API in Wave 4.
			</p>
			<div className="px-5 py-2 flex items-center gap-2 text-slate-400 text-xs">
				<MessageCircle size={13} />
				Live DM list coming in Wave 4
			</div>
		</nav>
	);
}

export default function ChatRoute({ loaderData }: Route.ComponentProps) {
	return (
		<WorkspaceShell title="Chat" secondaryNav={<ChatSecondaryNav />}>
			<ChatPane mattermostUrl={loaderData.mattermostUrl} />
		</WorkspaceShell>
	);
}
