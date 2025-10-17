# Tasks: Admin Jobs Telemetry UX Refresh

1. **Schema + audit plumbing**
   - Add `admin_audit_logs` table + RLS to `supabase/schema.sql` and migrations.
   - Expose helper in server page to write audit row (wrap errors).
   - Test locally via Supabase studio or psql.

2. **Server response shaping**
   - Ensure `/admin/jobs/page.tsx` forwards `provider_last_checked`, `updated_at`, and `user_display_name` fields unchanged.
   - Insert audit record with job count and optional filters metadata.

3. **Search + filters UX**
   - Add text input (with debounce) to filter `filteredJobs`.
   - Include prompt text, ids, display names, provider status in predicate.
   - Add empty state messaging when filter removes all rows.

4. **Copy + timestamps**
   - Add copy buttons beside job id and provider id with tooltip/aria labels.
   - Show absolute timestamps (UTC) under relative text and include provider last checked string.
   - Update stuck jobs block with minutes stale badge.

5. **QA + hardening**
   - Run `npm run lint`, `npm run build`, and existing Playwright smoke.
   - Manually verify clipboard fallback (disable clipboard in DevTools).
   - Capture audit run + update handoff with verification notes.
