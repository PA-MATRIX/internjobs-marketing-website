// v1.2 Phase 10 Wave 1: Parrot reply / forward routes — STUB.
//
// Real send is deferred. Wave 1 ships:
//   - POST /api/inbox/send                 (writes to Sent folder; no SMTP)
//   - POST /api/inbox/messages/:id/reply   (this stub)
//   - POST /api/inbox/messages/:id/forward (this stub)
//
// We deliberately do NOT lift the full reply-forward.ts from agentic-inbox
// yet — that file pulls in `lib/attachments`, `lib/schemas`, `email-sender`
// and the full threading helpers, none of which the Parrot Wave 1 UI uses.
// We'll fork them when InboxPane needs reply/forward (Wave 4 or earlier).

import type { Context } from "hono";
import type { ParrotContext } from "../lib/mailbox";

type AppContext = Context<ParrotContext>;

export async function handleReplyEmail(c: AppContext) {
	return c.json(
		{
			ok: false,
			reason: "not_implemented_wave_1",
			detail:
				"Reply lifecycle (lib/attachments + schemas + email-sender) is scheduled to be lifted from agentic-inbox in a later Phase 10 wave.",
		},
		501,
	);
}

export async function handleForwardEmail(c: AppContext) {
	return c.json(
		{
			ok: false,
			reason: "not_implemented_wave_1",
			detail:
				"Forward lifecycle (lib/attachments + schemas + email-sender) is scheduled to be lifted from agentic-inbox in a later Phase 10 wave.",
		},
		501,
	);
}
