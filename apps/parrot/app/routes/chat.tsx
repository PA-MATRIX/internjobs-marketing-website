// v1.3.1: /chat route — embedded chat backend with Clerk-driven auto-SSO.
//
// The iframe URL is `/oauth/gitlab/login` (not the chat root) so the
// embedded chat backend triggers OIDC immediately on load:
//
//   1. iframe → chat.internjobs.ai/oauth/gitlab/login
//   2. backend redirects → workspace.internjobs.ai/oidc/authorize (Parrot's OIDC bridge)
//   3. /oidc/authorize sees the existing Clerk session cookie
//   4. issues OIDC authorization code, redirects back to chat backend
//   5. chat backend exchanges code for token, creates session, lands at /
//
// User never sees a login form, never clicks a button. Clerk session
// at workspace.internjobs.ai single-sign-ons across every sub-capability
// (email, chat, meetings, phone) — chat just needs this auto-trigger URL
// because its hosted UI defaults to its own login page when hit at root.

import type { Route } from "./+types/chat";
import { ChatPane } from "~/components/ChatPane";
import { WorkspaceShell } from "~/components/WorkspaceShell";

const DEFAULT_CHAT_URL = "https://chat.internjobs.ai";

export async function loader({ context }: Route.LoaderArgs) {
	const env = context.cloudflare?.env as
		| { MATTERMOST_URL?: string }
		| undefined;
	const baseUrl = (env?.MATTERMOST_URL ?? DEFAULT_CHAT_URL).replace(/\/$/, "");
	// Auto-trigger OIDC by landing on /oauth/gitlab/login. The chat
	// backend uses its GitLab OAuth slot for our generic OIDC issuer
	// (Parrot Worker's /oidc/* endpoints) — Team Edition doesn't
	// expose a generic OIDC slot in v11.x, so we use the GitLab one.
	// User never sees the label.
	const chatUrl = `${baseUrl}/oauth/gitlab/login`;
	return { chatUrl };
}

export default function ChatRoute({ loaderData }: Route.ComponentProps) {
	return (
		<WorkspaceShell title="Chat">
			<ChatPane mattermostUrl={loaderData.chatUrl} />
		</WorkspaceShell>
	);
}
