// v1.2 Phase 14 Wave 1: Parrot Knowledge Graph helper (FalkorDB).
//
// TypeScript port of apps/app/src/memory/graph.mjs adapted for the Parrot
// Worker context. Same physical FalkorDB instance (internjobs-graph.internal
// :6379) and same graph name ("internjobs") — isolation between student-app
// and Parrot facts is by LABEL NAMESPACE, not by graph:
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
// Fail-soft posture (MANDATORY on every export): if FALKORDB_URL is unset
// or the connection fails, every function returns a safe default
// (null / [] / "") and logs a one-line JSON warning. Phase 12 extraction
// (workers/lib/ai.ts) and the DO ingest paths MUST continue to work when
// the graph DB is down — the agent prompt simply skips the graph-context
// block in that case.
//
// Worker singleton: unlike graph.mjs (Node process singleton), Workers
// can be evicted between requests. The _clients Map is keyed by
// FALKORDB_URL and survives only the current isolate's lifetime; cold
// starts pay one connect per isolate, but warm isolates reuse the client
// across requests for the lifetime of that isolate.
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers runtime, nodejs_compat (node:crypto)
//   cloudflare/skills: durable-objects — called from EmployeeMailboxDO fire-and-forget path
//   cloudflare/skills: agents-sdk — graph context injected into kimi-k2.6 system prompt

import { createHash } from "node:crypto";
import { FalkorDB } from "falkordb";
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

// Subset of Env we actually consume. Plays nicely with `Pick<Env, ...>`
// so callers can pass `c.env` directly without making this helper
// dependent on the entire Env shape (Phase 13 added KV bindings, Phase 11
// added Daily.co — none of which the graph helper needs).
type GraphEnv = Pick<Env, "FALKORDB_URL" | "FALKORDB_PASSWORD">;

// ─── Connection ─────────────────────────────────────────────────────────────

// Module-level client cache. Keyed by FALKORDB_URL so a single isolate
// serving multiple Workers (in theory; we only have one Worker today)
// doesn't collide. Map-of-promises pattern de-dupes concurrent first-call
// connects (request burst at cold start → one connect, all waiters
// resolve to the same client).
const _clients = new Map<string, FalkorDB>();
const _pending = new Map<string, Promise<FalkorDB | null>>();
let _connectFailedLogged = false;

/**
 * Lazily returns a connected FalkorDB client, or null if FALKORDB_URL is
 * unset or the connection failed. Never throws. Safe to call from any
 * code path including the hot request path.
 */
export async function getGraphClient(
	env: GraphEnv,
): Promise<FalkorDB | null> {
	const url = env.FALKORDB_URL;
	if (!url) return null;

	const cached = _clients.get(url);
	if (cached) return cached;

	const pending = _pending.get(url);
	if (pending) return pending;

	// The falkordb npm client accepts redis[s]:// or falkor[s]:// URLs.
	// Our Infisical-stored value is `redis://default:<pw>@internjobs-graph
	// .internal:6379` which works directly (auth flows through the URL
	// password component).
	const p = FalkorDB.connect({ url })
		.then((client) => {
			_clients.set(url, client);
			_pending.delete(url);
			_connectFailedLogged = false;
			// Wire an error handler so a runtime disconnect doesn't crash the
			// isolate (default EventEmitter behavior on unhandled 'error' is to
			// throw). Log once + clear the cache so the next call retries.
			const c = client as unknown as {
				on?: (evt: string, handler: (err: unknown) => void) => void;
			};
			c.on?.("error", (err: unknown) => {
				const msg = (err as Error | null)?.message ?? String(err);
				if (!_connectFailedLogged) {
					console.warn(
						JSON.stringify({
							level: "warn",
							message: "parrot_graph_client_runtime_error",
							error: msg,
						}),
					);
					_connectFailedLogged = true;
				}
				_clients.delete(url);
			});
			return client;
		})
		.catch((err: unknown) => {
			const msg = (err as Error | null)?.message ?? String(err);
			if (!_connectFailedLogged) {
				console.warn(
					JSON.stringify({
						level: "warn",
						message: "parrot_graph_client_connect_failed",
						error: msg,
					}),
				);
				_connectFailedLogged = true;
			}
			_pending.delete(url);
			return null;
		});

	_pending.set(url, p);
	return p;
}

/**
 * Closes all cached clients. Intended for tests + clean shutdown.
 */
export async function closeParrotGraphClient(): Promise<void> {
	const clients = [..._clients.values()];
	_clients.clear();
	_pending.clear();
	_connectFailedLogged = false;
	for (const c of clients) {
		const closer = c as unknown as { close?: () => Promise<void> };
		if (typeof closer.close === "function") {
			try {
				await closer.close();
			} catch (_) {
				// Best-effort close; swallow.
			}
		}
	}
}

function getGraph(client: FalkorDB) {
	return client.selectGraph(GRAPH_NAME);
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
	if (!env.FALKORDB_URL) return false;
	const client = await getGraphClient(env);
	if (!client) return false;
	const graph = getGraph(client);

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
		try {
			await graph.query(stmt);
		} catch (err) {
			const msg = ((err as Error | null)?.message || "").toLowerCase();
			if (msg.includes("already indexed") || msg.includes("already exists")) {
				continue;
			}
			console.warn(
				JSON.stringify({
					level: "warn",
					message: "parrot_graph_index_create_failed",
					stmt,
					error: (err as Error | null)?.message ?? String(err),
				}),
			);
			ok = false;
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
 */
function todoHash(employeeId: string, sourceId: string): string {
	return createHash("sha256")
		.update(`${employeeId}|${sourceId}`)
		.digest("hex")
		.slice(0, 32);
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
	if (!env.FALKORDB_URL) return null;
	if (!args.employeeId || !args.sourceId || !args.title) return null;
	if (args.sourceChannel !== "email" && args.sourceChannel !== "chat") {
		return null;
	}

	const client = await getGraphClient(env);
	if (!client) return null;
	const graph = getGraph(client);

	const todoId = todoHash(args.employeeId, args.sourceId);
	const nowIso = new Date().toISOString();
	const srcLabel = sourceLabel(args.sourceChannel);
	const srcEdge = sourceEdge(args.sourceChannel);

	// Step 1: probe whether the :Todo already exists. If MERGE matches an
	// existing node, we want to return skipped=true without touching
	// mentionedActors / source edges (they were already written on the
	// original insert; re-MERGEing them is a no-op but reporting skipped
	// lets the caller suppress re-notification).
	let skipped = false;
	try {
		const probe = await graph.query<{ "count(t)": number }>(
			"MATCH (t:Todo {id: $tid}) RETURN count(t) AS c",
			{
				params: { tid: todoId },
			},
		);
		const row = probe?.data?.[0];
		if (row) {
			const c = Number(
				Array.isArray(row)
					? (row as unknown[])[0]
					: (row as Record<string, unknown>).c ??
							(row as Record<string, unknown>)["count(t)"],
			);
			if (Number.isFinite(c) && c > 0) skipped = true;
		}
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_todo_probe_failed",
				todoId,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		// Fall through — we'd rather attempt the write than refuse on a
		// transient probe error.
	}

	// Step 2: MERGE the :Employee + :Todo + ownership edge. ON CREATE SET
	// is the only path that writes the fields — re-runs land in the
	// "match" branch and leave the fields untouched (close-out by
	// hash, not by valid_to flip).
	try {
		await graph.query(
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
					urgency: Number.isFinite(args.urgencyScore)
						? args.urgencyScore
						: 0,
					deadline: args.deadlineAt ?? null,
					isMention: !!args.isMention,
					channel: args.sourceChannel,
					sid: args.sourceId,
					now: nowIso,
					vt: null,
				},
			},
		);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_todo_insert_failed",
				employeeId: args.employeeId,
				todoId,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return null;
	}

	// Step 3: MERGE the source node + edge. Doing this in a separate query
	// keeps the per-statement Cypher short; if FalkorDB rejects an
	// individual edge MERGE we still get the :Todo + ownership recorded.
	try {
		await graph.query(
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
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_todo_source_edge_failed",
				todoId,
				sourceChannel: args.sourceChannel,
				error: (err as Error | null)?.message ?? String(err),
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
			try {
				await graph.query(
					`MERGE (p:Person {name: $name})
					 MERGE (t:Todo {id: $tid})
					 MERGE (t)-[:MENTIONS]->(p)`,
					{
						params: { name, tid: todoId },
					},
				);
			} catch (err) {
				console.warn(
					JSON.stringify({
						level: "warn",
						message: "parrot_graph_mentions_edge_failed",
						todoId,
						name,
						error: (err as Error | null)?.message ?? String(err),
					}),
				);
				// Keep going — partial mentions better than none.
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
	if (!env.FALKORDB_URL) return null;
	const name = String(args?.name || "").trim();
	if (!args?.employeeId || !name) return null;

	const client = await getGraphClient(env);
	if (!client) return null;
	const graph = getGraph(client);

	try {
		await graph.query(
			`MERGE (p:Person {name: $name})
			 ON CREATE SET p.created_at = $now
			 RETURN p.name`,
			{
				params: { name, now: new Date().toISOString() },
			},
		);
		return { personId: name };
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_person_insert_failed",
				name,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return null;
	}
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
	if (!env.FALKORDB_URL) return null;
	if (!args?.sourceId) return null;
	if (args.sourceChannel !== "email" && args.sourceChannel !== "chat") {
		return null;
	}

	const client = await getGraphClient(env);
	if (!client) return null;
	const graph = getGraph(client);

	const label = sourceLabel(args.sourceChannel);

	try {
		await graph.query(
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
		return { sourceId: args.sourceId };
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_source_insert_failed",
				sourceId: args.sourceId,
				channel: args.sourceChannel,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return null;
	}
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
	if (!env.FALKORDB_URL) return [];
	if (!employeeId) return [];

	const client = await getGraphClient(env);
	if (!client) return [];
	const graph = getGraph(client);

	const limit = Math.min(Math.max(1, options.limit ?? 20), 200);

	try {
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
		const rows = (res?.data ?? []) as unknown[];
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
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_get_active_todos_failed",
				employeeId,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return [];
	}
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
	if (!env.FALKORDB_URL) return [];
	if (!employeeId) return [];

	const client = await getGraphClient(env);
	if (!client) return [];
	const graph = getGraph(client);

	const limit = Math.min(Math.max(1, options.limit ?? 5), 50);

	try {
		const res = await graph.query(
			`MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(:Todo)-[:MENTIONS]->(p:Person)
			 RETURN p.name, count(*) AS c
			 ORDER BY c DESC
			 LIMIT $lim`,
			{
				params: { eid: employeeId, lim: limit },
			},
		);
		const rows = (res?.data ?? []) as unknown[];
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
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_get_collaborators_failed",
				employeeId,
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return [];
	}
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
	if (!env.FALKORDB_URL) return "";
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
 * Cheap PING-style readiness probe. Returns true iff a client can be
 * obtained AND a trivial RETURN 1 query round-trips successfully. Never
 * throws. Used by /healthz once Wave 2 wires it in.
 */
export async function pingParrotGraph(env: GraphEnv): Promise<boolean> {
	if (!env.FALKORDB_URL) return false;
	const client = await getGraphClient(env);
	if (!client) return false;
	try {
		const res = await getGraph(client).query("RETURN 1");
		return Boolean(res);
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				message: "parrot_graph_ping_failed",
				error: (err as Error | null)?.message ?? String(err),
			}),
		);
		return false;
	}
}
