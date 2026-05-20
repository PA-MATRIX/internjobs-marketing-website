# Debug: Meetings tab auto-starts Daily room

## Status

RESOLVED in production.

## Symptom

Clicking the left-rail Meetings tab immediately mounted the Daily iframe on the right side, which started the meeting experience before the user explicitly chose to join.

## Root Cause

`apps/parrot/app/components/MeetingsPane.tsx` rendered `DailyProvider` as soon as the room URL and token loaded. Fetching `/api/meetings/my-room` and `/api/meetings/room-token` is fine for preloading room metadata, but mounting the Daily iframe should be gated by user intent.

## Fix

The Meetings pane now renders a prejoin card by default. It still resolves the user's room and token, but only mounts the Daily iframe after the user clicks `Join room`. A separate `Open in new tab` action is available once the room URL is known.

## Verification

- Browser verification on `/meetings` showed the prejoin card text.
- DOM check found `dailyIframes: 0` before clicking `Join room`.
- Network traffic during tab navigation included Parrot room/token APIs but no Daily room document load before the explicit join action.
