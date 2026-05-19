// v1.2 Phase 13 Wave 3: OnboardingWizard — first-login 3-step modal.
//
// Shown when /api/me returns onboarded_at === null. Re-shown on every
// visit until the employee completes step 3 (POST /api/onboarding/complete
// flips onboarded_at to a non-null ISO timestamp server-side). Skippable
// per visit via the × button — the next page load will surface it again
// until the server-side flag flips.
//
// Steps:
//   1. Display name confirm (pre-filled from Clerk via /api/me).
//   2. Browser push opt-in (default OFF; opting in registers the
//      PushSubscription via navigator.serviceWorker.ready +
//      pushManager.subscribe() and POSTs it to /api/push/subscribe).
//   3. Mattermost ping + Finish. The Mattermost bot auto-registers the
//      employee on first poll cycle (see EmployeeMailboxDO.alarm /
//      pollMattermostNewPosts); the wizard just records the user's
//      consent and flips onboarded_at server-side.
//
// Push opt-in uses the VAPID public key passed in as a prop — the root
// loader reads it from env.PUSH_VAPID_PUBLIC_KEY and threads it down so
// we don't have to expose the key via a dedicated endpoint at runtime.
//
// Skills referenced:
//   cloudflare/skills: durable-objects, cloudflare — Web Push VAPID
//     (crypto.subtle) + per-employee onboarded_at on EmployeeMailboxDO.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

interface Props {
	initialDisplayName: string;
	/** VAPID public key (base64url). Empty string means push is unavailable
	 *  in this environment — step 2 still renders but the toggle is
	 *  disabled with an explanatory note. */
	vapidPublicKey: string;
	onComplete?: () => void;
}

type Step = 1 | 2 | 3;

type PushStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable";

/**
 * Convert a base64url-encoded VAPID public key to the Uint8Array
 * `applicationServerKey` shape that PushManager.subscribe() expects.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const out = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i += 1) {
		out[i] = rawData.charCodeAt(i);
	}
	return out;
}

export function OnboardingWizard({
	initialDisplayName,
	vapidPublicKey,
	onComplete,
}: Props) {
	const [open, setOpen] = useState(true);
	const [step, setStep] = useState<Step>(1);
	const [displayName, setDisplayName] = useState(initialDisplayName);
	const [pushEnabled, setPushEnabled] = useState(false);
	const [pushStatus, setPushStatus] = useState<PushStatus>(
		vapidPublicKey ? "idle" : "unavailable",
	);
	const queryClient = useQueryClient();

	const completeMutation = useMutation({
		mutationFn: () =>
			api.completeOnboarding({
				display_name: displayName,
				push_enabled: pushEnabled,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["parrot", "me"] });
			setOpen(false);
			onComplete?.();
		},
	});

	const handlePushToggle = async (enabled: boolean) => {
		if (!enabled) {
			setPushEnabled(false);
			if (pushStatus !== "denied" && pushStatus !== "unavailable") {
				setPushStatus("idle");
			}
			return;
		}
		if (!vapidPublicKey) {
			setPushStatus("unavailable");
			return;
		}
		setPushStatus("requesting");
		try {
			if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
				setPushStatus("unavailable");
				return;
			}
			const permission = await Notification.requestPermission();
			if (permission !== "granted") {
				setPushEnabled(false);
				setPushStatus("denied");
				return;
			}
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
			});
			await api.subscribePush(subscription);
			setPushEnabled(true);
			setPushStatus("granted");
		} catch (err) {
			console.warn("Push subscription failed:", err);
			setPushEnabled(false);
			setPushStatus("denied");
		}
	};

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
				{/* Header */}
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-base font-semibold text-slate-900">
						Welcome to Parrot
					</h2>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="text-lg leading-none text-slate-400 hover:text-slate-600"
						title="Skip for now (will re-appear next visit)"
						aria-label="Skip onboarding for now"
					>
						×
					</button>
				</div>

				{/* Step indicator */}
				<div className="mb-6 flex gap-1.5">
					{([1, 2, 3] as Step[]).map((s) => (
						<div
							key={s}
							className={`h-1 flex-1 rounded-full transition-colors ${
								s <= step ? "bg-slate-900" : "bg-slate-200"
							}`}
						/>
					))}
				</div>

				{/* Step 1: Display name */}
				{step === 1 && (
					<div>
						<p className="mb-4 text-sm text-slate-600">
							Confirm how your name appears to teammates in Parrot.
						</p>
						<label
							className="mb-1 block text-xs font-medium text-slate-500"
							htmlFor="onboarding-display-name"
						>
							Display name
						</label>
						<input
							id="onboarding-display-name"
							type="text"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
						/>
						<div className="mt-6 flex justify-end">
							<button
								type="button"
								onClick={() => setStep(2)}
								disabled={!displayName.trim()}
								className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
							>
								Next
							</button>
						</div>
					</div>
				)}

				{/* Step 2: Push notifications */}
				{step === 2 && (
					<div>
						<p className="mb-4 text-sm text-slate-600">
							Get browser notifications for urgent todos, starred emails, and
							@mentions. You can change this anytime in settings.
						</p>
						<div className="flex items-center gap-3 rounded-lg border border-slate-200 p-4">
							<div className="flex-1">
								<p className="text-sm font-medium text-slate-900">
									Browser push notifications
								</p>
								<p className="mt-0.5 text-xs text-slate-500">
									{pushStatus === "unavailable"
										? "Push not available in this browser (or VAPID key not configured)."
										: pushStatus === "denied"
											? "Permission denied — enable in browser settings."
											: pushStatus === "granted"
												? "Enabled. You'll get notifications when Parrot is in the background."
												: pushStatus === "requesting"
													? "Requesting permission…"
													: "Off by default. Enable to get notified when Parrot is in the background."}
								</p>
							</div>
							<button
								type="button"
								onClick={() => handlePushToggle(!pushEnabled)}
								disabled={
									pushStatus === "requesting" ||
									pushStatus === "denied" ||
									pushStatus === "unavailable"
								}
								className={`relative h-6 w-11 rounded-full transition-colors ${
									pushEnabled ? "bg-slate-900" : "bg-slate-200"
								} disabled:opacity-40`}
								role="switch"
								aria-checked={pushEnabled}
								aria-label="Toggle browser push notifications"
							>
								<span
									className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
										pushEnabled ? "translate-x-5" : "translate-x-0.5"
									}`}
								/>
							</button>
						</div>
						<div className="mt-6 flex justify-between">
							<button
								type="button"
								onClick={() => setStep(1)}
								className="text-sm text-slate-500 hover:text-slate-700"
							>
								Back
							</button>
							<button
								type="button"
								onClick={() => setStep(3)}
								className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
							>
								Next
							</button>
						</div>
					</div>
				)}

				{/* Step 3: Mattermost registration + finish */}
				{step === 3 && (
					<div>
						<p className="mb-4 text-sm text-slate-600">
							We'll register you in the team chat (Mattermost) so you can
							receive messages and @mentions right away.
						</p>
						<div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
							Chat registration happens automatically when you click Finish.
							You'll be able to join channels in the Chat pane.
						</div>
						{completeMutation.isError && (
							<p className="mt-3 text-sm text-rose-600">
								Couldn't finish onboarding — please try again.
							</p>
						)}
						<div className="mt-6 flex justify-between">
							<button
								type="button"
								onClick={() => setStep(2)}
								className="text-sm text-slate-500 hover:text-slate-700"
							>
								Back
							</button>
							<button
								type="button"
								onClick={() => completeMutation.mutate()}
								disabled={completeMutation.isPending}
								className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
							>
								{completeMutation.isPending ? "Finishing…" : "Finish"}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
