// apps/startup/workers/tools/search.ts
// v1.4 Phase 28 STARTUP-MCP-05 — search() tool handler (PLACEHOLDER STUB).
//
// Plan 28-03 fills this with the actual pgvector + SQL search via
// POST /v1/search/candidates on the 28-01 Fly proxy.
//
// Contract (returned shape is stable):
//   {
//     scope, query, results: [], total_returned: 0, next_cursor: null,
//     ok: true, placeholder: true
//   }

export interface SearchArgs {
	startup_id: string;
	scope: "roles" | "candidates" | "threads" | "messages" | "members" | "startups";
	query: string;
	filters?: Record<string, unknown>;
	limit?: number;
}

export interface SearchResult {
	ok: true;
	placeholder: true;
	scope: SearchArgs["scope"];
	query: string;
	results: never[];
	total_returned: 0;
	next_cursor: null;
	_note: string;
}

export async function handleSearch(args: SearchArgs): Promise<SearchResult> {
	return {
		ok: true,
		placeholder: true,
		scope: args.scope,
		query: args.query,
		results: [],
		total_returned: 0,
		next_cursor: null,
		_note: "search implementation lands in Plan 28-03",
	};
}
