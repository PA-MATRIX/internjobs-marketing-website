# Privacy Operations

InternJobs.ai should not collect production waitlist data until provider secrets, webhook authentication, and deletion/export handling are confirmed.

## Sensitive Data Rules

- Do not log raw LinkedIn profile payloads.
- Do not log message bodies.
- Do not log provider tokens, webhook secrets, or database URLs.
- Do not print Infisical secret values in terminal output or docs.

The server logs request failures with path, IP, and error message only.

## Export Request

For a verified student identity:

1. Look up `students.clerk_user_id`.
2. Export related rows from:
   - `students`
   - `waitlist_status`
   - `channel_pairing_codes`
   - `consents`
   - `profile_snapshots`
   - `student_profile_context`
   - `messaging_events`
   - `audit_events`
3. Redact provider metadata that contains secrets or third-party credentials.
4. Send export through a verified support channel.

## Deletion Request

For a verified student identity:

1. Delete the Clerk user or disconnect identity if requested.
2. Delete the `students` row. Cascading constraints remove waitlist, pairing, consent, profile, and context rows.
3. Preserve limited abuse-prevention or legal audit records only when required.
4. Confirm deletion to the student.

## Production Checklist

- `DATABASE_URL` lives in Infisical/Fly secrets.
- `PHOTON_WEBHOOK_SECRET` is set.
- Invalid webhook signatures return 401.
- Raw webhook payload logging is disabled.
- User approval is required before outbound intros or startup replies.
