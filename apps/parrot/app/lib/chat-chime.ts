// Shared notification chime.
//
// A short Web-Audio chime: a two-tone chime for "strong" events (@mentions),
// a single tone otherwise. The AudioContext is created lazily (first sound
// after the user has interacted with the page, which browser autoplay policy
// allows) and reused. Everything is wrapped in try/catch and feature-checks so
// unsupported browsers silently no-op.
//
// Extracted from ChatPane so the Parrot pane can reuse the EXACT same sound for
// inbound SMS (per the 2026-07-17 request), rather than importing the whole
// heavy ChatPane module or drifting with a copy.

let _chatAudioCtx: AudioContext | null = null;

export function playChatChime(strong: boolean) {
	try {
		if (typeof window === "undefined") return;
		const Ctx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctx) return;
		if (!_chatAudioCtx) _chatAudioCtx = new Ctx();
		const ctx = _chatAudioCtx;
		if (ctx.state === "suspended") void ctx.resume();
		const now = ctx.currentTime;
		const tones = strong ? [880, 1320] : [760];
		tones.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			const t = now + i * 0.13;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.22);
		});
	} catch {
		/* audio unavailable — ignore */
	}
}
