# Phase 26: Knowledge Graph + GenZ Polish — Research

**Researched:** 2026-05-27
**Domain:** FalkorDB cross-namespace graph context + Mattermost GIF plugin + canvas-confetti UI polish
**Confidence:** HIGH (all findings verified from source files; Mattermost plugin from official GitHub + marketplace)

---

## Summary

Phase 26 has two parallel tracks. The KGRAPH track is largely **already implemented** — `getEmployeeContext` exists in `apps/parrot/workers/lib/graph.ts` and is already wired into both the email and chat extraction paths in `apps/parrot/workers/durableObject/index.ts`. The fire-and-forget `recordTodoFact` write-back is also live. What remains for KGRAPH is: verifying the cross-namespace isolation smoke test (KGRAPH-04) and running the qualitative A/B comparison (KGRAPH-05). The GENZ track needs Mattermost GIF plugin installation + two new confetti triggers (`first_todo_cleared` and `5_emails_responded`) added to `apps/parrot/app/lib/confetti.ts` + a parrot-mascot loading state component.

The parrot SVG logo exists at `apps/parrot/public/logo.svg` but is the Infinity-mark brand logo — not a character mascot. The mascot loading state requires either a new illustrated SVG or a CSS/emoji stub. This is the only genuinely unresolved asset decision.

**Primary recommendation:** KGRAPH track is code-complete; Phase 26 KGRAPH work is verification + A/B testing only. GENZ track is the active build surface.

---

## 1. Existing-Code Anchors

| File | What's There | Line(s) |
|------|-------------|---------|
| `apps/parrot/workers/lib/graph.ts` | `getEmployeeContext(env, employeeId)` — fully implemented, 1500-char cap, `<employee_context>` XML fence, parallel `getActiveTodos` + `getFrequentCollaborators` calls | 737–784 |
| `apps/parrot/workers/lib/graph.ts` | `recordTodoFact(env, args)` — fire-and-forget write, idempotent via `sha256(employeeId|sourceId)` hash MERGE | 321–472 |
| `apps/parrot/workers/lib/graph.ts` | `makeProxyGraph` — Worker → Fly HTTP proxy, `POST /query { cypher, params }`, 8s timeout, fail-soft null return | 104–151 |
| `apps/parrot/workers/lib/graph.ts` | `ensureParrotGraphSchema` — boots `:Employee`, `:Todo`, `:Person`, `:Email`, `:ChatMsg` indexes idempotently | 184–230 |
| `apps/parrot/workers/durableObject/index.ts` | `extractTodosFromEmail` — calls `getEmployeeContext` then `extractTodosFromText(text, eid, 3600, env, contextBlock)` then fire-and-forget `recordTodoFact` for each extracted todo | ~921–980 |
| `apps/parrot/workers/durableObject/index.ts` | `extractTodosFromChat` — same pattern, cacheTtl=1800 | ~1110–1170 |
| `apps/parrot/workers/lib/ai.ts` | `extractTodosFromText(text, clerkUserId, cacheTtl, env, contextBlock?)` — when `contextBlock` is non-empty, forces `cf-aig-cache-ttl: 0` and prepends `${contextBlock}\n\n` before the `<role>` system block | 236–353 |
| `apps/parrot/app/lib/confetti.ts` | `fireConfetti(event)` — canvas-confetti ^1.9.4, dynamic-import SSR-safe, localStorage once-per-session gate | full file |
| `infra/graph-api/src/index.mjs` | `POST /query { cypher, params }` — accepts arbitrary Cypher + param binding, returns `{ data, stats }` | 129–166 |
| `apps/app/src/memory/graph.mjs` | `getStudentSummary(studentId)` — student-side reference | 551–615 |
| `apps/app/src/workflows/student-inbound.mjs` | `graphSummary` prompt-prepend call site | 172–184 |

---

## 2. `getStudentSummary` Deep Dive (Reference Pattern)

**Location:** `apps/app/src/memory/graph.mjs:551`

**Cypher:** Calls `getActiveFacts(studentId, { limit: 50 })` which runs:
```cypher
MATCH (s:Student {id: $sid})-[:HAS_FACT]->(f:Fact)
WHERE f.valid_to IS NULL
RETURN f.predicate, f.object_value, f.confidence, f.valid_from
ORDER BY f.confidence DESC LIMIT 50
```

**Return shape:** `string` — lowercased prose paragraph, e.g. `"studies at: MIT. interested in: fintech, ML. last active: 2026-05-10 14:22."`. NOT JSON.

**Size cap:** `SUMMARY_CHAR_BUDGET = 1200` chars (line 55). Hard-truncate with `"…"` suffix. The comment explains: student profile blob + role blob already ~600 chars, so 1200 is safe.

**Failure modes:**
- `FALKORDB_URL` unset → `getGraphClient()` returns `null` → `getActiveFacts` returns `[]` → `getStudentSummary` returns `""`.
- DB connection error → singleton resets to `null` → next call retries → `""` returned to caller.
- Student has no facts → `facts.length === 0` → returns `""`.
- All error paths return `""` — never throws. The workflow catches the outer `try/catch` at `student-inbound.mjs:173` as extra defense.

**How it's injected (student-inbound.mjs:172–184):** `graphSummary` is stored in a local `let` variable initialized to `""`. If `getStudentSummary` succeeds, it overwrites. The string is passed downstream into `sendWaitlistHoldingReply` which weaves it into the system prompt as a `WHAT YOU REMEMBER:` section only when non-empty.

---

## 3. `getEmployeeContext` vs `getStudentSummary` — What's Different

The Parrot-side equivalent is **already implemented** and is NOT a mirror — it's a more structured format:

```
<employee_context>
Open todos (most urgent first):
- [urgency 87] Reply to investor email • deadline: 2026-05-21 • @mention
- [urgency 60] Draft Q3 OKRs

Frequent collaborators: Alice, Bob, Carol.
</employee_context>
```

Key differences from `getStudentSummary`:
- **Char cap:** 1500 (vs 1200 student) — emails are wordier.
- **Format:** XML-fenced structured list, not prose paragraph.
- **Data source:** `getActiveTodos` (`:Employee`→`:HAS_TODO`→`:Todo` where `valid_to IS NULL`) + `getFrequentCollaborators` (top-5 `:Person` by mention count).
- **Transport:** HTTP proxy (`POST /query`), not direct FalkorDB client.

**Prompt-prepend mechanic in `ai.ts:247–252`:**
```typescript
const hasContext = !!contextBlock && contextBlock.length > 0;
const effectiveCacheTtl = hasContext ? 0 : cacheTtl;  // cache bypass on personalized prompt
const systemPrefix = hasContext ? `${contextBlock}\n\n` : "";
// injected as: `${systemPrefix}<role>...`
```
Context goes before the `<role>` system block, not in a separate message. AI Gateway cache is bypassed (`cf-aig-cache-ttl: 0`) whenever context is present.

---

## 4. Namespace Isolation Answer

**Confirmed:** FalkorDB label-based filtering is strict. `MATCH (n:Employee)` returns zero `:Student` nodes and vice versa — node labels are not inherited, they are explicit per-node type keys. This is documented in `apps/parrot/workers/lib/graph.ts:16–25`:

> "isolation between student-app and Parrot facts is by LABEL NAMESPACE, not by graph … Parrot code MUST NEVER touch the student-app's labels."

**Label families:**
- Student app: `:Student`, `:Role`, `:Startup`, `:Fact`
- Parrot (Employee): `:Employee`, `:Todo`, `:Person`, `:Email`, `:ChatMsg`

**Shared labels:** `:Person` is used in Parrot only (for `[:MENTIONS]->(:Person)` edges). No overlap with student-app labels.

**Edge isolation:** Edge types like `:MENTIONS`, `:BLOCKED_BY` are directional from Parrot labels — `(:Todo)-[:MENTIONS]->(:Person)`. There is no path between `:Employee` nodes and `:Student` nodes in the graph schema. FalkorDB has no cross-label edge leakage risk as long as Cypher queries start from the correct label.

**Prefix naming:** No prefix needed (e.g., `:WSPemployee` is unnecessary). The `:Employee` label is already sufficiently distinct. Indexes at `ensureParrotGraphSchema` cover `(:Employee)`, `(:Todo)`, `(:Person)`, `(:Email)`, `(:ChatMsg)` — no student labels touched.

**`:BLOCKED_BY` edge:** Not currently in the schema. KGRAPH-01/02 requirements mention it — this is a **new edge type** that needs to be added to `recordTodoFact` or a new `recordBlockedByFact` helper. The current schema has `:HAS_TODO`, `:MENTIONS`, `:FROM_EMAIL`, `:FROM_CHAT` only.

**Cross-namespace smoke test (KGRAPH-04):** Run two Cypher queries via `POST /query`:
```cypher
// Should return 0 Student nodes from Employee traversal
MATCH (e:Employee)-[*]->(n:Student) RETURN count(n)

// Should return 0 Employee nodes from Student traversal
MATCH (s:Student)-[*]->(n:Employee) RETURN count(n)
```
Both should return `0`. This can be a one-shot curl against the graph-api proxy.

---

## 5. Fly Proxy Contract

**Answer: the proxy already accepts arbitrary Cypher. No new endpoint needed for `getEmployeeContext`.**

`infra/graph-api/src/index.mjs:129–166`:
- `POST /query` with body `{ cypher: string, params?: object }`
- Returns `{ data: unknown[], stats: object }`
- Auth: `Authorization: Bearer <GRAPH_API_SECRET>`
- Already used by `makeProxyGraph` in `graph.ts` for all reads and writes.

The only endpoints are `POST /query` and `GET /health`. No narrow endpoints (no `POST /close-todo` or similar) — the Phase 18 design deliberately keeps the proxy generic. Any Cypher that `graph.ts` needs is passed through verbatim.

**`:BLOCKED_BY` write-back:** If KGRAPH-02 requires recording `:BLOCKED_BY` edges, the implementation is a new Cypher statement passed to the existing `POST /query` endpoint — no proxy changes needed.

---

## 6. Post-Extraction Write-Back (KGRAPH-02)

**Status:** `recordTodoFact` writes are already live in both the email path (`durableObject/index.ts:~966–981`) and the chat path (`~1170+`). Both use fire-and-forget `void recordTodoFact(this.env, {...})`.

**What is written today:**
- `:Employee` node (MERGE on `employeeId`)
- `:Todo` node (MERGE on deterministic `sha256(employeeId|sourceId)` hash id)
- `[:HAS_TODO]` edge
- `[:MENTIONS]->(:Person)` edges for each `mentioned_actors` entry
- `[:FROM_EMAIL]->(:Email)` or `[:FROM_CHAT]->(:ChatMsg)` edge

**What KGRAPH-02 adds:**
- `:BLOCKED_BY` edges — not currently in schema or write path. Requires kimi extraction schema to emit `blocked_by_todo_ids?: string[]` field OR a post-extraction heuristic (e.g., if a todo title contains "blocked by" — simpler). Decision needed.

**Responsibility:** Worker (EmployeeMailboxDO) after kimi response, same fire-and-forget pattern.

---

## 7. Mattermost GIF Plugin

**Plugin:** `com.github.moussetc.mattermost.plugin.giphy` (community plugin, supports Giphy + Tenor + Klipy)

**Marketplace status (MEDIUM confidence):** Was in official Mattermost marketplace; removed from hosted marketplace in September 2023 when Mattermost stopped hosting community plugins. Must be installed manually.

**Install method (mmctl):**
```bash
# Download latest .tar.gz from https://github.com/moussetc/mattermost-plugin-giphy/releases
mmctl plugin add ./mattermost-plugin-giphy-X.Y.Z.tar.gz
mmctl plugin enable com.github.moussetc.mattermost.plugin.giphy
```
Or via System Console > Plugins Management > Management > Upload Plugin.

**API key requirements:**
- **Tenor:** Requires a Tenor API key (Google Cloud Console, Tenor API v2). Free tier available. No billing required for typical low-volume use.
- **GIPHY:** Requires a GIPHY developer API key (developer.giphy.com). Free tier rate-limited.
- **Klipy:** Requires Klipy API key.

**Recommendation:** Tenor (Google-owned, free tier, no billing required, generous rate limits for internal tools). Set `provider = tenor` in plugin config.

**Configuration path:** System Console > Plugins > GIF commands > Provider = Tenor, API Key = `<tenor-api-key>`.

**Slash commands after install:** `/gif <keywords>` (posts single GIF), `/gifs <keywords>` (shuffle to pick).

**Version:** Latest is v3.0.x. Compatible with Mattermost 6.5+. Self-hosted Fly instance at `chat.internjobs.ai` — check Mattermost server version before installing to confirm compatibility.

---

## 8. canvas-confetti Integration

**Package:** `canvas-confetti ^1.9.4` — already installed in `apps/parrot/package.json:34`.

**Types:** `@types/canvas-confetti ^1.9.0` — already installed.

**SSR safety:** `apps/parrot/app/lib/confetti.ts` already handles SSR via dynamic import + `typeof window === "undefined"` guard. No additional configuration needed for Vite/Remix.

**Existing infrastructure in `apps/parrot/app/lib/confetti.ts`:**
- `ConfettiEvent` union type defines all trigger keys
- `fireConfetti(event)` — dynamic-import, once-per-session via localStorage, fail-silent
- `resetConfettiFlags()` — dev/debug utility

**Existing events already wired:**
- `"onboarding_complete"` — `OnboardingWizard.tsx:87`
- `"first_meeting_started"` — `StartMeeting.tsx:40`
- `"first_email_reviewed"` — defined but not yet wired to a component
- `"first_todo_resolved"` — defined but not yet wired to a component (GENZ-02 covers this)
- `"push_enabled"` — defined, not wired
- `"birthday"` — defined, not wired

**GENZ-02 work:** Add `"5_emails_responded"` to `ConfettiEvent` union and wire both `"first_todo_resolved"` and `"5_emails_responded"` to the appropriate components. `"first_todo_resolved"` belongs in `dashboard.tsx` where todos are marked resolved. `"5_emails_responded"` belongs in the compose/send flow — likely `apps/parrot/app/components/ComposePane.tsx` or the email-send API response handler.

**Counter for 5-emails threshold:** Needs a localStorage counter (e.g., `parrot_emails_responded_count`) incremented on each email send. `fireConfetti("5_emails_responded")` triggers when counter crosses 5. Per-session or per-account? Decision point — see Section 10.

---

## 9. Parrot-Mascot Asset

**Existing logo at `apps/parrot/public/logo.svg`:** This is the Infinity-mark brand icon (two-loop SVG on a dark rounded rectangle), NOT a character mascot. Not usable as an animated loading state mascot.

**Marketing logo assets at `apps/marketing/public/logo/`:** `mark-gradient.svg`, `mark-ink.svg`, `mark-lavender.svg` — these are also the Infinity mark, not a parrot character.

**Conclusion:** No parrot character/mascot SVG exists in the codebase. GENZ-03 requires either:

1. **Create a stub:** A simple CSS animation (e.g., rotating gradient ring or pulsing Infinity mark) as a placeholder — zero-asset-dependency, ships immediately.
2. **Commission/generate SVG:** A parrot character illustration. Not in codebase. Requires design work outside code.
3. **Emoji fallback:** A `<span role="img" aria-label="parrot">🦜</span>` with CSS bounce animation — ships in one component, matches GenZ tone.

**Plan decision:** The executor should implement option 3 (emoji + CSS) as a stub with a `TODO: replace with illustrated mascot` comment, and note the asset path where a real SVG should land (`apps/parrot/public/mascot-parrot.svg`).

---

## 10. A/B Comparison Harness (KGRAPH-05)

**Requirement:** Qualitative A/B comparison on 10 real extractions showing reduced duplicate-todo rate.

**Minimum-viable approach:** Since `recordTodoFact` uses idempotent MERGE with `sha256(employeeId|sourceId)` hash IDs, the "duplicate" rate is already structurally zero at the graph layer (re-runs of same source return `skipped: true`). The A/B is comparing **extraction quality** (fewer semantically-duplicate todos across different emails) with vs without the `<employee_context>` prepend.

**Harness:**
1. Pick 10 emails from the operator's inbox (real production data, already stored in DO SQLite).
2. Run `extractTodosFromText(text, employeeId, 0, env, "")` (no context) and capture JSON output.
3. Run `extractTodosFromText(text, employeeId, 0, env, contextBlock)` (with context) and capture JSON output.
4. Side-by-side eye-ball: count todos where the context-aware version correctly skips a todo that's already open in the graph (vs the no-context version emitting it as a "new" item).

**No new infrastructure needed.** A short Node/Bun script that imports `extractTodosFromText` and calls it twice for each email, printing both outputs as JSON, is sufficient. The comparison is qualitative (operator inspection), not automated metrics.

**Log capture:** The existing `audit_events` SQLite table can record extraction counts per-email for before/after. Not required for SC-4 — "qualitative A/B" is explicitly human-reviewed.

---

## 11. Decision Points the Plan Must Lock In

- **`:BLOCKED_BY` edge extraction:** Does kimi extraction schema emit `blocked_by_ids`, or is it a post-hoc heuristic on the todo title? If schema change: update `ExtractedTodo` interface in `ai.ts` and `TODO_EXTRACTION_SCHEMA`. If heuristic: implement in `recordTodoFact` write-back call site.
- **5-emails confetti threshold:** Per-session (localStorage counter resets on page reload) or per-account (server-side counter via DO storage or `audit_events`)? localStorage is simpler and sufficient for GenZ polish.
- **Mascot asset:** Emoji stub (`🦜` + CSS) vs wait for illustrated SVG. Recommend stub now, upgrade later.
- **Tenor API key sourcing:** Who provisions it? Operator (Nithin) needs to create a Google Cloud project, enable Tenor API, generate key, add to Mattermost plugin config via System Console. Not a code task — an ops task. Plan should call this out as a prerequisite.
- **GIF picker scope:** Only in Mattermost chat composer (the default plugin behavior), or also DMs? Default plugin behavior covers both channels and DMs. No extra config needed.
- **Confetti `first_todo_resolved` trigger location:** `dashboard.tsx` (after polling sees a todo disappear from active list) vs `TodoCard` / resolve API call handler. Dashboard polling approach is cleanest — detect transition from present to absent in `prevTodoIdsRef` diff, fire once.
- **Mattermost server version:** Verify `chat.internjobs.ai` server version supports plugin API v3.0.x (requires 6.5+) before install.

---

## 12. Open Risks / Unknowns

1. **`:BLOCKED_BY` is not in current schema:** KGRAPH-02 mentions it as a requirement but no current code writes or reads it. If it requires kimi to extract blocker relationships, that's a schema + prompt change. If it's a graph-only annotation, it still needs a write path. Needs operator clarification on scope.

2. **`getEmployeeContext` already wired — KGRAPH-01/02/03 may be "verify, not build":** The implementation is complete as of Phase 14 Wave 2. KGRAPH-01 (prepend), KGRAPH-02 (write-back), KGRAPH-03 (isolation) are code-complete. The plan should confirm this and focus task effort on the smoke test and A/B run, not re-implementation.

3. **Mattermost plugin compatibility:** The v3.0.x plugin targets Mattermost 6.5+. The self-hosted instance at `chat.internjobs.ai` version is unknown — needs a quick `mmctl version` or System Console check before planning the install task.

4. **Tenor API key provisioning timeline:** External dependency (Google Cloud console). Could block GENZ-01 if not obtained before implementation starts. Plan should note this as a day-0 prerequisite.

5. **Parrot mascot illustrated asset:** If the illustrated SVG is desired (vs emoji stub), it requires design work outside the codebase. The plan should make the stub the default deliverable and treat illustrated mascot as stretch/deferred.

---

## Sources

### Primary (HIGH confidence)
- `apps/parrot/workers/lib/graph.ts` — `getEmployeeContext`, `recordTodoFact`, `makeProxyGraph`, namespace docs (lines 1–830, read in full)
- `apps/parrot/workers/lib/ai.ts` — `extractTodosFromText`, `contextBlock` prepend mechanic, cache-bypass logic (lines 1–353)
- `apps/parrot/workers/durableObject/index.ts` — call sites for `getEmployeeContext` + `extractTodosFromText` + `recordTodoFact` (lines 921–980, 1110–1170)
- `infra/graph-api/src/index.mjs` — `POST /query` arbitrary Cypher contract (lines 1–179)
- `apps/app/src/memory/graph.mjs` — `getStudentSummary` reference pattern + size-cap rationale (lines 50–55, 551–615)
- `apps/app/src/workflows/student-inbound.mjs` — prompt-prepend call site (lines 172–184)
- `apps/parrot/app/lib/confetti.ts` — existing confetti infrastructure, event types, SSR pattern (lines 1–115)
- `apps/parrot/package.json` — canvas-confetti ^1.9.4 already installed

### Secondary (MEDIUM confidence)
- GitHub: `moussetc/mattermost-plugin-giphy` README — plugin ID, provider config, API key requirements, manual install method
- Mattermost marketplace page — confirmed community plugin removal from hosted marketplace (September 2023)
