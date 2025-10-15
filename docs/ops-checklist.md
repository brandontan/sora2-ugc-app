# Operations Checklist

## Poller Cron
- Workflow: `.github/workflows/poller-cron.yml` (5-minute cadence).
- Required secret: `CRON_SECRET` (same value as Vercel env `CRON_SECRET`).
- Health check: monitor workflow success logs; failures should alert via GitHub notifications.
- Manual run: use workflow_dispatch to trigger immediately after secret rotation.

## Provider Health
- Fal + WaveSpeed status surfaced in dashboard tray.
- Monitor `/admin/jobs` telemetry for stuck statuses (`IN_QUEUE`, `processing > 10m`).
- Recovery playbook:
  1. Hit `/api/sora/poller?limit=5` manually with admin token to force refresh.
  2. If provider stuck, cancel via `/api/sora/jobs/{id}` (needs admin token) to refund credits.
  3. Log incident in handoff with provider response payloads.
- Add fallback provider once Replicate org unblock; track in roadmap.

## Auditor Runs
- Command: `aud full --quiet` from repo root (stores report in `.pf/readthis/`).
- Post-deploy requirement: run Auditor after every production push; archive report to `/tmp/auditor_pf_<timestamp>` per SOP.
- Outstanding criticals: investigate Stripe debug removal (resolved), mock token false positive, login WebSocket heuristic (renamed `linkStatus`).

## Stripe Checkout
- Tables: `stripe_checkout_sessions`, `stripe_events` (service-role only access).
- Verify successful webhooks: `select event_id, status from stripe_events order by created_at desc limit 10;` (expect `processed`).
- Manual refunds: add ledger entry (`insert into credit_ledger (user_id, delta, reason) values (...)`) and note in handoff.
- Investigate any `stripe_events` rows with `status='errored'` immediately; re-run webhook after resolving Stripe issues.

## Supabase Schema Validation
- Run `supabase/verification/check_jobs_schema.sql` in Supabase SQL editor post-migration.
- Confirm `updated_at`, `provider_status`, `queue_position`, `provider_error` columns exist and `relrowsecurity` is true.
- Spot-check Stripe audit tables: `select count(*) from stripe_checkout_sessions;` to ensure logging is active.

## Secrets Rotation
- Vercel env vars: `ADMIN_DASHBOARD_TOKEN`, `CRON_SECRET`, `FAL_KEY`, `WAVESPEED_API_KEY`.
- GitHub secrets: `CRON_SECRET` (for cron workflow), add Fal/WaveSpeed keys if future workflows need them.
- Rotation cadence: monthly or after any suspected compromise; update workflow + redeploy.
