// v1.2 Phase 10 Wave 2b (revised 2026-05-18): /sign-in route.
//
// Parrot now reuses the student production Clerk app. The Account Portal
// lives at accounts.internjobs.ai (already in production for students).
// Cookies Clerk sets on `.internjobs.ai` propagate to
// workspace.internjobs.ai automatically — no second Clerk instance, no
// satellite-domain handshake needed.

import { useSearchParams } from "react-router";

const CLERK_ACCOUNTS_URL =
	"https://accounts.internjobs.ai/sign-in?redirect_url=https%3A%2F%2Fworkspace.internjobs.ai%2F";

export default function LoginRoute() {
	const [params] = useSearchParams();
	const reason = params.get("reason");

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
			<div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
				<h1 className="text-xl font-semibold mb-1">Parrot Workspace</h1>
				<p className="text-sm text-slate-600 mb-6">
					InternJobs internal workspace — sign in with your{" "}
					<a
						href="https://accounts.internjobs.ai"
						className="underline"
					>
						InternJobs account
					</a>
					. You need to be a member of the InternJobs Team workspace.
				</p>

				{reason === "external_email" && (
					<p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
						This sign-in is restricted to InternJobs Team members. Ask
						an operator to invite you.
					</p>
				)}

				<a
					href={CLERK_ACCOUNTS_URL}
					className="block w-full rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800 no-underline"
				>
					Continue with Clerk
				</a>

				<p className="mt-6 text-xs text-slate-500">
					Signed in but landed here? Your active workspace may be a
					different organization. Click the user menu in the Account
					Portal and switch to "InternJobs Team", then come back.
				</p>
			</div>
		</div>
	);
}
