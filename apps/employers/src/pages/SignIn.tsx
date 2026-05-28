import { SignIn as ClerkSignIn } from "@clerk/clerk-react";

// Sign-in landing page. Clerk's <SignIn /> widget handles both sign-in and
// sign-up flows in a single component (path-routed). After auth, Clerk
// redirects to /dashboard via the afterSignInUrl prop.
//
// Brand surface notes (BRAND-V1):
//   - lavender bg-anchor (no other bg color competes with the page surface)
//   - ink text, lowercase voice
//   - cobalt accent on the dot of "internjobs.ai" via the .accent-dot class
//   - no hex literals in jsx — color values resolve via tailwind tokens
export function SignIn() {
  return (
    <main className="min-h-screen bg-lavender flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col items-center">
        <p className="text-label uppercase tracking-widest text-ink/60 mb-2">
          internjobs<span className="accent-dot">.</span>ai
        </p>
        <h1 className="text-h1 font-extrabold lowercase text-ink mb-1 text-center">
          startups portal
        </h1>
        <p className="text-sm text-ink/70 mb-8 text-center lowercase">
          post a role, meet candidates, hire the right one.
        </p>

        <ClerkSignIn
          routing="path"
          path="/"
          signUpUrl="/"
          afterSignInUrl="/dashboard"
          afterSignUpUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none bg-cream rounded-card",
            },
          }}
        />

        <p className="text-xs text-ink/50 mt-6 lowercase text-center">
          founders only. use your work email — personal addresses are blocked.
        </p>
      </div>
    </main>
  );
}
