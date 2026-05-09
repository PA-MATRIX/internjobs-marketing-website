# LinkedIn Profile Enrichment Gate

The production waitlist starts with LinkedIn fields that are user-authorized through Clerk/OAuth. Browser-based enrichment is not enabled by default.

## Allowed Now

- Clerk user ID
- Authorized email/name/photo fields
- Authorized LinkedIn profile URL or provider metadata when available
- Student-provided interests, projects, preferred work, and notes

## Not Allowed

- Capturing LinkedIn credentials
- Asking students to share LinkedIn passwords
- Bypassing anti-bot, captcha, or private-page controls
- Scraping private LinkedIn surfaces without an approved provider and legal review
- Sending intros or replies without explicit student approval

## Required Before Browser Enrichment

1. Written provider design.
2. Legal/compliance approval.
3. Explicit student consent screen explaining what will be collected.
4. A revocation path.
5. A way for students to review and correct the collected profile summary.
6. A production feature flag defaulting to disabled.

## Current Product Behavior

The app stores authorized OAuth/profile fields during onboarding and lets students edit their profile context at `/profile`.
