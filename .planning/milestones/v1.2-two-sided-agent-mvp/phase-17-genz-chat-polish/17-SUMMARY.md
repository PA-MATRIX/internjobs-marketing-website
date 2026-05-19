---
phase: 17-genz-chat-polish
status: complete
shipped: 2026-05-19
---

# Phase 17 — GenZ Chat Polish + Confetti

Mattermost: `ServiceSettings.EnableGifPicker=true` set via mmctl on internjobs-mattermost. GIF button now renders in every composer.

Parrot UI: new `apps/parrot/app/lib/confetti.ts` with `fireConfetti(event)` API gated by localStorage (one fire per event type per browser). Dynamic-imports canvas-confetti so SSR stays slim.

Wired: OnboardingWizard step-3 success → `onboarding_complete`. StartMeeting real-room success → `first_meeting_started`.

Defined but not wired (v1.3 polish): first_email_reviewed, first_todo_resolved, push_enabled, birthday.
