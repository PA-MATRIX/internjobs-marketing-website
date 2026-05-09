# RRR UAT: Marketing Rendering and Workspace Split

**Date:** 2026-05-09
**Mode:** Playwright visual verification

## Scope

- `/` student landing page
- `/startups` startup page
- Desktop full-page screenshots
- Mobile full-page screenshots
- Marketing dist asset guard
- App health-check shell

## Findings

- Initial Playwright screenshots showed large blank content bands caused by scroll-triggered reveal components staying hidden in full-page/browser automation capture.
- Mobile student page showed stray vertical connector lines in the signal map.

## Fixes

- Reveal sections now render visible by default, while keeping non-blocking motion behavior.
- Mobile signal connector no longer rotates into vertical stray lines.
- Student Join Early Access CTAs now route to `https://app.internjobs.ai`.

## Verification Commands

- `npm run build:marketing`
- `npm run verify:marketing:dist`
- `npm run build:app`
- `npx playwright screenshot --full-page http://127.0.0.1:5182 /tmp/internjobs-home-local-fixed.png`
- `npx playwright screenshot --full-page http://127.0.0.1:5182/startups /tmp/internjobs-startups-local-fixed.png`
- `npx playwright screenshot --viewport-size=390,1200 --full-page http://127.0.0.1:5182 /tmp/internjobs-home-mobile-fixed.png`
- `npx playwright screenshot --viewport-size=390,1200 --full-page http://127.0.0.1:5182/startups /tmp/internjobs-startups-mobile-fixed.png`

## Status

Local visual blocker fixed. Production deploy still needs to be run after commit.
