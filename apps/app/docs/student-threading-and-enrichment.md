# Student Threading and Enrichment

## Student Thread

InternJobs.ai stores a `student_threads` row after phone verification.

Current provider value:

```text
cognee
```

The row is a durable handoff point for Cognee hosted graph memory. Until Cognee credentials and API details are configured, the row stays in `pending_provider_setup`.

Thread keys are based on:

- student id
- normalized verified phone number

This matters because all students text the same Spectrum number. The sender phone number is the routing key after the first verification code.

## LinkedIn Enrichment

InternJobs.ai stores a `profile_enrichment_jobs` row when Clerk/OAuth provides a LinkedIn profile URL.

Current provider value:

```text
sprite_brightdata
```

The job is not executed yet. It exists so the app can later hand off authorized LinkedIn URLs to Sprite.dev and Bright Data once credentials, legal review, and provider contracts are ready.

The app must not collect LinkedIn credentials or scrape private LinkedIn surfaces.
