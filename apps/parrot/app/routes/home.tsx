// v1.2 Phase 10 Wave 2b: Parrot home — Dashboard is the workspace's
// landing pane (the cross-channel todos surface). Inbox / Chat /
// Meetings are accessed via the left-rail nav.

import { redirect, type LoaderFunctionArgs, type MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
	{ title: "InternJobs.AI Parrot Workspace" },
];

export async function loader(_args: LoaderFunctionArgs) {
	// Send the user straight to the Dashboard. The agent-driven todo
	// view is the whole point of the workspace, so the index just
	// 302s into it rather than rendering its own surface.
	throw redirect("/dashboard");
}

export default function HomeRoute() {
	return null;
}
