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
	// Clerk's <SignIn> uses sub-paths like /sign-in/factor-one. A
	// splat ($) catches all of them and routes the whole tree to the
	// embedded SignIn component.
	route("sign-in/*", "routes/login.tsx"),
	// Wave 2b: operator-only employee invite UI. The API enforces the
	// operator role; the page itself just renders the form (and the
	// fetch call will 403 for non-operators).
	route("admin/invite", "routes/admin.invite.tsx"),
] satisfies RouteConfig;
