// v1.2 Phase 10 Wave 1: Parrot React Router config.
//
// Three-pane structure (Inbox / Chat / Meetings) chosen for the
// employee workspace per PLAN.md Decision D. Each pane is its own
// child route under "/" so the WorkspaceShell can stay mounted as
// the user switches panes (avoids tearing down the Mattermost iframe
// every navigation, once Wave 2 wires it up).

import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("inbox", "routes/inbox.tsx"),
	route("chat", "routes/chat.tsx"),
	route("meetings", "routes/meetings.tsx"),
	route("sign-in", "routes/login.tsx"),
] satisfies RouteConfig;
