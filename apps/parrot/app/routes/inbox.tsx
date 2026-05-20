// v1.3.1: /inbox route — full Agentic Inbox surface inside Parrot.

import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { WorkspaceAppFrame } from "~/components/WorkspaceAppFrame";
import { WorkspaceShell } from "~/components/WorkspaceShell";

export async function loader({ context }: LoaderFunctionArgs) {
	const env =
		(context as { cloudflare?: { env?: Record<string, string> } }).cloudflare
			?.env || {};
	const baseUrl = (
		env.AGENTIC_INBOX_URL ||
		"https://internjobs-agentic-inbox.rentalaraj.workers.dev"
	).replace(/\/$/, "");
	return {
		inboxUrl: `${baseUrl}/mailbox/maya%40agent.internjobs.ai/emails/inbox`,
	};
}

export default function InboxRoute() {
	const { inboxUrl } = useLoaderData<typeof loader>();
	return (
		<WorkspaceShell title="Email">
			<WorkspaceAppFrame src={inboxUrl} title="Agentic Inbox Email" />
		</WorkspaceShell>
	);
}
