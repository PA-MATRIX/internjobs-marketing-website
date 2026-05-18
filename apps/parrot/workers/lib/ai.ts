// v1.2 Phase 10 Wave 1: Parrot AI helpers — DEFERRED to Wave 5.
//
// Stub kept so the import surface exists once we wire Workers AI for
// draft-assist. No Workers AI binding is configured in Wave 1's
// wrangler.jsonc; calls into here will throw.

export class DraftAssistNotImplementedError extends Error {
	constructor() {
		super(
			"Parrot draft-assist is not implemented yet — scheduled for Wave 5 of Phase 10.",
		);
		this.name = "DraftAssistNotImplementedError";
	}
}

export async function suggestReply(_input: {
	subject: string;
	body: string;
}): Promise<string> {
	throw new DraftAssistNotImplementedError();
}
