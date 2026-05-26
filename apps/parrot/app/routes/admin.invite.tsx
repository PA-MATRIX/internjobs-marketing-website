// v1.2 Phase 16 Wave 2: /admin/invite — full operator invite form.
//
// Rewrites the Phase 10 minimal 3-field form (name/personalEmail/displayName)
// into a Phase 16 rich invite: First name, Last name, personal email, phone
// number (E.164), and 6 capability toggles (email/chat/meetings/phone/sms/
// campaigns) that default ALL ON.
//
// Backward compatibility: the request body still includes `name` (concat of
// firstName + lastName) so the backend's existing slugify-from-name path
// keeps working unchanged. The server requires `phoneNumber` because Parrot
// login is phone-OTP only; workspace email is created inside Parrot, not as
// a Clerk login identifier.
//
// Validation: phone must match /^\+[1-9]\d{7,14}$/ (E.164) client-side
// before the API call fires — the server enforces the same regex but we
// shortcut the round trip and surface an inline field error.
//
// Operator gate: API enforces requireOperator middleware. Non-operators
// see a 403 surfaced as the "error" panel.
//
// v1.4 Phase 25 Plan 02 (brand refit): structural surfaces moved to brand
// tokens — lavender page background, cream form card, ink text, cobalt
// submit button (per BRAND-V1.md). UI-state colors (rose for error, emerald
// for success) remain Tailwind utility classes per BRAND-V1 edge-case rule.

import { useState } from "react";
import { Link } from "react-router";
import { WorkspaceShell } from "~/components/WorkspaceShell";
import { apiFetch } from "~/lib/api";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

type CapabilityKey =
	| "email"
	| "chat"
	| "meetings"
	| "phone"
	| "sms"
	| "campaigns";

const CAPABILITY_KEYS: CapabilityKey[] = [
	"email",
	"chat",
	"meetings",
	"phone",
	"sms",
	"campaigns",
];

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
	email: "Email",
	chat: "Chat / Mattermost",
	meetings: "Meetings / Daily.co",
	phone: "Phone",
	sms: "SMS",
	campaigns: "Campaigns",
};

interface CapabilityFlags {
	email: boolean;
	chat: boolean;
	meetings: boolean;
	phone: boolean;
	sms: boolean;
	campaigns: boolean;
}

const ALL_ON: CapabilityFlags = {
	email: true,
	chat: true,
	meetings: true,
	phone: true,
	sms: true,
	campaigns: true,
};

interface InviteResponse {
	employee: {
		id: string;
		clerk_user_id: string;
		workspace_email: string;
		personal_email: string;
		display_name: string;
		status: string;
		created_at: string;
	};
	routing_rule_id: string | null;
	routing_error: string | null;
	welcome_email_sent: boolean;
	welcome_error: string | null;
	feature_flags: Record<string, boolean>;
}

interface ApiError {
	error: string;
	[k: string]: unknown;
}

async function submitInvite(input: {
	firstName: string;
	lastName: string;
	personalEmail: string;
	phoneNumber: string;
	featureFlags: CapabilityFlags;
}): Promise<InviteResponse> {
	const name = `${input.firstName} ${input.lastName}`.trim();
	const res = await apiFetch("/api/admin/employees", {
		method: "POST",
		body: JSON.stringify({
			name, // still required by backend for slug derivation
			firstName: input.firstName,
			lastName: input.lastName,
			personalEmail: input.personalEmail,
			phoneNumber: input.phoneNumber,
			featureFlags: input.featureFlags,
		}),
	});
	const body = (await res.json().catch(() => null)) as
		| InviteResponse
		| ApiError
		| null;
	if (!res.ok) {
		throw new Error(
			(body as ApiError | null)?.error || `Invite failed (${res.status})`,
		);
	}
	return body as InviteResponse;
}

export default function AdminInviteRoute() {
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [personalEmail, setPersonalEmail] = useState("");
	const [phoneNumber, setPhoneNumber] = useState("");
	const [featureFlags, setFeatureFlags] = useState<CapabilityFlags>({
		...ALL_ON,
	});
	const [phoneFieldError, setPhoneFieldError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<InviteResponse | null>(null);

	function toggleFlag(key: CapabilityKey) {
		setFeatureFlags((prev) => ({ ...prev, [key]: !prev[key] }));
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setResult(null);
		setPhoneFieldError(null);

		// Client-side E.164 check — defense alongside the server-side Zod
		// regex. Doing it here shortcuts the round trip and gives the
		// operator an inline field error rather than a banner.
		if (!E164_REGEX.test(phoneNumber)) {
			setPhoneFieldError(
				"Phone must be E.164 format, e.g. +12125551234",
			);
			return;
		}

		setBusy(true);
		try {
			const res = await submitInvite({
				firstName,
				lastName,
				personalEmail,
				phoneNumber,
				featureFlags,
			});
			setResult(res);
			setFirstName("");
			setLastName("");
			setPersonalEmail("");
			setPhoneNumber("");
			setFeatureFlags({ ...ALL_ON });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	const canSubmit =
		!busy && firstName && lastName && personalEmail && phoneNumber;

	return (
		<WorkspaceShell title="add employee">
			<div
				className="mx-auto w-full max-w-2xl p-4 sm:p-6"
				style={{ background: "var(--lavender)" }}
			>
				<div className="mb-3">
					<Link
						to="/admin"
						className="text-xs font-medium [color:color-mix(in_srgb,var(--ink)_50%,transparent)] hover:[color:var(--ink)] no-underline"
					>
						← Back to admin
					</Link>
				</div>
				<div
					className="rounded-xl border border-[var(--ink)]/10 p-4 sm:p-6"
					style={{ background: "var(--cream)" }}
				>
					<h2 className="text-lg font-semibold [color:var(--ink)]">
						add employee
					</h2>
					<p className="mt-1 text-sm [color:color-mix(in_srgb,var(--ink)_60%,transparent)]">
						Creates a Clerk user with a derived{" "}
						<code>@internjobs.ai</code> address, adds an Email Routing rule
						for it, and emails the new hire instructions at their personal
						address. The phone number is the login credential — employees
						sign in at workspace.internjobs.ai with phone-OTP.
					</p>

					<form className="mt-6 space-y-4" onSubmit={onSubmit}>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<label
									htmlFor="emp-first-name"
									className="block text-sm font-medium [color:var(--ink)]"
								>
									First name
								</label>
								<input
									id="emp-first-name"
									type="text"
									required
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									placeholder="Alice"
									className="mt-1 w-full rounded-md border border-[var(--ink)]/30 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
								/>
							</div>
							<div>
								<label
									htmlFor="emp-last-name"
									className="block text-sm font-medium [color:var(--ink)]"
								>
									Last name
								</label>
								<input
									id="emp-last-name"
									type="text"
									required
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									placeholder="Smith"
									className="mt-1 w-full rounded-md border border-[var(--ink)]/30 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
								/>
							</div>
						</div>

						<div>
							<label
								htmlFor="emp-personal"
								className="block text-sm font-medium [color:var(--ink)]"
							>
								Personal email
							</label>
							<input
								id="emp-personal"
								type="email"
								required
								value={personalEmail}
								onChange={(e) => setPersonalEmail(e.target.value)}
								placeholder="alice@personal.example"
								className="mt-1 w-full rounded-md border border-[var(--ink)]/30 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]/20"
							/>
							<p className="mt-1 text-xs [color:color-mix(in_srgb,var(--ink)_50%,transparent)]">
								Welcome email destination. Not used for login.
							</p>
						</div>

						<div>
							<label
								htmlFor="emp-phone"
								className="block text-sm font-medium [color:var(--ink)]"
							>
								Phone number
							</label>
							<input
								id="emp-phone"
								type="tel"
								required
								value={phoneNumber}
								onChange={(e) => {
									setPhoneNumber(e.target.value);
									if (phoneFieldError) setPhoneFieldError(null);
								}}
								placeholder="+12125551234"
								className={`mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 ${
									phoneFieldError
										? "border-rose-400 focus:ring-rose-400/30"
										: "border-[var(--ink)]/30 focus:ring-[var(--ink)]/20"
								}`}
							/>
							{phoneFieldError ? (
								<p className="mt-1 text-xs text-rose-700">
									{phoneFieldError}
								</p>
							) : (
								<p className="mt-1 text-xs [color:color-mix(in_srgb,var(--ink)_50%,transparent)]">
									E.164 format. This is the login credential — employees
									enter it at workspace.internjobs.ai to receive their OTP.
								</p>
							)}
						</div>

						<fieldset className="rounded-md border border-[var(--ink)]/10 p-4">
							<legend className="px-1 text-sm font-medium [color:var(--ink)]">
								Capabilities (all enabled by default)
							</legend>
							<p className="text-xs [color:color-mix(in_srgb,var(--ink)_50%,transparent)] mb-3">
								Uncheck any surfaces this employee should NOT see. You can
								change these later from the admin directory.
							</p>
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
								{CAPABILITY_KEYS.map((key) => (
									<label
										key={key}
										className="flex items-center gap-2 rounded-md border border-[var(--ink)]/15 [background:var(--cream)] px-3 py-2 text-sm cursor-pointer hover:[background:color-mix(in_srgb,var(--lavender)_50%,var(--cream))]"
									>
										<input
											type="checkbox"
											checked={featureFlags[key]}
											onChange={() => toggleFlag(key)}
											className="h-4 w-4 rounded border-[var(--ink)]/30"
										/>
										<span className="[color:var(--ink)]">
											{CAPABILITY_LABELS[key]}
										</span>
									</label>
								))}
							</div>
						</fieldset>

						<div className="pt-2">
							<button
								type="submit"
								disabled={!canSubmit}
								className="w-full rounded-md [background:var(--cobalt)] px-4 py-2 text-sm font-medium text-white hover:[background:color-mix(in_srgb,var(--cobalt)_80%,black)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
							>
								{busy ? "Inviting…" : "Send invite"}
							</button>
						</div>
					</form>

					{error && (
						<div className="mt-4 rounded-md bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-900">
							{error}
						</div>
					)}

					{result && (
						<div className="mt-6 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
							<p className="font-medium">Invite sent.</p>
							<dl className="mt-2 grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-[max-content_1fr] sm:gap-x-3">
								<dt className="text-emerald-700">Workspace email</dt>
								<dd className="font-mono">
									{result.employee.workspace_email}
								</dd>
								<dt className="text-emerald-700">Clerk user</dt>
								<dd className="font-mono break-all">
									{result.employee.clerk_user_id}
								</dd>
								<dt className="text-emerald-700">Routing rule</dt>
								<dd>
									{result.routing_rule_id ? (
										<span className="font-mono">
											{result.routing_rule_id}
										</span>
									) : (
										<span className="text-rose-700">
											failed — {result.routing_error}
										</span>
									)}
								</dd>
								<dt className="text-emerald-700">Welcome email</dt>
								<dd>
									{result.welcome_email_sent
										? "sent"
										: `failed — ${result.welcome_error}`}
								</dd>
								<dt className="text-emerald-700">Capabilities</dt>
								<dd>
									{Object.entries(result.feature_flags)
										.filter(([, v]) => v)
										.map(([k]) => k)
										.join(", ") || "(none enabled)"}
								</dd>
							</dl>
							<div className="mt-3">
								<Link
									to="/admin"
									className="text-xs font-medium text-emerald-900 hover:underline"
								>
									Go to admin list →
								</Link>
							</div>
						</div>
					)}
				</div>
			</div>
		</WorkspaceShell>
	);
}
