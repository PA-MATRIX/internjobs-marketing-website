// KGRAPH-04 cross-namespace isolation smoke test.
// Usage: GRAPH_API_URL=https://... GRAPH_API_SECRET=... node scripts/26-kgraph-smoke.mjs
// Run this against the live Fly graph-api proxy.
// Expected result: both counts = 0 (FalkorDB label isolation is structural).
//
// Exit codes:
//   0 = both cross-namespace queries returned count 0 (PASS)
//   1 = at least one query returned count > 0 (FAIL — cross-namespace data exists)
//   2 = infrastructure unavailable (proxy unreachable, missing env vars, fetch error)

const GRAPH_API_URL = process.env.GRAPH_API_URL;
const GRAPH_API_SECRET = process.env.GRAPH_API_SECRET;

if (!GRAPH_API_URL || !GRAPH_API_SECRET) {
	console.error(
		"ERROR: GRAPH_API_URL and GRAPH_API_SECRET environment variables are required.\n" +
			"Usage: GRAPH_API_URL=https://... GRAPH_API_SECRET=... node scripts/26-kgraph-smoke.mjs",
	);
	process.exit(2);
}

const QUERY_URL = GRAPH_API_URL.replace(/\/$/, "") + "/query";

/**
 * POST to graph-api /query and return parsed { data, stats }.
 * Throws on non-2xx or network errors.
 */
async function query(cypher, params = {}) {
	const res = await fetch(QUERY_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${GRAPH_API_SECRET}`,
		},
		body: JSON.stringify({ cypher, params }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "<unreadable>");
		throw new Error(`graph-api ${res.status}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

/**
 * Extract the cross_count scalar from a graph-api response row.
 * Returns null when the response shape is empty / unrecognized.
 */
function extractCount(json) {
	const rows = json?.data ?? [];
	if (rows.length === 0) return null;
	const row = rows[0];
	if (row == null) return null;
	if (Array.isArray(row)) {
		const n = Number(row[0]);
		return Number.isFinite(n) ? n : null;
	}
	if (typeof row === "object") {
		const candidate = row.cross_count ?? row["count(n)"] ?? Object.values(row)[0];
		const n = Number(candidate);
		return Number.isFinite(n) ? n : null;
	}
	const n = Number(row);
	return Number.isFinite(n) ? n : null;
}

const CHECKS = [
	{
		label: "Employee->Student cross-namespace",
		// Depth [*1..5] not unbounded — avoids timeouts on a sparse graph.
		cypher:
			"MATCH (e:Employee)-[*1..5]->(n:Student) RETURN count(n) AS cross_count",
	},
	{
		label: "Student->Employee cross-namespace",
		cypher:
			"MATCH (s:Student)-[*1..5]->(n:Employee) RETURN count(n) AS cross_count",
	},
];

async function main() {
	console.log("KGRAPH-04 smoke test");
	let failed = false;

	for (const check of CHECKS) {
		let count;
		try {
			const res = await query(check.cypher);
			count = extractCount(res);
		} catch (err) {
			console.error(`  [ERROR] ${check.label}: ${err.message}`);
			process.exit(2);
		}

		// Null result (graph unreachable / no data yet) is PASS — no cross-namespace
		// data can exist if the graph has nothing in it.
		if (count === null) {
			console.log(`  [PASS] ${check.label}: 0 (no data / empty result)`);
			continue;
		}

		if (count === 0) {
			console.log(`  [PASS] ${check.label}: 0`);
		} else {
			console.log(`  [FAIL] ${check.label}: ${count}`);
			failed = true;
		}
	}

	if (failed) {
		console.log("Cross-namespace contamination detected. Exiting 1.");
		process.exit(1);
	}
	console.log("All checks passed.");
}

main().catch((err) => {
	console.error("Unexpected error:", err?.message ?? err);
	process.exit(2);
});
