// v1.2 Phase 10 Wave 2b: /sign-in — embedded Clerk SignIn form,
// email-OTP only.
//
// Why embedded here instead of redirecting to accounts.internjobs.ai:
//   The student-facing Clerk Account Portal at accounts.internjobs.ai
//   is configured for LinkedIn-only sign-in (matching the public site's
//   onboarding). Employees need email OTP. Both flows live on the same
//   Clerk app (single user pool, Organizations gates Parrot access),
//   so the split is at the FRONTEND, not the auth layer.
//
//     workspace.internjobs.ai → this file → email OTP
//     app.internjobs.ai        → apps/app   → LinkedIn
//
// Routing-by-subdomain happens automatically because each subdomain
// resolves to a different Worker app.

import { SignIn } from "@clerk/react-router";
import { useSearchParams } from "react-router";

export default function LoginRoute() {
	const [params] = useSearchParams();
	const reason = params.get("reason");

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
			<div className="w-full max-w-md">
				<div className="mb-6 text-center">
					<h1 className="text-xl font-semibold text-slate-900">
						Parrot Workspace
					</h1>
					<p className="text-sm text-slate-600 mt-1">
						Sign in with your @internjobs.ai email
					</p>
				</div>

				{reason && (
					<p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
						{reason === "external_email"
							? "Parrot is for InternJobs Team members. Ask an operator to invite you."
							: "Please sign in to continue."}
					</p>
				)}

				<SignIn
					routing="path"
					path="/sign-in"
					signUpUrl="/sign-in"
					forceRedirectUrl="/"
					appearance={{
						elements: {
							// Hide the social-sign-in buttons (LinkedIn etc.) so
							// only the email-OTP path remains. Hide the divider
							// that sits between socials and email too.
							socialButtons: { display: "none" },
							socialButtonsBlockButton: { display: "none" },
							dividerRow: { display: "none" },
							// Hide the "Don't have an account? Sign up" link —
							// employees are invited, not self-signup.
							footerAction: { display: "none" },
							footerActionLink: { display: "none" },
							footer: { display: "none" },
						},
						layout: {
							socialButtonsPlacement: "bottom",
							socialButtonsVariant: "blockButton",
						},
					}}
				/>
			</div>
		</div>
	);
}
