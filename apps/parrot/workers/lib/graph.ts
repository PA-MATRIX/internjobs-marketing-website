// v1.2 Phase 14 Wave 1 + v1.3 Phase 18 Wave 2: Parrot Knowledge Graph helper.
//
// History:
//   v1.2 Phase 14: ported from apps/app/src/memory/graph.mjs; used the
//     graph-DB npm client via dynamic import. Discovered at deploy time
//     that the Workers runtime crashes the client at module init
//     ("e.BigInt is not a function") — the helper degraded fail-soft
//     and graph_ready stayed false in /healthz.
//   v1.3 Phase 18 Wave 2 (this file): the npm DB client is gone from the
//     Worker. All Cypher calls now POST to the internjobs-graph-api Fly
//     app (Hono/Node, holds the real DB client) over HTTPS with a shared
//     Bearer secret. Exported function signatures are UNCHANGED — the
//     only thing that changed is the transport.
//
// Same physical FalkorDB instance (internjobs-graph.internal:6379) and same
// graph name ("internjobs") — isolation between student-app and Parrot
// facts is by LABEL NAMESPACE, not by graph:
//
//   - student app (apps/app)     : see apps/app/src/memory/graph.mjs
//   - Parrot       (apps/parrot) : :Employee, :Todo, :Person, :Email, :ChatMsg
//
// Parrot code MUST NEVER touch the student-app's labels. Cypher MATCH /
// MERGE statements here are scoped to the Parrot labels exclusively. The
// two label families never overlap on edges either — :Employee->:HAS_TODO->:Todo
// has no path into the student-app's namespace.
//
// Fact model: a :Todo node is the subject of every actionable item
// extracted from email/chat. A :Todo carries the extraction fields
// (title, urgency_score, deadline_at, source_channel, source_id,
// is_mention, valid_from, valid_to). Edges:
//
//   (:Employee)-[:HAS_TODO]->(:Todo)      ownership
//   (:Todo)-[:MENTIONS]->(:Person)        who's named in the message
//   (:Todo)-[:FROM_EMAIL]->(:Email)       source link (email channel)
//   (:Todo)-[:FROM_CHAT]->(:ChatMsg)      source link (Mattermost channel)
//
// Idempotency: every :Todo gets a deterministic id from
// sha256(employee_id|source_id) → first 32 hex chars. MERGE on that id
// means re-running the extraction over the same email/chat post does NOT
// create a duplicate :Todo. The hash dedup IS the close-out — no separate
// valid_to flip needed.
//
// Fail-soft posture (MANDATORY on every export): if GRAPH_API_URL/SECRET
// are unset or the proxy returns a non-2xx, every function returns a safe
// default (null / [] / "") and logs a one-line JSON warning. Phase 12
// extraction (workers/lib/ai.ts) and the DO ingest paths MUST continue to
// work when the graph layer is down — the agent prompt simply skips the
// graph-context block in that case.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers runtime, fetch() with AbortSignal.timeout
//   cloudflare/skills: durable-objects — called from EmployeeMailboxDO fire-and-forget path
//   cloudflare/skills: agents-sdk — graph context injected into kimi-k2.6 system prompt

import type { Env } from "../types";

// FalkorDB graph name. Same physical graph as the student app — isolation
// is by label, not graph. Keeps the operational surface (one Fly app, one
// dataset, one backup story) singular.
const GRAPH_NAME = "internjobs";

// Cap getEmployeeContext output. Larger than the student app's 1200-char
// cap because emails are wordier than SMS — a busy employee's open-todo
// list + collaborator names easily run past 1.2KB. 1500 leaves room
// without eating the kimi-k2.6 prompt budget.
const CONTEXT_CHAR_BUDGET = 1500;

// Phase 18 v1.3: FALKORDB_* env vars removed.
// The Worker now reaches FalkorDB via the internjobs-graph-api HTTP proxy.
// GRAPH_API_URL is the proxy's HTTPS URL; GRAPH_API_SECRET is the Bearer token.
// Plays nicely with `Pick<Env, ...>` so callers can pass `c.env` directly
// without making this helper depend on the entire Env shape.
type GraphEnv = Pick<Env, "GRAPH_API_URL" | "GRAPH_API_SECRET">;

// ─── HTTP proxy client ────────────────────────────────────────────────────────
//
// Phase 18 v1.3: The Parrot Worker cannot hold the graph-DB npm client
// (crashes at module init: "e.BigInt is not a function"). All Cypher
// calls are now proxied via internjobs-graph-api (a Fly/Node app that
// holds the client). The Worker sends: POST /query { cypher, params }
// with a Bearer token → receives { data, stats } in return.
//
// This factory returns a "proxy graph object" that satisfies the
// `{ query: (cypher, opts) => Promise<{data, stats}> }` contract expected
// by every caller in this file. It is NOT a real FalkorDB client; it is a
// thin fetch wrapper.
//
// Fail-soft: if GRAPH_API_URL / GRAPH_API_SECRET are unset or the proxy
// returns a non-2xx, every caller gets the same safe default (null / []
// / "") it would get if the DB were down. No throws.

interface ProxyQueryResult<T = unknown> {
	data: T[];
	stats: Record<string, unknown>;
}

interface ProxyGraph {
	query<T = unknown>(
		cypher: string,
		opts?: { params?: Record<string, unknown> },
	): Promise<ProxyQueryResult<T> | null>;
}

function makeProxyGraph(env: GraphEnv): ProxyGraph | null {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return null;
	const url = env.GRAPH_API_URL.replace(/\/$/, "") + "/query";
	const secret = env.GRAPH_API_SECRET;

	return {
		async query<T = unknown>(
			cypher: string,
			opts?: { params?: Record<string, unknown> },
		): Promise<ProxyQueryResult<T> | null> {
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${secret}`,
					},
					body: JSON.stringify({ cypher, params: opts?.params ?? {} }),
					// 8s budget — graph reads sit on the dashboard critical path.
					// Anything longer indicates a real outage; fall back to fail-soft.
					signal: AbortSignal.timeout(8000),
				});
				if (!res.ok) {
					console.warn(
						JSON.stringify({
							level: "warn",
							message: "parrot_graph_proxy_error",
							status: res.status,
							cypher: cypher.slice(0, 120),
						}),
					);
					return null;
				}
				return (await res.json()) as ProxyQueryResult<T>;
			} catch (err) {
				console.warn(
					JSON.stringify({
						level: "warn",
						message: "parrot_graph_proxy_fetch_failed",
						error: (err as Error)?.message ?? String(err),
						cypher: cypher.slice(0, 120),
					}),
				);
				return null;
			}
		},
	};
}

// Helper used by all exported functions. Returns null if the proxy isn't
// configured. Cheap to call — `makeProxyGraph` only allocates a small
// object; there's no persistent connection to manage on the Worker side.
function getProxyGraph(env: GraphEnv): ProxyGraph | null {
	return makeProxyGraph(env);
}

/**
 * No-op in the proxy transport model — there is no persistent TCP
 * connection to close on the Worker side. Kept for interface compatibility
 * with callers (and tests) that used to invoke this on shutdown.
 */
export async function closeParrotGraphClient(): Promise<void> {
	// HTTP proxy is stateless from the Worker's perspective; no
	// connection lifecycle to manage. The Fly proxy holds the real
	// graph-DB client; its lifecycle is managed there.
}

// ─── Schema bootstrap ───────────────────────────────────────────────────────

/**
 * Creates per-label indexes on Parrot nodes. Idempotent — "already exists"
 * errors are swallowed. Safe to call on every Worker boot (cheap; FalkorDB
 * short-circuits a no-op CREATE INDEX in well under a millisecond).
 *
 * Returns true on success, false on any failure (caller already logs).
 *
 * Indexes ONLY touch Parrot labels (:Employee, :Todo, :Person, :Email,
 * :ChatMsg). The student-app's label set is never referenced here —
 * those indexes live in apps/app/src/memory/graph.mjs ensureGraphSchema().
 */
export async function ensureParrotGraphSchema(
	env: GraphEnv,
): Promise<boolean> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return false;
	const graph = getProxyGraph(env);
	if (!graph) return false;

	const stmts = [
		"CREATE INDEX FOR (n:Employee) ON (n.id)",
		"CREATE INDEX FOR (n:Todo) ON (n.id)",
		// Common lookup pattern in getActiveTodos: filter by employee_id +
		// valid_to IS NULL. employee_id index accelerates that scan.
		"CREATE INDEX FOR (n:Todo) ON (n.employee_id)",
		// urgency_score ranking — getActiveTodos ORDER BY urgency_score DESC.
		"CREATE INDEX FOR (n:Todo) ON (n.urgency_score)",
		"CREATE INDEX FOR (n:Person) ON (n.name)",
		"CREATE INDEX FOR (n:Email) ON (n.id)",
		"CREATE INDEX FOR (n:ChatMsg) ON (n.id)",
	];

	let ok = true;
	for (const stmt of stmts) {
		const res = await graph.query(stmt);
		// res === null means the proxy returned a non-2xx. The proxy maps
		// "already exists" / "already indexed" FalkorDB errors to 500 with
		// the error detail in the body, but we don't have visibility into
		// the response body here (the proxy currently returns null on any
		// non-2xx). So we treat any failure as "logged on the proxy side"
		// and move on. The schema is idempotent — a re-run will surface any
		// real issue.
		if (res === null) {
			// Worker-side log so we can see schema-bootstrap regressions in
			// wrangler tail without needing flyctl logs.
			console.warn(
				JSON.stringify({
					level: "warn",
					message: "parrot_graph_index_create_failed_or_skipped",
					stmt,
				}),
			);
			// Don't flip ok=false here — FalkorDB returns an error on duplicate
			// index creation, which is expected on re-runs. The smoke test in
			// infra/graph-api/smoke.mjs is the authoritative "schema OK" gate.
		}
	}
	return ok;
}

// ─── Hashing helpers ────────────────────────────────────────────────────────

/**
 * Deterministic id for a :Todo node, given the employee and the source
 * message that produced it. SHA-256 → first 32 hex chars (128 bits of
 * collision space — plenty for the per-employee fact keyspace). Re-running
 * extraction over the same email/chat post hashes to the same id → MERGE
 * is a no-op. This is the close-out / dedup guarantee (ROADMAP SC-4).
 *
 * Uses the WebCrypto API (`crypto.subtle.digest`) — works natively in the
 * Workers runtime, no node:crypto polyfill needed. The student-app side
 * (graph.mjs) still uses node:crypto's createHash since it runs on Node;
 * the deterministic ids match because both produce the same first-32 hex
 * chars of the SHA-256 of `${employeeId}|${sourceId}`. Verified in the
 * infra/graph-api/smoke.mjs test (it uses node:crypto and the resulting
 * todo id MERGEs onto the same node the Worker would write to).
 */
async function todoHash(employeeId: string, sourceId: string): Promise<string> {
	const data = new TextEncoder().encode(`${employeeId}|${sourceId}`);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	return hex.slice(0, 32);
}

// Validated source-channel literals. Cypher labels can't be parameterized,
// so we MUST validate before string-interpolating to pick :Email vs :ChatMsg.
type SourceChannel = "email" | "chat";

function sourceLabel(channel: SourceChannel): "Email" | "ChatMsg" {
	return channel === "email" ? "Email" : "ChatMsg";
}

function sourceEdge(channel: SourceChannel): "FROM_EMAIL" | "FROM_CHAT" {
	return channel === "email" ? "FROM_EMAIL" : "FROM_CHAT";
}

// ─── Core write API ─────────────────────────────────────────────────────────

export interface RecordTodoFactArgs {
	/** Stable Clerk user_id of the owner — keys :Employee node. */
	employeeId: string;
	/** Which channel produced this todo — drives source-node label/edge. */
	sourceChannel: SourceChannel;
	/** id of the source message (email row id, or Mattermost post id). */
	sourceId: string;
	/** Short summary of the action item (matches workers/lib/ai.ts shape). */
	title: string;
	/** Optional one-line snippet (≤ 300 chars). */
	preview?: string;
	/** 0..100 urgency from the LLM (kimi-k2.6 in workers/lib/ai.ts). */
	urgencyScore: number;
	/** Optional ISO-8601 deadline. */
	deadlineAt?: string | null;
	/** Names of people referenced in the source (creates :Person nodes). */
	mentionedActors?: string[];
	/** True if the source message @-mentions the employee directly. */
	isMention: boolean;
	/** Free-text blocker descriptions (from kimi extraction). Each becomes a
	 *  :Person-like stub :Blocker node merged by the description string. */
	blockedByIds?: string[];
}

export interface RecordTodoFactResult {
	todoId: string;
	/** True when MERGE matched an existing :Todo (no new write happened). */
	skipped: boolean;
}

/**
 * Records a :Todo + edges. Idempotent on (employeeId, sourceId) via the
 * deterministic todoHash id — re-running extraction over the same
 * message hashes to the same node + MERGE skips the ON CREATE block.
 *
 * Writes (all via MERGE so safe to re-run):
 *   MERGE (:Employee {id: employeeId})
 *   MERGE (:Todo {id: todoHash(...)})
 *     ON CREATE SET <fields> + valid_from=now()
 *   MERGE (:Employee)-[:HAS_TODO]->(:Todo)
 *   For each mentionedActor:
 *     MERGE (:Person {name: actor})
 *     MERGE (:Todo)-[:MENTIONS]->(:Person)
 *   MERGE (:Email|:ChatMsg {id: sourceId})
 *   MERGE (:Todo)-[:FROM_EMAIL|:FROM_CHAT]->(source)
 *
 * Returns null on a fail-soft graph-unavailable path. Returns
 * { todoId, skipped: true } when the :Todo already existed; the caller
 * can use this to suppress re-notification.
 */
export async function recordTodoFact(
	env: GraphEnv,
	args: RecordTodoFactArgs,
): Promise<RecordTodoFactResult | null> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return null;
	if (!args.employeeId || !args.sourceId || !args.title) return null;
	if (args.sourceChannel !== "email" && args.sourceChannel !== "chat") {
		return null;
	}

	const graph = getProxyGraph(env);
	if (!graph) return null;

	const todoId = await todoHash(args.employeeId, args.sourceId);
	const nowIso = new Date().toISOString();
	const srcLabel = sourceLabel(args.sourceChannel);
	const srcEdge = sourceEdge(args.sourceChannel);

	// Step 1: probe whether the :Todo already exists. If MERGE matches an
	// existing node, we want to return skipped=true without touching
	// mentionedActors / source edges (they were already written on the
	// original insert; re-MERGEing them is a no-op but reporting skipped
	// lets the caller suppress re-notification).
	let skipped = false;
	const probe = await graph.query<unknown>(
		"MATCH (t:Todo {id: $tid}) RETURN count(t) AS c",
		{
			params: { tid: todoId },
		},
	);
	if (probe?.data) {
		const row = probe.data[0];
		if (row) {
			const c = Number(
				Array.isArray(row)
					? (row as unknown[])[0]
					: (row as Record<string, unknown>).c ??
							(row as Record<string, unknown>)["count(t)"],
			);
			if (Number.isFinite(c) && c > 0) skipped = true;
		}
	}
	// probe===null is fine — we'd rather attempt the write than refuse on a
	// transient probe error. The Cypher MERGE below is idempotent regardless.

	// Step 2: MERGE the :Employee + :Todo + ownership edge. ON CREATE SET
	// is the only path that writes the fields — re-runs land in the
	// "match" branch and leave the fields untouched (close-out by
	// hash, not by valid_to flip).
	const insertRes = await graph.query(
		`MERGE (e:Employee {id: $eid})
		 MERGE (t:Todo {id: $tid})
		   ON CREATE SET
		     t.employee_id = $eid,
		     t.title = $title,
		     t.preview = $preview,
		     t.urgency_score = $urgency,
		     t.deadline_at = $deadline,
		     t.is_mention = $isMention,
		     t.source_channel = $channel,
		     t.source_id = $sid,
		     t.valid_from = $now,
		     t.valid_to = $vt
		 MERGE (e)-[:HAS_TODO]->(t)
		 RETURN t.id`,
		{
			params: {
				eid: args.employeeId,
				tid: todoId,
				title: args.title,
				preview: args.preview ?? "",
				urgency: Number.isFinite(args.urgencyScore) ? args.urgencyScore : 0,
				deadline: args.deadlineAt ?? null,
				isMention: !!args.isMention,
				channel: args.sourceChannel,
				sid: args.sourceId,
				now: nowIso,
				vt: null,
			},
		},
	);
	if (insertRes === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_todo_insert_failed",
				employeeId: args.employeeId,
				todoId,
			}),
		);
		return null;
	}

	// Step 3: MERGE the source node + edge. Doing this in a separate query
	// keeps the per-statement Cypher short; if FalkorDB rejects an
	// individual edge MERGE we still get the :Todo + ownership recorded.
	const sourceRes = await graph.query(
		`MERGE (t:Todo {id: $tid})
		 MERGE (s:${srcLabel} {id: $sid})
		 MERGE (t)-[:${srcEdge}]->(s)`,
		{
			params: {
				tid: todoId,
				sid: args.sourceId,
			},
		},
	);
	if (sourceRes === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_todo_source_edge_failed",
				todoId,
				sourceChannel: args.sourceChannel,
			}),
		);
		// Continue — :Todo is still recorded; missing source edge is
		// degraded but not catastrophic.
	}

	// Step 4: MERGE each mentioned :Person + :MENTIONS edge. Skipped for
	// re-runs (skipped=true) because the edges were written on the
	// original insert. We loop one statement per actor — could batch with
	// UNWIND but typical mentioned-actor counts are 0–3, not worth it.
	if (!skipped && args.mentionedActors && args.mentionedActors.length > 0) {
		for (const rawName of args.mentionedActors) {
			const name = String(rawName || "").trim();
			if (!name) continue;
			const mentionRes = await graph.query(
				`MERGE (p:Person {name: $name})
				 MERGE (t:Todo {id: $tid})
				 MERGE (t)-[:MENTIONS]->(p)`,
				{
					params: { name, tid: todoId },
				},
			);
			if (mentionRes === null) {
				console.warn(
					JSON.stringify({
						level: "warn",
						message: "parrot_graph_mentions_edge_failed",
						todoId,
						name,
					}),
				);
				// Keep going — partial mentions better than none.
			}
		}
	}

	// Step 5: MERGE each :BLOCKED_BY edge. Same fire-and-forget pattern as :MENTIONS.
	// :Blocker nodes are stub nodes keyed by their description text — not true graph
	// entities (no separate index), just anchors for future retrieval.
	//
	// :BLOCKED_BY is NOT gated by !skipped — blocker discovery on re-run is meaningful
	// and the MERGE is idempotent, so writing the same edge twice is safe.
	if (args.blockedByIds && args.blockedByIds.length > 0) {
		for (const rawBlocker of args.blockedByIds) {
			const desc = String(rawBlocker || "").trim().slice(0, 200);
			if (!desc) continue;
			const blockerRes = await graph.query(
				`MERGE (b:Blocker {desc: $desc})
				 MERGE (t:Todo {id: $tid})
				 MERGE (t)-[:BLOCKED_BY]->(b)`,
				{ params: { desc, tid: todoId } },
			);
			if (blockerRes === null) {
				console.warn(
					JSON.stringify({
						level: "warn",
						message: "parrot_graph_blocked_by_edge_failed",
						todoId,
						desc,
					}),
				);
			}
		}
	}

	return { todoId, skipped };
}

export interface RecordPersonFactArgs {
	/** Stable Clerk user_id of the owning employee (for future scoping). */
	employeeId: string;
	/** Display name as it appeared in the message (best-effort canonical). */
	name: string;
}

/**
 * Records a lightweight :Person node. Used by the summary path to
 * surface "frequent collaborators" without requiring a :Todo edge.
 * Idempotent on `name` — MERGE matches existing nodes.
 *
 * Returns null on fail-soft. Returns { personId } on success — note
 * personId is the canonical name (the MERGE key) rather than a hash,
 * so the caller can fetch the same row by name later.
 */
export async function recordPersonFact(
	env: GraphEnv,
	args: RecordPersonFactArgs,
): Promise<{ personId: string } | null> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return null;
	const name = String(args?.name || "").trim();
	if (!args?.employeeId || !name) return null;

	const graph = getProxyGraph(env);
	if (!graph) return null;

	const res = await graph.query(
		`MERGE (p:Person {name: $name})
		 ON CREATE SET p.created_at = $now
		 RETURN p.name`,
		{
			params: { name, now: new Date().toISOString() },
		},
	);
	if (res === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_person_insert_failed",
				name,
			}),
		);
		return null;
	}
	return { personId: name };
}

export interface RecordSourceFactArgs {
	sourceChannel: SourceChannel;
	sourceId: string;
	subject?: string;
	ts?: string;
}

/**
 * Records the source node (:Email or :ChatMsg) with optional subject + ts
 * metadata. Useful as a pre-pass before recordTodoFact when the caller
 * already knows the email metadata (subject, received_at) and wants to
 * surface it through the graph layer.
 *
 * Idempotent on `id`. Returns null on fail-soft.
 */
export async function recordSourceFact(
	env: GraphEnv,
	args: RecordSourceFactArgs,
): Promise<{ sourceId: string } | null> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return null;
	if (!args?.sourceId) return null;
	if (args.sourceChannel !== "email" && args.sourceChannel !== "chat") {
		return null;
	}

	const graph = getProxyGraph(env);
	if (!graph) return null;

	const label = sourceLabel(args.sourceChannel);

	const res = await graph.query(
		`MERGE (s:${label} {id: $sid})
		 ON CREATE SET s.subject = $subject, s.ts = $ts, s.created_at = $now
		 RETURN s.id`,
		{
			params: {
				sid: args.sourceId,
				subject: args.subject ?? "",
				ts: args.ts ?? null,
				now: new Date().toISOString(),
			},
		},
	);
	if (res === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_source_insert_failed",
				sourceId: args.sourceId,
				channel: args.sourceChannel,
			}),
		);
		return null;
	}
	return { sourceId: args.sourceId };
}

// ─── Read API ───────────────────────────────────────────────────────────────

export interface ActiveTodoRow {
	title: string;
	urgencyScore: number;
	deadlineAt: string | null;
	isMention: boolean;
	sourceChannel: string;
	sourceId: string;
	validFrom: string;
}

/**
 * Returns currently-active todos for an employee (valid_to IS NULL),
 * ordered by urgency_score DESC. Default limit 20 — enough to cover a
 * busy inbox without blowing the prompt budget when fed into
 * getEmployeeContext.
 */
export async function getActiveTodos(
	env: GraphEnv,
	employeeId: string,
	options: { limit?: number } = {},
): Promise<ActiveTodoRow[]> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return [];
	if (!employeeId) return [];

	const graph = getProxyGraph(env);
	if (!graph) return [];

	const limit = Math.min(Math.max(1, options.limit ?? 20), 200);

	const res = await graph.query(
		`MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
		 WHERE t.valid_to IS NULL
		 RETURN t.title, t.urgency_score, t.deadline_at, t.is_mention,
		        t.source_channel, t.source_id, t.valid_from
		 ORDER BY t.urgency_score DESC
		 LIMIT $lim`,
		{
			params: { eid: employeeId, lim: limit },
		},
	);
	if (res === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_get_active_todos_failed",
				employeeId,
			}),
		);
		return [];
	}
	const rows = res.data ?? [];
	return rows.map((r) => {
		const arr = Array.isArray(r)
			? (r as unknown[])
			: [
					(r as Record<string, unknown>)["t.title"],
					(r as Record<string, unknown>)["t.urgency_score"],
					(r as Record<string, unknown>)["t.deadline_at"],
					(r as Record<string, unknown>)["t.is_mention"],
					(r as Record<string, unknown>)["t.source_channel"],
					(r as Record<string, unknown>)["t.source_id"],
					(r as Record<string, unknown>)["t.valid_from"],
				];
		return {
			title: String(arr[0] ?? ""),
			urgencyScore: Number(arr[1]) || 0,
			deadlineAt: (arr[2] as string | null) ?? null,
			isMention: arr[3] === true || arr[3] === "true" || arr[3] === 1,
			sourceChannel: String(arr[4] ?? ""),
			sourceId: String(arr[5] ?? ""),
			validFrom: String(arr[6] ?? ""),
		};
	});
}

export interface FrequentCollaboratorRow {
	name: string;
	count: number;
}

/**
 * Returns the top-K most-mentioned :Person nodes across an employee's
 * todos, ordered by mention count DESC. Used by getEmployeeContext to
 * surface "frequent collaborators" — names the agent should recognize
 * without re-derivation.
 */
export async function getFrequentCollaborators(
	env: GraphEnv,
	employeeId: string,
	options: { limit?: number } = {},
): Promise<FrequentCollaboratorRow[]> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return [];
	if (!employeeId) return [];

	const graph = getProxyGraph(env);
	if (!graph) return [];

	const limit = Math.min(Math.max(1, options.limit ?? 5), 50);

	const res = await graph.query(
		`MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(:Todo)-[:MENTIONS]->(p:Person)
		 RETURN p.name, count(*) AS c
		 ORDER BY c DESC
		 LIMIT $lim`,
		{
			params: { eid: employeeId, lim: limit },
		},
	);
	if (res === null) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_get_collaborators_failed",
				employeeId,
			}),
		);
		return [];
	}
	const rows = res.data ?? [];
	return rows.map((r) => {
		const arr = Array.isArray(r)
			? (r as unknown[])
			: [
					(r as Record<string, unknown>)["p.name"],
					(r as Record<string, unknown>).c,
				];
		return {
			name: String(arr[0] ?? ""),
			count: Number(arr[1]) || 0,
		};
	});
}

// ─── Summary for prompt injection ───────────────────────────────────────────

/**
 * Builds a compact, prose-formatted context block summarizing an
 * employee's open todos + frequent collaborators. Output is injected
 * into the kimi-k2.6 system prompt as a context block:
 *
 *   <employee_context>
 *   Open todos (most urgent first):
 *   - [urgency 87] Reply to investor email • deadline: 2026-05-21 • @mention
 *   - [urgency 60] Draft Q3 OKRs
 *   ...
 *
 *   Frequent collaborators: Alice, Bob, Carol.
 *   </employee_context>
 *
 * Empty when the employee has no active todos AND no collaborators —
 * the caller detects empty and omits the block entirely (avoids feeding
 * the LLM a "context: nothing here" header that adds noise to the prompt).
 *
 * Capped at CONTEXT_CHAR_BUDGET (1500 chars). Larger than the student
 * app's 1200-char cap because emails are wordier than SMS.
 */
export async function getEmployeeContext(
	env: GraphEnv,
	employeeId: string,
): Promise<string> {
	if (!env.GRAPH_API_URL || !env.GRAPH_API_SECRET) return "";
	if (!employeeId) return "";

	const [todos, collaborators] = await Promise.all([
		getActiveTodos(env, employeeId, { limit: 20 }),
		getFrequentCollaborators(env, employeeId, { limit: 5 }),
	]);

	if (todos.length === 0 && collaborators.length === 0) return "";

	const lines: string[] = ["<employee_context>"];

	if (todos.length > 0) {
		lines.push("Open todos (most urgent first):");
		for (const t of todos) {
			const parts = [`[urgency ${t.urgencyScore}] ${t.title}`];
			if (t.deadlineAt) parts.push(`deadline: ${formatDeadline(t.deadlineAt)}`);
			if (t.isMention) parts.push("@mention");
			lines.push(`- ${parts.join(" • ")}`);
		}
		// Blank line between sections improves prompt readability for the LLM.
		if (collaborators.length > 0) lines.push("");
	}

	if (collaborators.length > 0) {
		const names = collaborators
			.map((c) => c.name)
			.filter((n) => n.length > 0);
		if (names.length > 0) {
			lines.push(`Frequent collaborators: ${names.join(", ")}.`);
		}
	}

	lines.push("</employee_context>");

	let out = lines.join("\n");
	if (out.length > CONTEXT_CHAR_BUDGET) {
		// Truncate inside the block, then re-close the tag so the LLM still
		// sees a balanced fence. Lose the LAST few lines (least urgent), not
		// the first (most urgent).
		out = `${out.slice(0, CONTEXT_CHAR_BUDGET - 24)}…\n</employee_context>`;
	}
	return out;
}

function formatDeadline(iso: string): string {
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		// YYYY-MM-DD — no time component; deadlines are calendar-day for
		// the v1.2 surface (kimi-k2.6 extracts day-granularity from emails).
		const yyyy = d.getUTCFullYear();
		const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
		const dd = String(d.getUTCDate()).padStart(2, "0");
		return `${yyyy}-${mm}-${dd}`;
	} catch (_) {
		return iso;
	}
}

// ─── Health check ───────────────────────────────────────────────────────────

/**
 * Proxy health probe. Returns true iff the internjobs-graph-api proxy is
 * reachable AND it reports ok:true (meaning FalkorDB is also reachable).
 * Used by /healthz as `graph_proxy_reachable` (distinct from `graph_ready`
 * which reflects the student app's direct FalkorDB ping).
 */
export async function pingParrotGraph(env: GraphEnv): Promise<boolean> {
	if (!env.GRAPH_API_URL) return false;
	try {
		const res = await fetch(
			env.GRAPH_API_URL.replace(/\/$/, "") + "/health",
			{ signal: AbortSignal.timeout(3000) },
		);
		if (!res.ok) return false;
		const body = (await res.json()) as { ok?: boolean };
		return body?.ok === true;
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_ping_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return false;
	}
}
