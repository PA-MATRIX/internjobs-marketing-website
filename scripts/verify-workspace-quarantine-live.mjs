#!/usr/bin/env node
// Read-only readback of the SERVED Workspace bundle (GET only, no cookies, no credentials).
// Walks: index (follows redirects, max 5) -> manifest-*.js -> routes/inbox module + its
// static imports, and checks the Phase 36 markers. Phase 32 non-regression: `parrot-token`
// must appear in the JS reachable from root/inbox (default on; --no-require-parrot disables).
import { fileURLToPath } from "node:url";

const MARKERS = [
  ["Trust sender", /Trust sender/],
  ["trust-sender", /trust-sender/],
  ["Spam-folder reference (folder=spam)", /folder=spam/],
];
const MAX_HOPS = 5;

async function get(url) {
  let cur = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetch(cur, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`${cur}: ${res.status} without Location`);
      cur = new URL(loc, cur).toString();
      continue;
    }
    if (res.status !== 200) throw new Error(`${cur}: HTTP ${res.status}`);
    return { url: cur, text: await res.text() };
  }
  throw new Error(`${url}: more than ${MAX_HOPS} redirects`);
}

/** Returns {ok, problems[], notes[]}. Never exits 0 by absence: every failure is a problem. */
export async function checkBundle(base, { requireParrot = true } = {}) {
  const problems = [];
  const notes = [];
  try {
    const idx = await get(new URL("/", base).toString());
    const m = idx.text.match(/\/assets\/manifest-[A-Za-z0-9_-]+\.js/);
    if (!m) return { ok: false, problems: ["index HTML has no manifest-*.js reference"], notes };
    const man = await get(new URL(m[0], idx.url).toString());
    const start = man.text.indexOf("=");
    let manifest;
    try {
      manifest = JSON.parse(man.text.slice(start + 1).trim().replace(/;$/, ""));
    } catch {
      return { ok: false, problems: ["manifest is not parseable"], notes };
    }
    const inbox = manifest?.routes?.["routes/inbox"];
    const root = manifest?.routes?.root;
    if (!inbox?.module) return { ok: false, problems: ["manifest has no routes/inbox module"], notes };

    const fetchClosure = async (seeds) => {
      const seen = new Map();
      const queue = [...seeds];
      while (queue.length) {
        const u = queue.shift();
        if (!u || seen.has(u)) continue;
        const r = await get(new URL(u, idx.url).toString());
        seen.set(u, r.text);
        for (const rel of r.text.matchAll(/(?:from|import)\s*["'](\/assets\/[^"']+\.js)["']/g)) queue.push(rel[1]);
      }
      return seen;
    };
    const inboxJs = await fetchClosure([inbox.module, ...(inbox.imports ?? [])]);
    const rootJs = await fetchClosure(root ? [root.module, ...(root.imports ?? [])] : []);
    notes.push(`inbox closure: ${inboxJs.size} files; root closure: ${rootJs.size} files`);

    const inboxAll = [...inboxJs.values()].join("\n");
    for (const [name, re] of MARKERS) {
      if (re.test(inboxAll)) notes.push(`present: ${name}`);
      else problems.push(`missing in served inbox route chunk: ${name}`);
    }
    const allJs = inboxAll + "\n" + [...rootJs.values()].join("\n");
    if (/parrot-token/.test(allJs)) notes.push("present: parrot-token (Phase 32)");
    else if (requireParrot) problems.push("missing in served JS: parrot-token (Phase 32 embed)");
    else notes.push("absent: parrot-token (not required)");
  } catch (e) {
    problems.push(`fetch/traversal failure: ${e.message}`);
  }
  return { ok: problems.length === 0, problems, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const bi = a.indexOf("--base");
  const base = bi >= 0 ? a[bi + 1] : "https://workspace.internjobs.ai";
  const r = await checkBundle(base, { requireParrot: !a.includes("--no-require-parrot") });
  for (const n of r.notes) console.log(n);
  for (const p of r.problems) console.log(`FAIL: ${p}`);
  console.log(r.ok ? `GREEN ${base}` : `RED ${base}`);
  process.exit(r.ok ? 0 : 1);
}
