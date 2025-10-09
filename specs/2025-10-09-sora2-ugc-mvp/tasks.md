# Tasks: Sora2 Product Placement UGC MVP

1. **Supabase project baseline**
   - Set up tables: users (profile), credit_ledger (balance via sum), jobs (status, video_url), assets (upload references).
   - Enable Row Level Security and policies for each table.
   - Create Storage buckets `product-uploads` and `ugc-outputs`.
   - Deliverable: SQL migration file and policy notes.

2. **Auth + balance UX**
   - Integrate Supabase OTP login in Next.js, persist session, expose hooks for user id and balance.
   - Build dashboard header showing credits and low-balance warning.
   - Deliverable: `/dashboard` showing login state and balance pulled from Edge Function.

3. **Credit packs + Stripe webhook**
   - Create Stripe Checkout page for pack options; handle success redirect to dashboard.
   - Implement Supabase Edge Function webhook to insert positive ledger rows.
   - Deliverable: Successful test purchase updates balance without manual steps.

4. **Sora2 generation Edge Function**
   - Accept product image path + prompt, validate balance >= cost, deduct credits in transaction.
   - Call Sora2 `/videos` with uploaded image as `input_reference`, store job + pending status, poll until ready, save video link to Storage.
   - Deliverable: curl-able endpoint returning job status and final video URL; ledger reflects deduction.

5. **Frontend flow + download**
   - Wizard to upload image, enter prompt, submit job, show spinner, surface download link when ready.
   - Block job start with paywall modal if balance insufficient; link to credit purchase.
   - Deliverable: Playwright happy-path test covering login → upload → job complete → download link.

6. **Hardening + checks**
   - Add rate limiting (Supabase function guard) and basic audit logging.
   - Run unit/integration tests, `aud full`, and document runbook for key rotation.
   - Deliverable: Test logs + auditor report attached to HANDOFF.
