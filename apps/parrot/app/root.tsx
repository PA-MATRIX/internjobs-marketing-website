// v1.2 Phase 10 Wave 2b: Parrot root layout.
//
// Auth UX: we use @clerk/clerk-react (pure client SDK) rather than
// @clerk/react-router. The React Router SDK requires a clerkMiddleware
// + rootAuthLoader chain that fights the Cloudflare Workers runtime
// (it leans on `process.env` and a React Router middleware feature
// we'd have to opt into). Our Worker middleware in workers/app.ts
// already verifies Clerk session JWTs server-side via jose — the only
// reason we mount Clerk on the client at all is to render the embedded
// <SignIn> form. ClerkProvider from @clerk/clerk-react needs nothing
// more than the publishable key.

import { ClerkProvider } from "@clerk/clerk-react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	type LoaderFunctionArgs,
} from "react-router";
import "./index.css";

// Server loader — hand the publishable key to the client. Publishable
// keys are safe to ship to the browser (that's their entire purpose).
export async function loader({ context }: LoaderFunctionArgs) {
	const env =
		(context as { cloudflare?: { env?: Record<string, string> } }).cloudflare
			?.env || {};
	return {
		clerkPublishableKey: env.PARROT_CLERK_PUBLISHABLE_KEY || "",
	};
}

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: false,
				retry: (failureCount) => failureCount < 2,
			},
		},
		mutationCache: new MutationCache({
			onError: (error) => console.error("Parrot mutation failed:", error),
		}),
	});
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
	if (typeof window === "undefined") return makeQueryClient();
	if (!browserQueryClient) browserQueryClient = makeQueryClient();
	return browserQueryClient;
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="UTF-8" />
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
				<link
					rel="icon"
					type="image/x-icon"
					href="/favicon.ico"
					sizes="48x48 32x32 16x16"
				/>
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>InternJobs.AI Parrot Workspace</title>
				<Meta />
				<Links />
			</head>
			<body className="bg-slate-50 text-slate-900 antialiased">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export function HydrateFallback() {
	return (
		<div className="flex items-center justify-center min-h-screen">
			<p className="text-sm text-slate-500">Loading Parrot…</p>
		</div>
	);
}

export default function App() {
	const [queryClient] = useState(getQueryClient);
	const data = useLoaderData<typeof loader>();
	const publishableKey = data?.clerkPublishableKey || "";

	// If the publishable key is somehow empty, render without ClerkProvider
	// so we don't blow up the whole shell. The SignIn page will show a
	// configuration error instead of the form.
	if (!publishableKey) {
		return (
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		);
	}

	return (
		<ClerkProvider
			publishableKey={publishableKey}
			signInUrl="/sign-in"
			signInFallbackRedirectUrl="/"
			afterSignInUrl="/"
			appearance={{
				elements: {
					// Hide the "Secured by Clerk" branding row.
					footer: { display: "none" },
				},
			}}
		>
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		</ClerkProvider>
	);
}

export function ErrorBoundary({ error }: { error: unknown }) {
	let title = "Something went wrong";
	let description = "An unexpected error occurred. Please try again.";
	let status: number | null = null;

	if (isRouteErrorResponse(error)) {
		status = error.status;
		if (error.status === 404) {
			title = "Page not found";
			description =
				"The page you're looking for doesn't exist or has been moved.";
		} else {
			title = `Error ${error.status}`;
			description = error.statusText || description;
		}
	} else if (error instanceof Error && import.meta.env.DEV) {
		description = error.message;
	}

	return (
		<div className="flex items-center justify-center min-h-screen p-8">
			<div className="max-w-md text-center">
				<h1 className="text-2xl font-semibold mb-2">
					{status === 404 ? "404 — Page not found" : title}
				</h1>
				<p className="text-slate-600 mb-6">{description}</p>
				<a
					href="/"
					className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
				>
					Go Home
				</a>
			</div>
		</div>
	);
}
