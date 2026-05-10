# Photon/Spectrum Messaging Contract

InternJobs.ai treats Photon/Spectrum as the messaging transport for waitlist channel pairing.

## Required Secrets

Store these in the Projecta/MATRIX Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`.

- `PHOTON_FROM_NUMBER`
- `PHOTON_WEBHOOK_SECRET`
- `PHOTON_PROJECT_ID`
- `PHOTON_API_BASE_URL`
- `PHOTON_API_TOKEN`
- `SPECTRUM_FROM_NUMBER`
- `SPECTRUM_PROJECT_ID`
- `SPECTRUM_API_TOKEN`
- `PROJECT_ID`
- `PROJECT_SECRET`

`SPECTRUM_*` aliases are also supported by the app for the same values. For Spectrum Cloud, the SDK credential names `PROJECT_ID` and `PROJECT_SECRET` are also accepted.

Set `ENABLE_SPECTRUM_LISTENER=true` to run the `spectrum-ts` listener in the Fly app. That listener receives incoming iMessages from Spectrum Cloud, confirms verification codes, and replies in the same message space.

## Inbound Webhook

Endpoint:

```text
POST /webhooks/photon
```

Supported authentication:

- Shared secret header: `x-internjobs-webhook-secret`
- Provider secret header: `x-photon-webhook-secret` or `x-spectrum-webhook-secret`
- HMAC SHA-256 header: `x-photon-signature` or `x-spectrum-signature`

Supported JSON fields for the fallback HTTP webhook:

- `id`, `messageId`, `message_id`, `eventId`, or `event_id`
- `text`, `body`, or `message`
- `from`, `phone`, `sender`, or `user.phone`
- `channel` or `type`

The app extracts modern pairing codes matching:

```text
B9A8F50A
```

Legacy `IJ-XXXXXX` codes remain accepted for old local smoke tests and expired sessions.

## Shared Number Routing

All students text the same Spectrum number. After the first code-bearing message is confirmed, InternJobs.ai stores the sender phone number on the student record. Later inbound messages without a code are routed by normalized sender phone number and stored as `student_reply` events for that student.

The app also creates a `student_threads` row with provider `cognee` so future agent memory can attach to the same student graph.

## Outbound Welcome Message

When a pairing code is confirmed, the app calls:

```text
POST {PHOTON_API_BASE_URL}/messages
Authorization: Bearer {PHOTON_API_TOKEN}
```

Payload:

```json
{
  "from": "{PHOTON_FROM_NUMBER}",
  "to": "{student channel address}",
  "text": "Hey Jordan - welcome to InternJobs.ai..."
}
```

If outbound credentials are missing, the app records the event as `skipped_configuration_missing` instead of logging sensitive payloads or failing the webhook.

## Replay Test

Use a valid active code from `/pairing`, then replay the same provider event ID twice. The first request confirms the channel; the second returns `duplicate: true`.
