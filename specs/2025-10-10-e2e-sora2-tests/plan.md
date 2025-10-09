# Plan: Sora2 UGC E2E Automation

## Phase 1 – Auth & Session Control
- Document frictionless Supabase login options (password user vs. service session API).
- Prototype Playwright helpers for session seeding and cleanup.
- Gate tests on reliable login, add retries + telemetry on failures.
- Snapshot design: expose configurable retry ceiling + timeout jitter, emit structured telemetry map from helper, and surface skip reasons so Playwright specs can short-circuit when Supabase automation blocks access.

## Phase 2 – Credits & Economics
- Lock in pack price ($15) and decide per-generation credit spend based on Sora2 COGS.
- Update ledger math and dashboard header to reflect live balance after purchases.
- Extend tests to verify paywall triggers when balance < cost per gen.

## Phase 3 – Generation Flow Coverage
- Script upload, prompt entry, job polling, preview, download, and regeneration assertions.
- Simulate Sora2 policy failure response and assert warning messaging.
- Ensure regen deducts new credits and re-checks paywall guard.

## Phase 4 – Tooling & Reporting
- Add Playwright fixtures for teardown (cookies, storage, mock state).
- Hook results into CI reporting and capture artifacts (screenshots, videos, logs).
- Share runbook entry for rerunning tests locally with env requirements.
