// v1.2 Phase 10 Wave 2b: /sign-in — Clerk-managed employee sign-in.
//
// Parrot uses the dedicated employee Clerk app. The Clerk instance is
// configured for phone OTP, so the standard Clerk form should own phone
// formatting, country selection, resend behavior, verification-code entry,
// and recovery states. The app only preserves same-site redirects and
// sends already-authenticated users straight into the workspace.

import { useEffect, useMemo } from "react";
import { SignIn, useAuth } from "@clerk/clerk-react";
import { useSearchParams } from "react-router";
import { VantaBirds } from "../components/VantaBirds";

function safeRedirectUrl(raw: string | null): string {
	if (!raw || raw === "/sign-in" || raw.startsWith("/sign-in/")) {
		return "/dashboard";
	}
	if (raw.startsWith("/") && !raw.startsWith("//")) {
		return raw;
	}
	return "/dashboard";
}

function isIdentifierInput(input: HTMLInputElement): boolean {
	const name = input.name.toLowerCase();
	const ariaLabel = input.getAttribute("aria-label")?.toLowerCase() ?? "";
	const placeholder = input.placeholder.toLowerCase();
	const autocomplete = input.autocomplete.toLowerCase();

	if (autocomplete === "one-time-code") return false;
	if (name.includes("code") || ariaLabel.includes("code")) return false;

	return (
		name.includes("identifier") ||
		ariaLabel.includes("email") ||
		ariaLabel.includes("phone") ||
		placeholder.includes("email") ||
		placeholder.includes("phone")
	);
}

function replaceClerkText(root: HTMLElement) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const replacements: Array<[RegExp, string]> = [
		[/Email address or phone number/g, "Phone number"],
		[/Email or phone/g, "Phone number"],
		[/email address or phone number/g, "phone number"],
		[/email or phone/g, "phone number"],
	];

	let node = walker.nextNode();
	while (node) {
		let nextValue = node.nodeValue ?? "";
		for (const [pattern, replacement] of replacements) {
			nextValue = nextValue.replace(pattern, replacement);
		}
		if (nextValue !== node.nodeValue) {
			node.nodeValue = nextValue;
		}
		node = walker.nextNode();
	}

	for (const input of root.querySelectorAll("input")) {
		if (input instanceof HTMLInputElement && isIdentifierInput(input)) {
			if (input.type !== "tel") input.type = "tel";
			if (input.inputMode !== "tel") input.inputMode = "tel";
			if (input.autocomplete !== "tel") input.autocomplete = "tel";
			if (input.placeholder !== "+1 555 555 5555") {
				input.placeholder = "+1 555 555 5555";
			}
		}
	}
}

function usePhoneOnlyClerkSignIn(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		const root = document.querySelector<HTMLElement>("[data-parrot-sign-in]");
		if (!root) return;

		const blockEmailSubmit = (event: Event) => {
			const identifier = Array.from(root.querySelectorAll("input")).find(
				(input): input is HTMLInputElement =>
					input instanceof HTMLInputElement && isIdentifierInput(input),
			);
			if (!identifier) return;

			if (identifier.value.includes("@")) {
				event.preventDefault();
				event.stopPropagation();
				identifier.setCustomValidity(
					"Use your employee phone number to sign in to Parrot.",
				);
				identifier.reportValidity();
				return;
			}

			identifier.setCustomValidity("");
		};

		const observer = new MutationObserver(() => replaceClerkText(root));
		observer.observe(root, {
			attributes: true,
			characterData: true,
			childList: true,
			subtree: true,
		});

		replaceClerkText(root);
		root.addEventListener("submit", blockEmailSubmit, true);
		return () => {
			observer.disconnect();
			root.removeEventListener("submit", blockEmailSubmit, true);
		};
	}, [enabled]);
}

export default function LoginRoute() {
	const [params] = useSearchParams();
	const reason = params.get("reason");
	const redirectUrl = useMemo(
		() => safeRedirectUrl(params.get("redirect_url")),
		[params],
	);
	const { isLoaded, isSignedIn } = useAuth();

	useEffect(() => {
		if (isLoaded && isSignedIn) {
			window.location.replace(redirectUrl);
		}
	}, [isLoaded, isSignedIn, redirectUrl]);

	const isRedirecting = isLoaded && isSignedIn;
	const isCheckingSession = !isLoaded;
	usePhoneOnlyClerkSignIn(isLoaded && !isSignedIn);

	return (
		<div className="min-h-screen flex items-center justify-center p-6 relative">
			<VantaBirds />
			<div className="w-full max-w-md relative z-10">
				<div className="mb-5 text-center">
					<img
						src="/logo.svg"
						alt="InternJobs.ai"
						className="mx-auto mb-3 h-12 w-12 rounded-xl shadow-sm"
					/>
					<h1 className="text-xl font-semibold text-slate-900">
						InternJobs.AI Parrot Workspace
					</h1>
					<p className="text-sm text-slate-700 mt-1 italic">
						Birds of the same flock fly together.
					</p>
				</div>

				{reason && !isRedirecting ? (
					<p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
						{reason === "external_email"
							? "Parrot is for InternJobs Team members. Ask an operator to invite you."
							: "Please sign in to continue."}
					</p>
				) : null}

				{isCheckingSession ? (
					<div className="rounded-xl border border-white/40 bg-white/80 p-6 text-center text-sm text-slate-700 shadow-xl backdrop-blur-sm">
						Checking your session...
					</div>
				) : isRedirecting ? (
					<div className="rounded-xl border border-white/40 bg-white/70 p-6 text-center text-sm text-slate-700 shadow-xl backdrop-blur-sm">
						Opening your workspace...
					</div>
				) : (
					<div data-parrot-sign-in>
						<SignIn
							routing="path"
							path="/sign-in"
							forceRedirectUrl={redirectUrl}
							fallbackRedirectUrl={redirectUrl}
							appearance={{
								elements: {
									cardBox:
										"shadow-xl border border-white/40 backdrop-blur-sm",
									card: "bg-white/95",
									footer: "hidden",
								},
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
