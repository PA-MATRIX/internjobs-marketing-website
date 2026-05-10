# 01 Plan: Seamless Student Waitlist

## Objective

Wire the first student waitlist loop end to end: LinkedIn sign-in, QR/SMS verification, Spectrum confirmation, student-thread routing, and provider placeholders for future graph/enrichment work.

## Tasks

- Route authenticated waitlist users directly to `/pairing`.
- Generate short unique verification codes suitable for SMS.
- Render the QR with the exact message text students should send.
- Confirm code-bearing inbound Spectrum/Photon messages.
- Store the verified channel address on the student record.
- Store follow-up inbound messages against the verified student by normalized phone number.
- Create a durable student thread record for Cognee hosted graph integration.
- Create a durable profile enrichment job record for Sprite.dev + Bright Data follow-up work.
- Add an optional Spectrum SDK listener path for direct message replies.
- Update smoke verification for the seamless flow.
- Update Fly ownership docs to `internjobs-sios-org`.

## Success Criteria

- `npm run build:app` passes.
- Production health remains clean after deployment.
- `app.internjobs.ai` still resolves with issued Fly certificate.
- No provider tokens or message bodies are logged.

## External Dependencies

- Clerk production LinkedIn provider still needs production activation if the live instance remains test-key based.
- Cognee hosted credentials/API details are needed before creating real graph nodes.
- Sprite.dev and Bright Data credentials/API details are needed before running enrichment jobs.
