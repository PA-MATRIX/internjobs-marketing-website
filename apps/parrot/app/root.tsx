// v1.2 Phase 10 Wave 1: Parrot root layout.
//
// Simpler than apps/agentic-inbox/app/root.tsx — Parrot doesn't (yet)
// depend on Cloudflare's Kumo design system. We bring in React Query
// because the InboxPane will use it once we port the agentic-inbox
// queries.

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";
import "./index.css";

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
				<title>Parrot — InternJobs Workspace</title>
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
	return (
		<QueryClientProvider client={queryClient}>
			<Outlet />
		</QueryClientProvider>
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
