// apps/startup/workers/tools/search.ts
// v1.4 Phase 28 STARTUP-MCP-05 — search() tool handler (full implementation).
//
// Scope routing:
//   candidates — pgvector cosine similarity via /v1/search/candidates (28-01)
//   roles      — SQL ILIKE on title/description via /v1/search/roles
//   threads    — SQL on inbound_messages JOIN students via /v1/search/threads
//   messages   — SQL ILIKE on outbound_messages via /v1/search/messages
//   members    — SQL on startup_members via /v1/search/members
//   startups   — SQL on startups (own record only) via /v1/search/startups
//
// Result envelope (stable across all scopes):
//   { scope, query, results: [{id, summary, score, ...}], total_returned,
//     next_cursor: null }
//
// SECURITY: every scope POST sends startup_id from the auth context to the
// Fly proxy, and every /v1/search/:scope SQL on the proxy adds a WHERE
// startup_id = $auth (the `startups` scope hardcodes `id = $startup_id`).
// Cross-startup data leaks are impossible — no scope runs an unconstrained
// query, and `startup_id` is never user-supplied.

import type { Env } from "../types";
import { embedText } from "../lib/embed";

export type SearchScope =
	| "roles"
	| "candidates"
	| "threads"
	| "messages"
	| "members"
	| "startups";

export interface SearchArgs {
	startup_id: string;
	scope: SearchScope;
	query: string;
	filters?: Record<string, unknown>;
	limit?: number;
	env: Env;
}

interface SearchHit {
	id: string;
	summary: string;
	score: number;
	[k: string]: unknown;
}

export interface SearchResult {
	scope: SearchScope;
	query: string;
	results: SearchHit[];
	total_returned: number;
	next_cursor: null;
}

async function proxyPost(
	url: string,
	secret: string,
	body: unknown,
): Promise<unknown> {
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_search_proxy_non_ok",
				status: res.status,
				url,
				detail: detail.slice(0, 200),
			}),
		);
		return null;
	}
	return res.json().catch(() => null);
}

async function searchCandidates(args: SearchArgs): Promise<SearchHit[]> {
	// Semantic search via pgvector — embed the query then call startup-api.
	const embedding = await embedText(args.query, args.env);
	if (!embedding) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_search_no_embedding",
				scope: "candidates",
				query_preview: args.query.slice(0, 60),
			}),
		);
		return [];
	}
	const base = args.env.STARTUP_API_URL.replace(/\/$/, "");
	const limit = Math.min(Math.max(1, args.limit ?? 10), 20);
	const result = (await proxyPost(
		`${base}/v1/search/candidates`,
		args.env.STARTUP_API_SECRET,
		{
			startup_id: args.startup_id,
			embedding,
			filters: {
				role_id: (args.filters?.role_id as string | undefined) ?? null,
				status: (args.filters?.status as string | undefined) ?? null,
			},
			limit,
		},
	)) as { results?: SearchHit[] } | null;
	return result?.results ?? [];
}

async function searchStructured(
	scope: Exclude<SearchScope, "candidates">,
	args: SearchArgs,
): Promise<SearchHit[]> {
	const base = args.env.STARTUP_API_URL.replace(/\/$/, "");
	const limit = Math.min(Math.max(1, args.limit ?? 10), 20);
	const result = (await proxyPost(
		`${base}/v1/search/${scope}`,
		args.env.STARTUP_API_SECRET,
		{
			startup_id: args.startup_id,
			query: args.query,
			filters: args.filters ?? {},
			limit,
		},
	)) as { results?: SearchHit[] } | null;
	return result?.results ?? [];
}

export async function handleSearch(args: SearchArgs): Promise<SearchResult> {
	let results: SearchHit[] = [];

	try {
		if (args.scope === "candidates") {
			results = await searchCandidates(args);
		} else {
			results = await searchStructured(args.scope, args);
		}
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_search_failed",
				scope: args.scope,
				error: (err as Error)?.message ?? String(err),
			}),
		);
	}

	return {
		scope: args.scope,
		query: args.query,
		results,
		total_returned: results.length,
		next_cursor: null,
	};
}
