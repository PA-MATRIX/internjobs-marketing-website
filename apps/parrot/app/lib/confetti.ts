// v1.2 Phase 17: Celebratory micro-animations for the Parrot workspace.
//
// Audience: high-school + college interns. Target tone is lively but not
// saccharine — confetti fires on real milestones (onboarding done, first
// meeting started, urgent todo resolved) NOT on every interaction. Each
// trigger is rate-limited per session via localStorage so a chatty user
// doesn't drown in confetti.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — UI ships as part of the SSR'd
//     Workers bundle; canvas-confetti is browser-only so dynamic-import
//     keeps it out of the SSR tree.

import type { Options } from "canvas-confetti";

// Trigger keys — one per logical celebratory event. Used as localStorage
// keys so each event only fires once per browser per session reset.
export type ConfettiEvent =
	| "onboarding_complete"
	| "first_meeting_started"
	| "first_email_reviewed"
	| "first_todo_resolved"
	| "push_enabled"
	| "birthday";

const STORAGE_KEY_PREFIX = "parrot_confetti_fired:";

// Read once per page-load. Resetting requires the user to clear storage
// (or use "Reset confetti" in dev mode — out of scope for v1.2).
function alreadyFired(event: ConfettiEvent): boolean {
	if (typeof window === "undefined") return true;
	try {
		return Boolean(window.localStorage.getItem(STORAGE_KEY_PREFIX + event));
	} catch {
		// Safari private mode / localStorage disabled — fall back to fire-always
		// (better UX than silent failure).
		return false;
	}
}

function markFired(event: ConfettiEvent): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			STORAGE_KEY_PREFIX + event,
			new Date().toISOString(),
		);
	} catch {
		/* private mode — ignore */
	}
}

// Tasteful three-burst pattern. Centered, mid-screen, ~600ms total. Doesn't
// block the UI, doesn't auto-replay, dismisses cleanly. Mirrors the iMessage
// "Happy Birthday" balloon feel without being intrusive.
const CELEBRATION_OPTS: Partial<Options> = {
	particleCount: 80,
	spread: 70,
	startVelocity: 35,
	gravity: 1.1,
	ticks: 200,
	scalar: 0.95,
	origin: { y: 0.45 },
};

// Birthday gets the louder treatment — 3x the particles, gold + pink.
const BIRTHDAY_OPTS: Partial<Options> = {
	particleCount: 220,
	spread: 110,
	startVelocity: 45,
	gravity: 1.0,
	ticks: 280,
	scalar: 1.05,
	origin: { y: 0.5 },
	colors: ["#fbbf24", "#f472b6", "#fde68a", "#fb7185", "#a78bfa"],
};

export async function fireConfetti(event: ConfettiEvent): Promise<void> {
	if (alreadyFired(event)) return;
	if (typeof window === "undefined") return; // SSR no-op
	try {
		const mod = await import("canvas-confetti");
		const confetti = (mod.default ?? mod) as typeof import("canvas-confetti").default;
		const opts = event === "birthday" ? BIRTHDAY_OPTS : CELEBRATION_OPTS;
		// Three quick bursts for the celebration pattern. For birthday, one big
		// burst is enough.
		if (event === "birthday") {
			confetti(opts);
		} else {
			confetti(opts);
			setTimeout(() => confetti(opts), 180);
			setTimeout(() => confetti(opts), 360);
		}
		markFired(event);
	} catch {
		// canvas-confetti import failure — silent, this is polish not load-bearing
	}
}

/** Resets all confetti flags so the user can re-see celebrations. Dev/debug only. */
export function resetConfettiFlags(): void {
	if (typeof window === "undefined") return;
	const keys: string[] = [];
	for (let i = 0; i < window.localStorage.length; i += 1) {
		const k = window.localStorage.key(i);
		if (k?.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
	}
	keys.forEach((k) => window.localStorage.removeItem(k));
}
