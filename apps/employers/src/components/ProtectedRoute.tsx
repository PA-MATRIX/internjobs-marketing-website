import {
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from "@clerk/clerk-react";

// Gates a route behind a Clerk session. Unauthenticated visitors get
// redirected to "/" (the sign-in landing). Authenticated visitors see the
// wrapped children. The redirect is handled by Clerk's RedirectToSignIn
// component which respects Clerk's `signInUrl` env config — no manual
// router push needed.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
