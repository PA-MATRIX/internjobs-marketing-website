// v1.2 Phase 10 Wave 2b: /admin/invite — operator-only invite form.
//
// Server-rendered form that calls POST /api/admin/employees. The
// operator role check happens inside the API handler
// (workers/lib/operator.ts) — we don't gate the page itself, just
// surface the 403 response if the signed-in user isn't an operator.
//
// The form takes:
//   - Name (mandatory) — slugified to derive workspace email.
//   - Personal email (mandatory) — where the welcome message goes.
//   - Display name (optional) — falls back to Name.
//
// On success we show a summary panel with the new workspace email and
// the side-effect statuses (Clerk user created, routing rule added,
// welcome email sent). Each side-effect is reported independently so
// the operator can fix any partial failure without losing the rest.

import { useState } from "react";
import { WorkspaceShell } from "~/components/WorkspaceShell";

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
}

interface ApiError {
	error: string;
	[k: string]: unknown;
}

async function submitInvite(input: {
	name: string;
	personalEmail: string;
	displayName?: string;
}): Promise<InviteResponse> {
	const res = await fetch("/api/admin/employees", {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			name: input.name,
			personalEmail: input.personalEmail,
			...(input.displayName ? { displayName: input.displayName } : {}),
		}),
	});
	const body = (await res.json().catch(() => null)) as
		| InviteResponse
		| ApiError
		| null;
	if (!res.ok) {
		throw new Error(
			(body as ApiError | null)?.error ||
				`Invite failed (${res.status})`,
		);
	}
	return body as InviteResponse;
}

export default function AdminInviteRoute() {
	const [name, setName] = useState("");
	const [personalEmail, setPersonalEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<InviteResponse | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			const res = await submitInvite({
				name,
				personalEmail,
				displayName: displayName || undefined,
			});
			setResult(res);
			setName("");
			setPersonalEmail("");
			setDisplayName("");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<WorkspaceShell title="Invite employee">
			<div className="max-w-2xl mx-auto p-6">
				<div className="rounded-xl border border-slate-200 bg-white p-6">
					<h2 className="text-lg font-semibold">Invite a new employee</h2>
					<p className="mt-1 text-sm text-slate-600">
						Creates a Clerk user with a derived <code>@internjobs.ai</code>{" "}
						address, adds an Email Routing rule for it, and emails the new
						hire instructions at their personal address.
					</p>

					<form className="mt-6 space-y-4" onSubmit={onSubmit}>
						<div>
							<label
								htmlFor="emp-name"
								className="block text-sm font-medium text-slate-700"
							>
								Name
							</label>
							<input
								id="emp-name"
								type="text"
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Alice Smith"
								className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
							/>
							<p className="mt-1 text-xs text-slate-500">
								Slugified to derive the workspace email (e.g. "Alice Smith"
								→ <code>alice.smith@internjobs.ai</code>).
							</p>
						</div>

						<div>
							<label
								htmlFor="emp-personal"
								className="block text-sm font-medium text-slate-700"
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
								className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
							/>
							<p className="mt-1 text-xs text-slate-500">
								Welcome email + OTP-forwarding fallback destination.
							</p>
						</div>

						<div>
							<label
								htmlFor="emp-display"
								className="block text-sm font-medium text-slate-700"
							>
								Display name <span className="text-slate-400">(optional)</span>
							</label>
							<input
								id="emp-display"
								type="text"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="Defaults to the name above"
								className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
							/>
						</div>

						<div className="pt-2">
							<button
								type="submit"
								disabled={busy || !name || !personalEmail}
								className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
							<dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
								<dt className="text-emerald-700">Workspace email</dt>
								<dd className="font-mono">{result.employee.workspace_email}</dd>
								<dt className="text-emerald-700">Clerk user</dt>
								<dd className="font-mono break-all">
									{result.employee.clerk_user_id}
								</dd>
								<dt className="text-emerald-700">Routing rule</dt>
								<dd>
									{result.routing_rule_id ? (
										<span className="font-mono">{result.routing_rule_id}</span>
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
							</dl>
						</div>
					)}
				</div>
			</div>
		</WorkspaceShell>
	);
}
