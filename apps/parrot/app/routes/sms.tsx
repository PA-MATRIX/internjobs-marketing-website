// Phase 32 (32-02): SMS pane — the Parrot embed slot.
//
// This route no longer renders a "Coming soon" placeholder or the old
// speculative @cloudflare/voice architecture. Instead it renders a
// [data-parrot-embed-slot] marker that fills the pane area; the persistent,
// root-mounted <ParrotEmbedPane/> (app/components/ParrotEmbedPane.tsx)
// positions its iframe over this marker. The iframe itself lives in root.tsx
// so it survives navigation — see that component and the embed contract in
// .planning/workstreams/team-workspace/WORKSPACE-HANDOFF.md.

import { WorkspaceShell } from "../components/WorkspaceShell";

export default function SmsRoute() {
	return (
		<WorkspaceShell title="SMS">
			<div data-parrot-embed-slot className="h-full w-full" />
		</WorkspaceShell>
	);
}
