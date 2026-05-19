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
	route("dashboard", "routes/dashboard.tsx"),
	route("inbox", "routes/inbox.tsx"),
	route("chat", "routes/chat.tsx"),
	route("meetings", "routes/meetings.tsx"),
	// v1.2 Phase 12 Wave 1: Phone + SMS placeholder routes — seam, not
	// integration. The route files render a "Coming soon — Telnyx via
	// Cloudflare Agents SDK" card and document the future
	// @cloudflare/voice + withVoice(Agent) architecture inline. Without
	// these registrations React Router would 404 the icon-rail clicks.
	route("phone", "routes/phone.tsx"),
	route("sms", "routes/sms.tsx"),
	// Clerk's <SignIn> uses sub-paths like /sign-in/factor-one. A
	// splat ($) catches all of them and routes the whole tree to the
	// embedded SignIn component.
	route("sign-in/*", "routes/login.tsx"),
	// Wave 2b: operator-only employee invite UI. The API enforces the
	// operator role; the page itself just renders the form (and the
	// fetch call will 403 for non-operators).
	route("admin/invite", "routes/admin.invite.tsx"),
] satisfies RouteConfig;
