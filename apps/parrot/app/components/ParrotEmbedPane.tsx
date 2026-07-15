// Phase 32 (32-02): the persistent Parrot SMS/phone embed pane.
//
// This is the ONE iframe that must NEVER unmount while an employee is
// signed in. Parrot registers a Telnyx SIP session inside the iframe on
// load; unmounting (or reloading `src`) drops that registration and kills
// inbound calls. So the component is mounted once in root.tsx's AppShell as
// a SIBLING of <Outlet/> (AppShell survives client-side navigation; only the
// Outlet's content remounts) and is only ever HIDDEN via display:none, never
// removed from the tree.
//
// Because it lives outside the routed tree, it can't use normal layout flow
// to occupy the pane area. Instead phone.tsx / sms.tsx render a lightweight
// `[data-parrot-embed-slot]` marker where the pane should visually sit, and
// this component positions its `position: fixed` wrapper over that marker via
// getBoundingClientRect(), re-syncing on route change / resize / slot resize.
//
// Contract source: .planning/workstreams/team-workspace/WORKSPACE-HANDOFF.md
// §2 (the three silent-failure requirements: `allow` attr, never-unmount,
// pre-fill-only dialing) and §4 (the postMessage bridge). Dial wiring itself
// lands in Plan 32-03 — this file only builds the (currently inert) listener.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Loader2, PhoneIncoming, RefreshCw } from "lucide-react";
import { api } from "~/lib/api";
import { useCurrentEmployee } from "~/lib/auth";
import {
	buildEmbedSrc,
	buildParrotDialMessage,
	buildParrotTokenMessage,
	isParrotCallEndedMessage,
	isParrotReadyMessage,
	isTrustedParrotOrigin,
	parseParrotBadge,
	parseParrotIncomingCall,
	type ParrotIncomingCallPayload,
	PARROT_BADGE_CHANGE_EVENT,
	PARROT_DIAL_REQUEST_EVENT,
	PARROT_EMBED_ORIGIN,
	PARROT_READY_TIMEOUT_MS,
	PARROT_TOKEN_REFRESH_MS,
} from "~/lib/parrot-embed";

// ── Incoming-call ringtone ─────────────────────────────────────────────
//
// A looping two-tone "ring" built on the SAME lazy-init Web Audio pattern as
// ChatPane's playChatChime (created on first use, after a user gesture, per
// browser autoplay policy; reused thereafter; everything try/caught so
// unsupported browsers silently no-op). We deliberately DON'T import from
// ChatPane (playChatChime isn't exported) and use a distinct, longer
// alternating two-tone loop so a ringing phone is audibly different from a
// chat ping. The loop repeats until parrot:call-ended stops it.
let _callAudioCtx: AudioContext | null = null;
let _ringtoneTimer: ReturnType<typeof setInterval> | null = null;

function playRingtoneBurst() {
	try {
		if (typeof window === "undefined") return;
		const Ctx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctx) return;
		if (!_callAudioCtx) _callAudioCtx = new Ctx();
		const ctx = _callAudioCtx;
		if (ctx.state === "suspended") void ctx.resume();
		const now = ctx.currentTime;
		// Alternating C5/E5 "brr-brr" — four notes over ~1.2s.
		const tones = [523.25, 659.25, 523.25, 659.25];
		tones.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			const t = now + i * 0.3;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.3);
		});
	} catch {
		/* audio unavailable — ignore */
	}
}

function playIncomingCallRingtone() {
	if (typeof window === "undefined") return;
	playRingtoneBurst();
	if (_ringtoneTimer) return; // already ringing
	_ringtoneTimer = setInterval(playRingtoneBurst, 1600);
}

function stopIncomingCallRingtone() {
	if (_ringtoneTimer) {
		clearInterval(_ringtoneTimer);
		_ringtoneTimer = null;
	}
}

interface SlotRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export function ParrotEmbedPane() {
	const { data: me } = useCurrentEmployee();
	const location = useLocation();
	const navigate = useNavigate();
	const pathname = location.pathname;
	// The pane is visually shown only on the Parrot route. Everywhere else
	// the SAME iframe stays mounted (SIP session alive) but display:none.
	const visible = pathname.startsWith("/parrot");
	const signedIn = !!me;

	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	// Guards so the src is set exactly once (a src change reloads the iframe and
	// drops the Telnyx SIP registration) and the initial mint fires once.
	const srcSetRef = useRef(false);
	const mintStartedRef = useRef(false);
	const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const readyRef = useRef(false);
	// useNavigate is stable, but mirror it into a ref so the []-deps dial
	// listener never reads a stale closure.
	const navigateRef = useRef(navigate);
	useEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);

	const [iframeSrc, setIframeSrc] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [loadTimedOut, setLoadTimedOut] = useState(false);
	const [rect, setRect] = useState<SlotRect | null>(null);
	const [incomingCall, setIncomingCall] =
		useState<ParrotIncomingCallPayload | null>(null);

	useEffect(() => {
		readyRef.current = ready;
	}, [ready]);

	// Arm (or re-arm) the "parrot:ready never arrived" timeout. When it fires
	// and we're still not ready, surface the Retry affordance.
	const startReadyTimeout = useCallback(() => {
		if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
		setLoadTimedOut(false);
		readyTimeoutRef.current = setTimeout(() => {
			if (!readyRef.current) setLoadTimedOut(true);
		}, PARROT_READY_TIMEOUT_MS);
	}, []);

	// First mint: fetch a token and set the iframe src exactly once.
	const doInitialMint = useCallback(async () => {
		try {
			const res = await api.mintParrotEmbedToken();
			srcSetRef.current = true;
			setIframeSrc(buildEmbedSrc(res.embed_url, res.token));
			startReadyTimeout();
		} catch {
			// No src yet — show the Retry affordance so the employee can trigger
			// another attempt (network hiccup / token endpoint transiently down).
			setLoadTimedOut(true);
		}
	}, [startReadyTimeout]);

	// Refresh: re-mint and PUSH the fresh token into the already-loaded iframe.
	// Never touches src (that would reload the iframe and drop the SIP session).
	const pushFreshToken = useCallback(async () => {
		try {
			const res = await api.mintParrotEmbedToken();
			iframeRef.current?.contentWindow?.postMessage(
				buildParrotTokenMessage(res.token),
				PARROT_EMBED_ORIGIN,
			);
		} catch {
			/* transient — the next interval tick retries */
		}
	}, []);

	const handleRetry = useCallback(() => {
		setReady(false);
		setLoadTimedOut(false);
		if (!srcSetRef.current) {
			// Initial mint never succeeded — try again (this DOES set src).
			void doInitialMint();
		} else {
			// The iframe already exists; a stuck parrot:ready is almost always a
			// token/network issue, so re-mint + re-arm the timeout WITHOUT
			// reloading src.
			startReadyTimeout();
			void pushFreshToken();
		}
	}, [doInitialMint, pushFreshToken, startReadyTimeout]);

	// Kick off the initial mint once the employee is signed in.
	useEffect(() => {
		if (!signedIn || mintStartedRef.current) return;
		mintStartedRef.current = true;
		void doInitialMint();
	}, [signedIn, doInitialMint]);

	// Token refresh timer — re-mint every ~90s (inside the 120s TTL) and push.
	useEffect(() => {
		if (!signedIn) return;
		const id = setInterval(() => {
			if (srcSetRef.current) void pushFreshToken();
		}, PARROT_TOKEN_REFRESH_MS);
		return () => clearInterval(id);
	}, [signedIn, pushFreshToken]);

	// Defensive cleanup of the ready timeout on unmount (this component is
	// root-mounted and shouldn't unmount in practice, but clean up anyway).
	useEffect(
		() => () => {
			if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
		},
		[],
	);

	// ── Inbound postMessage bridge ────────────────────────────────────────
	// ONE listener, []-deps. EVERY branch is gated on the origin check, which
	// runs BEFORE we touch event.data. All the state setters and module-level
	// ringtone helpers are stable, so no ref-mirroring is needed here.
	useEffect(() => {
		if (typeof window === "undefined") return;
		function onMessage(event: MessageEvent) {
			// Origin check FIRST — a message from any other origin is a no-op.
			if (!isTrustedParrotOrigin(event.origin)) return;
			const data = event.data;
			if (isParrotReadyMessage(data)) {
				setReady(true);
				setLoadTimedOut(false);
				if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
				return;
			}
			const badge = parseParrotBadge(data);
			if (badge) {
				// Broadcast for WorkspaceShell nav badges (wired in 32-03) — mirrors
				// the existing chat-unread-change CustomEvent pattern.
				window.dispatchEvent(
					new CustomEvent(PARROT_BADGE_CHANGE_EVENT, { detail: badge }),
				);
				return;
			}
			const incoming = parseParrotIncomingCall(data);
			if (incoming) {
				setIncomingCall(incoming);
				playIncomingCallRingtone();
				return;
			}
			if (isParrotCallEndedMessage(data)) {
				setIncomingCall(null);
				stopIncomingCallRingtone();
				return;
			}
		}
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// ── Outbound dial-request listener ────────────────────────────────────
	// Built now so Plan 32-03 only has to add the dispatcher (a
	// window.dispatchEvent of PARROT_DIAL_REQUEST_EVENT) — it never touches
	// this file again. Inert until that dispatcher exists.
	useEffect(() => {
		if (typeof window === "undefined") return;
		function onDial(event: Event) {
			const detail = (event as CustomEvent<{ number?: string }>).detail;
			const number = detail?.number;
			if (!number) return;
			iframeRef.current?.contentWindow?.postMessage(
				buildParrotDialMessage(number),
				PARROT_EMBED_ORIGIN,
			);
			navigateRef.current("/parrot");
		}
		window.addEventListener(PARROT_DIAL_REQUEST_EVENT, onDial);
		return () =>
			window.removeEventListener(PARROT_DIAL_REQUEST_EVENT, onDial);
	}, []);

	// ── Slot-position sync ────────────────────────────────────────────────
	// While visible, measure the [data-parrot-embed-slot] marker (rendered by
	// parrot.tsx) and mirror its rect onto our fixed wrapper. Re-measure
	// on route change (effect dep), window resize/scroll, and slot resize
	// (ResizeObserver — catches secondary-nav toggles without a full resize).
	// The route component may code-split, so poll a few frames until the slot
	// exists before attaching the observer.
	useEffect(() => {
		if (!visible || typeof window === "undefined") return;

		let raf = 0;
		let attempts = 0;
		let observer: ResizeObserver | null = null;

		const measure = (slot: Element) => {
			const r = slot.getBoundingClientRect();
			setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
		};

		const onWindowChange = () => {
			const slot = document.querySelector("[data-parrot-embed-slot]");
			if (slot) measure(slot);
		};

		const attach = () => {
			const slot = document.querySelector("[data-parrot-embed-slot]");
			if (!slot) {
				// Slot not mounted yet (route still code-splitting) — retry next frame.
				if (attempts++ < 30) raf = requestAnimationFrame(attach);
				return;
			}
			measure(slot);
			if (typeof ResizeObserver !== "undefined") {
				observer = new ResizeObserver(() => measure(slot));
				observer.observe(slot);
			}
		};

		raf = requestAnimationFrame(attach);
		window.addEventListener("resize", onWindowChange);
		window.addEventListener("scroll", onWindowChange, true);
		return () => {
			cancelAnimationFrame(raf);
			observer?.disconnect();
			window.removeEventListener("resize", onWindowChange);
			window.removeEventListener("scroll", onWindowChange, true);
		};
	}, [visible, pathname]);

	// No iframe in the DOM pre-auth.
	if (!signedIn) return null;

	return (
		<>
			<div
				data-parrot-embed-root
				style={{
					position: "fixed",
					top: rect?.top ?? 0,
					left: rect?.left ?? 0,
					width: rect?.width ?? 0,
					height: rect?.height ?? 0,
					display: visible ? "block" : "none",
					zIndex: 30,
					overflow: "hidden",
					background: "#ffffff",
				}}
				aria-hidden={!visible}
			>
				{iframeSrc ? (
					<iframe
						ref={iframeRef}
						data-testid="parrot-embed-iframe"
						title="Parrot phone and SMS"
						src={iframeSrc}
						// NON-NEGOTIABLE: without allow="microphone; autoplay" Telnyx
						// WebRTC getUserMedia is denied and every call fails silently.
						allow="microphone; autoplay"
						style={{
							width: "100%",
							height: "100%",
							border: "0",
							display: "block",
						}}
					/>
				) : null}

				{!ready ? (
					<div className="absolute inset-0 flex items-center justify-center bg-white/95">
						{loadTimedOut ? (
							<div className="flex flex-col items-center gap-3 text-center px-6">
								<p className="text-sm text-slate-600">
									Couldn&apos;t load Parrot.
								</p>
								<button
									type="button"
									onClick={handleRetry}
									className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
								>
									<RefreshCw size={16} strokeWidth={2} />
									Retry
								</button>
							</div>
						) : (
							<div className="flex flex-col items-center gap-3 text-slate-500">
								<Loader2 size={28} className="animate-spin" strokeWidth={1.75} />
								<p className="text-sm">Loading Parrot…</p>
							</div>
						)}
					</div>
				) : null}
			</div>

			{incomingCall ? (
				<button
					type="button"
					onClick={() => navigate("/parrot")}
					className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-left text-white shadow-lg hover:bg-slate-800"
				>
					<span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20">
						<PhoneIncoming size={18} className="text-emerald-300" />
					</span>
					<span>
						<span className="block text-xs uppercase tracking-wide text-slate-300">
							Incoming call
						</span>
						<span className="block text-sm font-medium">
							{incomingCall.name || incomingCall.from}
						</span>
					</span>
				</button>
			) : null}
		</>
	);
}
