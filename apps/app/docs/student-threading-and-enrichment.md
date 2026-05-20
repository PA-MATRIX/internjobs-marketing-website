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

Legacy profile-enrichment job provider value:

```text
sprite_brightdata
```

The live onboarding path now attempts enrichment directly before first contact:

1. Bright Data LinkedIn Profiles API by URL (`BRIGHTDATA_API_TOKEN`)
2. Proxycurl person profile by URL (`PROXYCURL_API_TOKEN`)
3. Proxycurl reverse-email fallback

All providers write to the same `linkedin_profiles` table. The first SMS prompt can use structured LinkedIn context only when that table has headline/current role/school/skills data; otherwise it uses the student's name and stored LinkedIn URL without inventing details.

The app must not collect LinkedIn credentials or scrape private LinkedIn surfaces.
