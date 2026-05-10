# v1.1 Seamless Waitlist and Student Threading

## Goal

Make the student waitlist feel seamless from the marketing CTA through LinkedIn auth, QR-based Spectrum verification, first reply, and durable student thread creation.

## Scope

- Marketing “Join Early Access” opens the app waitlist surface.
- Student signs in with LinkedIn through Clerk.
- Authenticated students land directly on the QR/SMS pairing screen.
- QR opens a prefilled message: `Hey internjobs.ai! My verification code is {CODE}. What's next?`
- Spectrum inbound messages confirm the code and attach the sender phone number to the student.
- Follow-up messages from the same phone number resolve to the same student thread.
- The app creates provider-neutral placeholders for:
  - Cognee hosted student graph/thread storage.
  - Sprite.dev + Bright Data LinkedIn profile enrichment.

## Constraints

- All users text the same Spectrum number, so backend routing must use the sender phone number after initial code verification.
- LinkedIn data collection remains user-authorized through Clerk/OAuth. Browser/profile enrichment stays queued until provider credentials, legal posture, and implementation details are approved.
- Cognee hosted integration is represented as a durable `student_threads` record until credentials/API details are available.

## Exit Criteria

- App verification proves LinkedIn-dev auth routes directly to pairing.
- App verification proves exact QR/SMS copy appears.
- App verification proves code-bearing inbound webhook confirms a student.
- App verification proves later inbound messages from the same phone attach to that student.
- Fly app runs under `internjobs-sios-org`.
