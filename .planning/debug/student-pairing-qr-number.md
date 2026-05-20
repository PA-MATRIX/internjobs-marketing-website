# Debug: Student pairing QR points at old phone number

## Status

RESOLVED in production.

## Symptom

Student signed in with `+17133924287`, scanned the student-side QR, and sent:

`Hey internjobs.ai! My verification code is E22D36BC. What's next?`

No reply arrived.

## Root Cause

The student app has two pairing surfaces:

- Legacy `/pairing`, backed by `channel_pairing_codes`, renders 8-character hex codes like `E22D36BC`.
- Newer `/onboard/qr`, backed by `pairing_sessions`, renders `START-...` codes.

The legacy `/pairing` view still built its QR using `config.photon.fromNumber`, which is the old Spectrum/Photon number. The current iMessage/Mac bridge number lives at `config.onboarding.agentNumber` (`AGENT_NUMBER`, default `+14063210019`).

So the code was valid for the legacy pairing table, but the QR sent it to the old number/path instead of the active bridge number that can reply.

## Fix Direction

Update `renderPairing()` to use `config.onboarding.agentNumber`, not `config.photon.fromNumber`. This makes both legacy `/pairing` and newer `/onboard/qr` point at the same active BlueBubbles/Mac bridge inbound number.

Follow-up scope:

- Fly env now declares `SMS_PROVIDER=mac-bridge`, `ENABLE_SPECTRUM_LISTENER=false`, and `AGENT_NUMBER=+14063210019`.
- Fly secrets `PHOTON_FROM_NUMBER` and `SPECTRUM_FROM_NUMBER` were removed so the old Photon/Spectrum number is no longer present in the student app runtime environment.
- `/healthz` reports `agentNumber` and `macBridge` readiness.
- Legacy `/webhooks/photon` still uses `spectrumProvider` directly for old callbacks/tests, but it is no longer the selected production SMS provider and no longer controls the QR target number.

## Related Admin Cleanup

User asked to remove Raj Rentala completely from the Parrot employee list. The admin employee route now supports `DELETE /api/admin/employees/:id?hard=1`, which locks the Clerk user best-effort, removes per-employee capability flags from KV, and deletes the WorkspaceDO `employees` row so it no longer appears in `/admin`.

## Production Data Cleanup

Removed the test student identity tied to `+17133924287` from the production student database so the user can register again from scratch:

- deleted the matching `students` row
- deleted linked `student_threads`, `messaging_events`, `inbound_messages`, `drafts`, and `audit_events`
- verified no remaining student-side rows reference that phone number

The live student app `/healthz` now reports `agentNumber: true` and `macBridge: true`, with no Photon number readiness field.
