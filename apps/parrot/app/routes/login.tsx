// v1.2 Phase 10 Wave 1: /sign-in route — Clerk handoff.
//
// Clerk's Account Portal lives on accounts.workspace.internjobs.ai once
// the second Clerk instance is provisioned (Step 1 of Wave 1 in PLAN.md,
// USER ACTION). Until then the local /sign-in page just explains what's
// expected; clicking the button kicks the user out to the placeholder
// Clerk URL.

import { useSearchParams } from "react-router";

const CLERK_ACCOUNTS_URL =
	"https://accounts.workspace.internjobs.ai/sign-in";

export default function LoginRoute() {
	const [params] = useSearchParams();
	const reason = params.get("reason");

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
			<div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
				<h1 className="text-xl font-semibold mb-1">Parrot Workspace</h1>
				<p className="text-sm text-slate-600 mb-6">
					InternJobs internal workspace — sign in with your{" "}
					<code className="text-xs">@internjobs.ai</code> account.
				</p>

				{reason === "external_email" && (
					<p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
						Parrot is for InternJobs employees only. Sign in with an
						@internjobs.ai email.
					</p>
				)}

				<a
					href={CLERK_ACCOUNTS_URL}
					className="block w-full rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800 no-underline"
				>
					Continue with Clerk
				</a>

				<p className="mt-6 text-xs text-slate-500">
					Wave 1 stub: the second Clerk instance
					(<code>accounts.workspace.internjobs.ai</code>) is a planned
					user-side provisioning step. Until it exists this button leads
					to a 404.
				</p>
			</div>
		</div>
	);
}
