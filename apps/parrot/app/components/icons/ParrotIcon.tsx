// The flying-parrot glyph for the "Parrot" pane nav icon.
//
// Artwork supplied by Nithin (a flying-parrot silhouette). The source art flew
// right-to-left; it was mirrored to fly left-to-right and the stock-ID strip was
// cropped off. The processed asset lives at apps/parrot/public/parrot-icon.png
// as an ALPHA MASK (opaque where the parrot is, transparent elsewhere).
//
// It is rendered as a CSS mask over a currentColor background rather than an
// <img> so it behaves exactly like the sibling lucide nav icons: it inherits the
// nav's text colour (slate-400 idle / slate-900 active) and the same `size` the
// nav passes. Note the art is a filled silhouette, so it reads heavier than the
// outline lucide icons around it — that is inherent to the chosen artwork.
//
// Typed as LucideProps so it drops into WorkspaceShell's NAV (ComponentType<LucideProps>)
// alongside the real lucide icons. `strokeWidth` is accepted and ignored (a filled
// mask has no stroke).

import type { LucideProps } from "lucide-react";

const MASK = "url(/parrot-icon.png)";

export function ParrotIcon({ size = 24, color, className }: LucideProps) {
	return (
		<span
			aria-hidden="true"
			className={className}
			style={{
				display: "inline-block",
				width: size,
				height: size,
				backgroundColor: color ?? "currentColor",
				WebkitMaskImage: MASK,
				maskImage: MASK,
				WebkitMaskRepeat: "no-repeat",
				maskRepeat: "no-repeat",
				WebkitMaskPosition: "center",
				maskPosition: "center",
				WebkitMaskSize: "contain",
				maskSize: "contain",
			}}
		/>
	);
}
