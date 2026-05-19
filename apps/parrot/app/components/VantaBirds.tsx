// Vanta.js "Birds" — using the canonical CDN script-tag pattern from
// https://www.vantajs.com/?effect=birds verbatim. We tried the npm
// imports first but ran into three.js version mismatches; the CDN
// version bundles a known-good three.js.

import { useEffect, useRef } from "react";

declare global {
	interface Window {
		THREE?: unknown;
		VANTA?: {
			BIRDS: (opts: Record<string, unknown>) => { destroy: () => void };
		};
	}
}

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		// Don't double-load.
		if (Array.from(document.scripts).some((s) => s.src === src)) {
			resolve();
			return;
		}
		const s = document.createElement("script");
		s.src = src;
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.appendChild(s);
	});
}

export function VantaBirds() {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let effect: { destroy: () => void } | undefined;
		let cancelled = false;

		(async () => {
			await loadScript(
				"https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js",
			);
			await loadScript(
				"https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.birds.min.js",
			);
			if (cancelled || !ref.current || !window.VANTA) return;
			effect = window.VANTA.BIRDS({
				el: ref.current,
				mouseControls: true,
				touchControls: true,
				gyroControls: false,
				minHeight: 200.0,
				minWidth: 200.0,
				scale: 1.0,
				scaleMobile: 1.0,
			});
		})().catch((err) => {
			console.warn("VantaBirds init failed:", err);
		});

		return () => {
			cancelled = true;
			try {
				effect?.destroy();
			} catch {
				/* noop */
			}
		};
	}, []);

	return (
		<div
			ref={ref}
			className="fixed inset-0"
			style={{ zIndex: 0 }}
			aria-hidden="true"
		/>
	);
}
