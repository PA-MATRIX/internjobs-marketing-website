// v1.2 Phase 10 Wave 1: Parrot client-side Clerk helpers.
//
// Wave 1 ships a deliberately thin auth surface — the worker
// middleware does the heavy lifting, and the React UI only needs to
// know "am I signed in?" (which we infer from /api/me). When we add
// the Clerk React provider (later in this wave or Wave 2 polish),
// these helpers will grow to wrap useUser / useAuth.

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";

export function useCurrentEmployee() {
	return useQuery({
		queryKey: ["parrot", "me"],
		queryFn: () => api.getMe(),
		retry: (failureCount, err) => {
			if (err instanceof ApiError && err.status === 401) return false;
			return failureCount < 1;
		},
		staleTime: 60_000,
	});
}

/** Redirect to the Clerk-hosted sign-in page (or the local /sign-in stub). */
export function goToSignIn() {
	if (typeof window !== "undefined") {
		window.location.href = "/sign-in";
	}
}
