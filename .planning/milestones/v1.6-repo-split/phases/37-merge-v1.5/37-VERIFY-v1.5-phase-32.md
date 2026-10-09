---
phase: v1.5/32-parrot-embed-pane
verified: 2026-10-08
commit: 1ecddd9 (origin/integration/v1.5, detached checkout)
status: human_needed
score: 13/13 must-haves verified structurally; 0 tests executed (offline, no node_modules)
---

# v1.5 Phase 32 verification (Parrot embed pane)

Goal: embed the separate Parrot dialer into the Workspace SMS/phone pane via iframe + signed-token SSO reusing the existing /oidc/* key bridge; do not build a dialer.
Architectural context: no .planning/NORTH-STAR.md in this checkout; no locked-rule conflicts found.

## Tests
NOT RUN. apps/parrot/node_modules is absent and root node_modules is absent; instructed not to npm install. Test files exist (embed-jwt 11 cases, parrot-embed 33, csp-header 5, embed-token route 1) and CI job `parrot` in .github/workflows/ci.yml:80 runs `npm test` (vitest) for apps/parrot, so these ARE gated in CI. The SUMMARY/marker claim "132 vitest pass" is unverified here.
TDD/RED evidence: SUMMARYs contain no RED-before-GREEN capture (grep "RED" finds none). Per global rule this is a process gap, not a goal gap.

## Must-haves (checked against code)

Plan 32-01
1. Mint endpoint, ~120s RS256, no client_id/secret dance: workers/index.ts:368 POST /api/embed/parrot-token behind requireEmployeeMailbox; embed-jwt.ts:27 TTL=120, :99-111 SignJWT RS256. VERIFIED.
2. sub and email always non-empty: embed-jwt.ts:72-77 throw on blank; index.ts:388-397 resolves email from Clerk if no "@", else 422. VERIFIED.
3. role admin via existing operator gate, no second list: index.ts:376 hasOperatorAccess(...) ? admin : employee. VERIFIED.
4. Same OIDC_SIGNING_KEY as /oidc/jwks: embed-jwt.ts:79 importPKCS8(env.OIDC_SIGNING_KEY), kid from OIDC_PUBLIC_JWK :85-95; oidc.ts:84,110 publishes jwks. VERIFIED (live kid match is claimed in marker, not checkable offline).
5. Fails closed 503 without key: index.ts:372-374; embed-jwt.ts:69. VERIFIED (route-level 503 has no dedicated test; the route test is a mounted-not-404 smoke only).

Plan 32-02
6. Pane loads, loading state clears on parrot:ready: ParrotEmbedPane.tsx:279-285 setReady, timeout/retry :193, token mint :206. VERIFIED structurally.
7. allow="microphone; autoplay": ParrotEmbedPane.tsx:421. VERIFIED.
8. iframe never unmounted, only display:none: root.tsx:195 mounts <ParrotEmbedPane/> in AppShell; ParrotEmbedPane.tsx:406 display visible?block:none. VERIFIED. DEVIATION: plan said /phone and /sms; commit 3e75223 collapsed them into one /parrot route (routes.ts:22, parrot.tsx, visible = pathname.startsWith("/parrot") at pane :161). phone.tsx/sms.tsx no longer exist and no redirects from /phone,/sms (old bookmarks 404). Acceptable and documented in code; truth holds for /parrot.
9. Foreign-origin postMessage ignored: ParrotEmbedPane.tsx:279 isTrustedParrotOrigin(event.origin) first; parrot-embed.ts:22-27 strict equality; tests reject http, subdomain, trailing slash. VERIFIED. Minor: trust origin is the hardcoded constant PARROT_EMBED_ORIGIN, not derived from env embed_url, while CSP and embed src derive from PARROT_EMBED_URL. Changing the env var would break messaging silently. Advisory only. event.source is not checked against the iframe contentWindow (advisory).
10. CSP frame-src allows Parrot without breaking Clerk: workers/app.ts:184-216, frame-src only, includes clerk.workspace.internjobs.ai and challenges.cloudflare.com, no default-src; registered before auth middleware. VERIFIED statically; Clerk non-regression is live-only (marker claims sign-in OK in live UAT).

Plan 32-03
11. Phone/SMS nav badge incl. while on other panes: WorkspaceShell.tsx:264-277 listens parrot-badge-change; :308-320 badge on /parrot icon (calls+messages combined; single icon after collapse). VERIFIED.
12. Badge clears at 0/0: parseParrotBadge clamps and returns 0s (parrot-embed.ts:47-59); badge shown only when total > 0 (WorkspaceShell.tsx:310). VERIFIED.
13. Generic dial-request contract: requestParrotDial parrot-embed.ts:136-147 -> pane listener :323-341 posts parrot:dial and navigates /parrot. VERIFIED. Exceeds plan: ChatPane.tsx:61-62,453-469 is now a real caller (click-to-dial, pre-fill only); normalizeDialNumber requires 10-15 digits.

Goal check: iframe+token SSO using the existing OIDC signing key/JWKS, no dialer code in repo (only embed, badge, ringtone/chime audio). Note the mechanism is a minted embed-JWT, not the Mattermost OIDC code flow; this matches the locked WORKSPACE-HANDOFF contract the plans cite, and reuses the /oidc/jwks key bridge. GOAL MET structurally.

## Submission marker (.planning/workstreams/team-workspace/submissions/32.json)
Consistent with code: ready_for_integration true, phases_completed ["32"], files_touched all exist in checkout (spot-checked app/api/workers files). head_sha 7e4cba0 differs from checkout 1ecddd9 (merge commit PR #26), expected for a merged branch. updated_at 2026-08-11.

## Risks recorded in marker (carried forward, none closed)
- Ringtone (public/ringtone.wav) and inbound-SMS chime: built and unit/build-tested, NEVER sounded live; needs Telnyx. Code present at ParrotEmbedPane.tsx:296-311 (chime on SMS increase) and playIncomingCallRingtone. Pending live validation.
- Stock-icon licence: public/parrot-icon.png from a supplied image resembling Shutterstock ID 2708431457; Nithin to confirm licence before real users. Unresolved.
- Telnyx not provisioned: dialers show "Not connected" by design.
- Deploy conflict with Phase 36 branch: prod ran Phase 32 with Phase 36 quarantine off until both merged into integration/v1.5. Check that integration/v1.5 now contains both.
- Scope creep flagged: 3 non-embed fixes (MM password 72-char cap, Clerk email/name resolution, createMmUser logging) in apps/parrot.
- CI gap on screen.test.mjs: NOT recorded in the marker. Verified: apps/app/src/safety/screen.test.mjs exists but is in no CI job and no package.json script (only test:auth is). It is a Lakera v1.3 file, not touched by Phase 32; pre-existing gap, not a Phase 32 gap. Parrot's own vitest suite is in CI.

## Not verifiable offline / human needed
- Run `npm ci && npm test && npm run typecheck` in apps/parrot (or confirm CI green on 1ecddd9); confirm 132 tests.
- Live: ringtone/chime audible, call audio (needs Telnyx), Clerk sign-in unaffected by CSP, iframe survives navigation without SIP drop, jwks kid match.
- Licence decision on parrot-icon.png.

## Gaps
None blocking the goal. Advisories: no RED evidence in SUMMARYs; route-level 503/role tests absent (only a mounted smoke test); hardcoded trusted origin vs env-driven embed URL; /phone,/sms have no redirect.
