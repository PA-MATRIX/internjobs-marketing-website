// apps/startup/workers/lib/embed.ts
// v1.4 Phase 28 STARTUP-MCP-07 — Text embedding helper.
//
// COMPUTE INDEPENDENCE (locked Phase 28 decision): the startup Worker MUST NOT
// call the student app's /internal/* endpoints at runtime. If the student app
// is under SMS load, search('candidates') must not degrade.
//
// Solution: use the Workers AI binding directly via env.AI.run().
// The "ai" binding is declared in apps/startup/wrangler.jsonc (no extra cost,
// CF bills per-neuron, not per-binding).
//
// Model: @cf/baai/bge-base-en-v1.5 — 768-dim vectors, same model as the
// student profile embeddings and role embeddings stored in the DB (locked by
// migration 0005). Switching models requires a coordinated migration.
//
// Fail-soft: returns null if AI binding unavailable; caller (execute.ts
// handlePostRole + search.ts searchCandidates) skips the pgvector step
// gracefully. Better to ship a non-embedded role than 500 the user.

import type { Env } from "../types";

interface AiBinding {
	run: (
		model: string,
		input: { text: string | string[] },
	) => Promise<{ data: number[][] }>;
}

export async function embedText(
	text: string,
	env: Env,
): Promise<number[] | null> {
	if (!text || typeof text !== "string") return null;

	// Workers AI binding (declared as "ai": { "binding": "AI" } in wrangler.jsonc).
	// We cast through `unknown` because the Env interface stays narrow — only the
	// embed helper needs the AI binding type.
	const ai = (env as unknown as { AI?: AiBinding }).AI;
	if (!ai) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_embed_no_ai_binding",
				text_preview: text.slice(0, 60),
			}),
		);
		return null;
	}

	try {
		const result = await ai.run("@cf/baai/bge-base-en-v1.5", { text });
		const embedding = result?.data?.[0];
		if (!Array.isArray(embedding) || embedding.length === 0) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_embed_empty_result",
					text_preview: text.slice(0, 60),
				}),
			);
			return null;
		}
		return embedding; // 768-dim float32 array
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_embed_failed",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		return null;
	}
}
