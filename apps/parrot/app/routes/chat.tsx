// v1.2 Phase 10 Wave 2: /chat route — renders the embedded Mattermost
// iframe. The Mattermost URL is sourced from the worker `MATTERMOST_URL`
// env var (wrangler `vars.MATTERMOST_URL` in prod, `.dev.vars` locally)
// so we can flip between the Fly hostname and a future
// `mattermost.internjobs.ai` custom domain without a code change.

import type { Route } from "./+types/chat";
import { SecondaryNavItem, WorkspaceShell } from "~/components/WorkspaceShell";
import { ChatPane } from "~/components/ChatPane";

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
			<SecondaryNavItem href="/chat" active label="general" icon="#" />
			<SecondaryNavItem href="/chat" label="engineering" icon="#" />
			<SecondaryNavItem href="/chat" label="ops" icon="#" />
			<p className="px-5 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
				Direct messages
			</p>
			<p className="px-5 py-2 text-xs text-slate-500">
				Mattermost is mounted to the right — its own channel list lives
				inside the iframe. The list here mirrors it for quick switching
				once we wire Mattermost's REST API in Wave 4.
			</p>
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
