// v1.3.1: /chat route — full Mattermost surface inside Parrot.

import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { WorkspaceAppFrame } from "~/components/WorkspaceAppFrame";
import { WorkspaceShell } from "~/components/WorkspaceShell";

export async function loader({ context }: LoaderFunctionArgs) {
	const env =
		(context as { cloudflare?: { env?: Record<string, string> } }).cloudflare
			?.env || {};
	const baseUrl = (env.MATTERMOST_URL || "https://chat.internjobs.ai").replace(
		/\/$/,
		"",
	);
	return { chatUrl: `${baseUrl}/oauth/gitlab/login` };
}

export default function ChatRoute() {
	const { chatUrl } = useLoaderData<typeof loader>();
	return (
		<WorkspaceShell title="Chat">
			<WorkspaceAppFrame src={chatUrl} title="Mattermost Chat" />
		</WorkspaceShell>
	);
}
