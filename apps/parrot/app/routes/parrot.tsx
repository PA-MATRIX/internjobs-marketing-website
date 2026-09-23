// Phase 32: Parrot pane — the single dialer + SMS embed slot.
//
// Parrot is a separate dialer/phone+SMS product embedded via <iframe>. The
// dialer AND messaging both live inside Parrot, so Workspace surfaces ONE
// "Parrot" pane (not separate Phone/SMS panes). This route renders a
// [data-parrot-embed-slot] marker that fills the pane area; the persistent,
// root-mounted <ParrotEmbedPane/> (app/components/ParrotEmbedPane.tsx)
// positions its iframe over this marker. The iframe itself lives in root.tsx
// so it survives navigation (keeping the SIP registration alive) — see that
// component and the embed contract in
// .planning/workstreams/team-workspace/WORKSPACE-HANDOFF.md.

import { WorkspaceShell } from "../components/WorkspaceShell";

export default function ParrotRoute() {
	return (
		<WorkspaceShell title="Parrot">
			<div data-parrot-embed-slot className="h-full w-full" />
		</WorkspaceShell>
	);
}
