// Phase 32 (32-02): pure helpers for the Parrot embed postMessage bridge.
// Framework-free by design — unit-tested from workers/tests/lib/ even
// though this file lives under app/lib/, because vitest.config.ts only
// runs a node environment (no jsdom) and these functions need none.
//
// Contract source: .planning/workstreams/team-workspace/WORKSPACE-HANDOFF.md §4.

export const PARROT_EMBED_ORIGIN = "https://parrot.projecta.ai";

/** Push a fresh token to the iframe before the ~120s mint expires, without
 *  reloading src (a src reload would drop the Telnyx SIP registration). */
export const PARROT_TOKEN_REFRESH_MS = 90_000;

/** If parrot:ready hasn't fired within this window, show a retry affordance. */
export const PARROT_READY_TIMEOUT_MS = 12_000;

export const PARROT_DIAL_REQUEST_EVENT = "parrot-dial-request";
export const PARROT_BADGE_CHANGE_EVENT = "parrot-badge-change";
export const PARROT_INCOMING_CALL_EVENT = "parrot-incoming-call";
export const PARROT_CALL_ENDED_EVENT = "parrot-call-ended";

export function isTrustedParrotOrigin(
	origin: string,
	expected: string = PARROT_EMBED_ORIGIN,
): boolean {
	return origin === expected;
}

function asRecord(data: unknown): Record<string, unknown> | null {
	return data && typeof data === "object"
		? (data as Record<string, unknown>)
		: null;
}

export function isParrotReadyMessage(data: unknown): boolean {
	return asRecord(data)?.type === "parrot:ready";
}

export function isParrotCallEndedMessage(data: unknown): boolean {
	return asRecord(data)?.type === "parrot:call-ended";
}

export interface ParrotBadgePayload {
	calls: number;
	messages: number;
}
export function parseParrotBadge(data: unknown): ParrotBadgePayload | null {
	const d = asRecord(data);
	if (!d || d.type !== "parrot:badge") return null;
	const calls =
		typeof d.calls === "number" && Number.isFinite(d.calls)
			? Math.max(0, d.calls)
			: 0;
	const messages =
		typeof d.messages === "number" && Number.isFinite(d.messages)
			? Math.max(0, d.messages)
			: 0;
	return { calls, messages };
}

export interface ParrotIncomingCallPayload {
	from: string;
	name?: string;
}
export function parseParrotIncomingCall(
	data: unknown,
): ParrotIncomingCallPayload | null {
	const d = asRecord(data);
	if (!d || d.type !== "parrot:incoming-call") return null;
	if (typeof d.from !== "string" || !d.from.trim()) return null;
	return { from: d.from, name: typeof d.name === "string" ? d.name : undefined };
}

export function buildParrotDialMessage(number: string) {
	return { type: "parrot:dial" as const, number };
}
export function buildParrotTokenMessage(token: string) {
	return { type: "parrot:token" as const, token };
}
export function buildParrotOpenContactMessage(id: string) {
	return { type: "parrot:open-contact" as const, id };
}

/** Appends ?token=<JWT> to the configured embed URL, preserving any
 *  existing query params on that URL. */
export function buildEmbedSrc(embedUrl: string, token: string): string {
	const url = new URL(embedUrl);
	url.searchParams.set("token", token);
	return url.toString();
}

/**
 * Requests that the Parrot embed pre-fill the dialer with `number` and
 * navigate the employee to /parrot. Dispatched as a window CustomEvent —
 * ParrotEmbedPane (mounted at the app root, always alive) listens for
 * PARROT_DIAL_REQUEST_EVENT and forwards it as a `parrot:dial` postMessage
 * to the iframe. Per the locked contract (WORKSPACE-HANDOFF.md §2.3) this
 * is PRE-FILL ONLY — the employee must click "Call" once inside the pane;
 * there is no reliable cross-frame auto-dial (a parent-frame click carries
 * no user-activation into the iframe).
 *
 * SCOPE (see 32-03-PLAN.md): NO caller exists yet in this codebase. Workspace
 * has no UI surface that displays another person's raw phone number to wire a
 * "Dial" button onto (Chat is keyed on Mattermost users by email with no phone
 * field; the Admin directory shows capability flags, not numbers). This is
 * therefore deliberately generic, SSR-safe infrastructure — the tested,
 * ready-to-call other half of the Workspace→Parrot contract — not a
 * placeholder button that dials nothing real.
 *
 * `target` is an injectable seam (defaults to `window`): it keeps the real
 * CustomEvent dispatch path unit-testable under this repo's node-only Vitest
 * env, where there is no DOM `window`.
 */
export function requestParrotDial(
	number: string,
	target: Pick<EventTarget, "dispatchEvent"> | undefined = typeof window !==
	"undefined"
		? window
		: undefined,
): void {
	if (!target) return;
	target.dispatchEvent(
		new CustomEvent(PARROT_DIAL_REQUEST_EVENT, { detail: { number } }),
	);
}
