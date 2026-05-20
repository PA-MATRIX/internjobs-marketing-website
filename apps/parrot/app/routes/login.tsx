// v1.2 Phase 10 Wave 2b: /sign-in — employee code sign-in.
//
// We use Clerk as the auth provider, but render a small custom flow
// instead of the stock <SignIn> widget. That lets Parrot control resend
// cooldown UX and avoid duplicate code requests when a user clicks Continue
// repeatedly. The primary path is phone OTP; verified workspace emails can
// be used as a fallback for admins who have one attached in Clerk.

import { useMemo, useState } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { VantaBirds } from "../components/VantaBirds";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_MS = 35_000;
const COOLDOWN_KEY_PREFIX = "parrot_code_sent_at:";

type Step = "identifier" | "code";
type CodeFactor =
	| { strategy: "phone_code"; phoneNumberId: string }
	| { strategy: "email_code"; emailAddressId: string };

function normalizePhone(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
	const digits = trimmed.replace(/\D/g, "");
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
	return trimmed;
}

function normalizeIdentifier(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.includes("@")) return trimmed.toLowerCase();
	return normalizePhone(trimmed);
}

function isEmail(identifier: string): boolean {
	return EMAIL_REGEX.test(identifier);
}

function userMessage(err: unknown): string {
	const maybe = err as {
		errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
		message?: string;
	};
	const first = maybe?.errors?.[0];
	return (
		first?.longMessage ||
		first?.message ||
		maybe?.message ||
		"Sign-in failed. Please try again."
	);
}

function getCooldownRemaining(identifier: string): number {
	if (typeof window === "undefined") return 0;
	const sentAt = Number(
		window.localStorage.getItem(`${COOLDOWN_KEY_PREFIX}${identifier}`) || "0",
	);
	return Math.max(0, sentAt + RESEND_COOLDOWN_MS - Date.now());
}

function markCodeSent(identifier: string) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		`${COOLDOWN_KEY_PREFIX}${identifier}`,
		String(Date.now()),
	);
}

export default function LoginRoute() {
	const [params] = useSearchParams();
	const reason = params.get("reason");
	const redirectUrl = params.get("redirect_url") || "/";
	const { isLoaded, signIn, setActive } = useSignIn();

	const [step, setStep] = useState<Step>("identifier");
	const [identifierInput, setIdentifierInput] = useState("");
	const [identifier, setIdentifier] = useState("");
	const [codeFactor, setCodeFactor] = useState<CodeFactor | null>(null);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [cooldownUntil, setCooldownUntil] = useState(0);
	const cooldownRemaining = Math.max(0, cooldownUntil - Date.now());
	const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);

	const normalizedIdentifier = useMemo(
		() => normalizeIdentifier(identifierInput),
		[identifierInput],
	);

	async function sendCode(targetIdentifier: string, allowCooldown = true) {
		if (!isLoaded || !signIn) return;
		const cooldown = getCooldownRemaining(targetIdentifier);
		if (allowCooldown && cooldown > 0) {
			setCooldownUntil(Date.now() + cooldown);
			setError(
				`Please wait ${Math.ceil(cooldown / 1000)} seconds before requesting another code.`,
			);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const attempt = await signIn.create({ identifier: targetIdentifier });
			const factors = (attempt.supportedFirstFactors ?? []) as CodeFactor[];
			const preferEmail = isEmail(targetIdentifier);
			const factor =
				factors.find((f) =>
					preferEmail
						? f.strategy === "email_code"
						: f.strategy === "phone_code",
				) ??
				factors.find((f) => f.strategy === "email_code") ??
				factors.find((f) => f.strategy === "phone_code");
			if (!factor) {
				throw new Error("This account is not enabled for code sign-in.");
			}
			if (factor.strategy === "email_code") {
				await signIn.prepareFirstFactor({
					strategy: "email_code",
					emailAddressId: factor.emailAddressId,
				});
			} else {
				await signIn.prepareFirstFactor({
					strategy: "phone_code",
					phoneNumberId: factor.phoneNumberId,
				});
			}
			markCodeSent(targetIdentifier);
			setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
			setIdentifier(targetIdentifier);
			setCodeFactor(factor);
			setStep("code");
		} catch (e) {
			setError(userMessage(e));
		} finally {
			setBusy(false);
		}
	}

	async function onIdentifierSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (
			!E164_REGEX.test(normalizedIdentifier) &&
			!EMAIL_REGEX.test(normalizedIdentifier)
		) {
			setError("Enter a valid phone number or workspace email.");
			return;
		}
		await sendCode(normalizedIdentifier);
	}

	async function onCodeSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!isLoaded || !signIn || !setActive) return;
		setBusy(true);
		setError(null);
		try {
			if (!codeFactor) {
				throw new Error("Request a verification code first.");
			}
			const attempt = await signIn.attemptFirstFactor({
				strategy: codeFactor.strategy,
				code: code.trim(),
			});
			if (attempt.status !== "complete" || !attempt.createdSessionId) {
				throw new Error("Code accepted, but sign-in is not complete yet.");
			}
			await setActive({ session: attempt.createdSessionId });
			window.location.href = redirectUrl;
		} catch (e) {
			setError(userMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center p-6 relative">
			<VantaBirds />
			<div className="w-full max-w-md relative z-10 backdrop-blur-sm bg-white/60 rounded-xl border border-white/40 shadow-xl p-6">
				<div className="mb-6 text-center">
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
					<p className="text-xs text-slate-500 mt-3">
						Clerk verification keeps this workspace protected.
					</p>
				</div>

				{reason && (
					<p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
						{reason === "external_email"
							? "Parrot is for InternJobs Team members. Ask an operator to invite you."
							: "Please sign in to continue."}
					</p>
				)}

				{error && (
					<p className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
						{error}
					</p>
				)}

				{step === "identifier" ? (
					<form onSubmit={onIdentifierSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="identifier"
								className="block text-sm font-medium text-slate-700"
							>
								Phone number or workspace email
							</label>
							<input
								id="identifier"
								type="text"
								value={identifierInput}
								onChange={(e) => {
									setIdentifierInput(e.target.value);
									setError(null);
								}}
								placeholder="Mobile number or name@internjobs.ai"
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="none"
								spellCheck={false}
								name="parrot-workspace-identifier"
								className="mt-1 w-full rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
							/>
							<p className="mt-1 text-xs text-slate-500">
								US numbers can be entered with or without +1.
							</p>
						</div>
						<button
							type="submit"
							disabled={!isLoaded || busy || !identifierInput.trim()}
							className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
						>
							{busy ? <Loader2 className="animate-spin" size={16} /> : null}
							Send code
						</button>
					</form>
				) : (
					<form onSubmit={onCodeSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="code"
								className="block text-sm font-medium text-slate-700"
							>
								Verification code
							</label>
							<input
								id="code"
								type="text"
								inputMode="numeric"
								value={code}
								onChange={(e) => {
									setCode(e.target.value);
									setError(null);
								}}
								placeholder="123456"
								autoComplete="one-time-code"
								className="mt-1 w-full rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-sm tracking-[0.2em] outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
							/>
							<p className="mt-1 text-xs text-slate-500">
								Code sent to {isEmail(identifier) ? identifier : "your phone number"}.
							</p>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<button
								type="submit"
								disabled={!isLoaded || busy || code.trim().length < 4}
								className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
							>
								{busy ? <Loader2 className="animate-spin" size={16} /> : null}
								Continue
							</button>
							<button
								type="button"
								disabled={
									!isLoaded ||
									busy ||
									cooldownRemaining > 0 ||
									!codeFactor
								}
								onClick={() => sendCode(identifier)}
								className="rounded-md border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
							>
								{cooldownRemaining > 0
									? `Resend in ${cooldownSeconds}s`
									: "Resend code"}
							</button>
						</div>
						<button
							type="button"
							onClick={() => {
								setStep("identifier");
								setCode("");
								setCodeFactor(null);
								setError(null);
							}}
							className="text-xs font-medium text-slate-500 hover:text-slate-900"
						>
							Use a different sign-in identifier
						</button>
					</form>
				)}
			</div>
		</div>
	);
}
