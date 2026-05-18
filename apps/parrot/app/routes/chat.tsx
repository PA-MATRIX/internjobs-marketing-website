// v1.2 Phase 10 Wave 2: /chat route — renders the embedded Mattermost
// iframe. The Mattermost URL is sourced from the worker `MATTERMOST_URL`
// env var (wrangler `vars.MATTERMOST_URL` in prod, `.dev.vars` locally)
// so we can flip between the Fly hostname and a future
// `mattermost.internjobs.ai` custom domain without a code change.

import type { Route } from "./+types/chat";
import { WorkspaceShell } from "~/components/WorkspaceShell";
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

export default function ChatRoute({ loaderData }: Route.ComponentProps) {
	return (
		<WorkspaceShell title="Chat">
			<ChatPane mattermostUrl={loaderData.mattermostUrl} />
		</WorkspaceShell>
	);
}
