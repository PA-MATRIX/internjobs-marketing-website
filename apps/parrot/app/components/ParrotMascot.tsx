// v1.4 Phase 26 GENZ-03: Parrot mascot loading state.
//
// Emoji stub with CSS bounce animation. Replaces the generic animate-pulse
// skeleton on the dashboard initial load. Tone target: lively but not
// saccharine — matches the confetti polish track (see confetti.ts header).
//
// TODO v1.5: replace with illustrated SVG mascot at
// apps/parrot/public/mascot-parrot.svg when the design asset is ready.
// The <img> tag should be: <img src="/mascot-parrot.svg" alt="Parrot" className="w-16 h-16" />

export function ParrotMascot({
	label = "Loading your workspace...",
}: {
	label?: string;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-12 gap-3">
			<span
				role="img"
				aria-label="parrot"
				className="text-5xl animate-bounce"
				style={{ animationDuration: "0.9s" }}
			>
				🦜
			</span>
			<p className="text-sm text-slate-500 font-medium">{label}</p>
		</div>
	);
}
