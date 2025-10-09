# Tasks: Sora2 UGC E2E Automation

1. **Supabase frictionless login helper**
   - Build a reusable Playwright utility to create or refresh a Supabase session without email confirmation.
   - Accept fallback login path (password user) with configurable retries and telemetry logs.
   - Acceptance: Helper returns valid session storage payload; spec skips gracefully if Supabase blocks automation.

2. **Credit economics + paywall math**
   - Translate $15 pack into per-credit value and set Sora2 cost per generation with >40% gross margin based on latest pricing intel.
   - Update ledger constants, UI copy, and warning thresholds accordingly.
   - Acceptance: Documented margin math, tests assert credit cost + paywall triggers when balance < cost.

3. **Balance header verification**
   - Extend e2e spec to confirm balance renders within 5s post-login and updates immediately after checkout webhook.
   - Acceptance: Playwright assertion on `[data-testid="balance-value"]` after purchase; flake guard with retry.

4. **Upload & prompt coverage**
   - Automate product image upload, prompt fill, and duration selection with clear selectors.
   - Acceptance: Test waits for upload success state before proceeding; handles validation errors.

5. **Job polling + preview/download**
   - Script wait loop for job status, assert preview card appears, download link works, and regen branch deducts new credits.
   - Acceptance: Spec validates Sora2 policy warning path and ensures regen respects paywall when balance insufficient.

6. **Teardown hygiene**
   - Ensure logout or fixture clears cookies, local storage, session storage, and Supabase mock state between runs.
   - Acceptance: Follow-up test run starts from clean slate; artifacts confirm empty storage.

