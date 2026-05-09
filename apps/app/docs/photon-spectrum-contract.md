# Photon/Spectrum Messaging Contract

InternJobs.ai treats Photon/Spectrum as the messaging transport for waitlist channel pairing.

## Required Secrets

Store these in Infisical project `0484b3ce-9ecc-48d8-a822-c2e86921d9bc`, environment `prod`, path `/internjobs-ai`.

- `PHOTON_FROM_NUMBER`
- `PHOTON_WEBHOOK_SECRET`
- `PHOTON_PROJECT_ID`
- `PHOTON_API_BASE_URL`
- `PHOTON_API_TOKEN`

`SPECTRUM_*` aliases are also supported by the app for the same values. For Spectrum Cloud, the SDK credential names `PROJECT_ID` and `PROJECT_SECRET` are also accepted.

## Inbound Webhook

Endpoint:

```text
POST /webhooks/photon
```

Supported authentication:

- Shared secret header: `x-internjobs-webhook-secret`
- Provider secret header: `x-photon-webhook-secret` or `x-spectrum-webhook-secret`
- HMAC SHA-256 header: `x-photon-signature` or `x-spectrum-signature`

Supported JSON fields:

- `id`, `messageId`, `message_id`, `eventId`, or `event_id`
- `text`, `body`, or `message`
- `from`, `phone`, `sender`, or `user.phone`
- `channel` or `type`

The app extracts pairing codes matching:

```text
IJ-XXXXXX
```

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
