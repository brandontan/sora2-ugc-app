# Tech Spec: Admin Jobs Telemetry UX Refresh

## Overview
Extend the `/admin/jobs` dashboard with richer diagnostics and an audit trail without restructuring the page. Work stays inside the existing Next.js route and Supabase schema.

## Data Model
- **New table `admin_audit_logs`** (Supabase):
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null`
  - `email text`
  - `path text not null`
  - `metadata jsonb default '{}'::jsonb`
  - `created_at timestamptz not null default timezone('utc', now())`
  - Enable RLS with service role insert policy only.
- Update schema SQL migration and ensure included in verification docs.

## Backend Flow (`frontend/src/app/admin/jobs/page.tsx`)
1. After fetching jobs and profiles, insert an audit row using the service client with `{ path: '/admin/jobs', metadata: { jobCount } }`.
2. Include `provider_last_checked` and `updated_at` fields in props forwarded to the client.
3. Serialize profile display names that already exist; no extra round-trips.

## Frontend Flow (`frontend/src/app/admin/jobs/page.client.tsx`)
1. **Search bar**
   - Add controlled input above filters.
   - Filter `filteredJobs` by substring match on job id, provider_job_id, prompt, display name, provider status.
   - Debounce ~(150ms) to avoid blocking typing.
2. **Copy affordances**
   - Adjacent to job id and provider id rows, add icon buttons with `navigator.clipboard.writeText` fallback to temporary input.
   - Show a `Copied` tooltip/snackbar for 1.5s using existing glass surface styles.
3. **Timestamp detail**
   - Display relative text (existing) plus a muted absolute timestamp below.
   - Add provider “last checked” timestamp in provider status cell if available.
4. **Stuck context**
   - In stuck jobs panel, show absolute timestamp and minutes stale badge.
5. **Accessibility**
   - Buttons receive `aria-label` and keyboard focus ring.

## Security
- RLS for `admin_audit_logs`: only service role inserts; deny all other operations.
- Ensure audit insert is wrapped in `try/catch` so failures do not break dashboard.
- No sensitive data stored in local state beyond what page already exposes.

## Testing & Verification
- Unit: Add util test (if applicable) for filter predicate.
- Manual: Verify search finds job by id/provider id/display name.
- Auditor: rerun `aud full --quiet` post-change.
- Accessibility: Keyboard tabbing reaches copy buttons and triggers copy via `Enter`.
