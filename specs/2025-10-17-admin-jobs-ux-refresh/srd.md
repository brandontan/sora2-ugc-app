# SRD: Admin Jobs Telemetry UX Refresh

## Problem
The admin jobs console shows recent Sora runs but makes diagnostics slow. IDs are truncated, timestamps lack context, and operators cannot search across records. Missing user display names reduce confidence when acting on a job. There is also no audit trail for who accessed the telemetry page.

## Target Users
- Operators monitoring generation queues during incidents.
- Engineers triaging provider failures or credit disputes.

## Goals
- Surface full job identifiers and let operators copy both internal and provider IDs in one click.
- Provide a fast text filter (job ID, provider ID, prompt, display name, provider status) without reloading.
- Show both relative and absolute timestamps, including provider last checked info, to reduce guesswork on stale data.
- Persist an admin audit log entry each time the jobs dashboard is rendered (user id, email, path, timestamp).

## Non-Goals
- No websocket/real-time streaming changes beyond existing refresh behavior.
- No redesign of the chart widgets or filter aggregation logic.
- No overhaul of Supabase polling / provider integrations.

## Constraints
- Keep all improvements within the existing Next.js page and Supabase schema; avoid third-party UI libraries.
- Clipboard interactions must gracefully degrade when `navigator.clipboard` is unavailable.
- Audit logging must work with the current service-role server execution (no client secret exposure).

## Success Metrics
- Operators can locate a specific job by ID or display name in under 5 seconds (measured via internal dogfooding).
- 100% of admin page loads write an audit row that includes user id and request path.
- No new accessibility regressions (copy buttons operable via keyboard and have aria labels).

## Open Questions
- Should audit logs be surfaced in the UI or only stored for compliance? (default: store only.)
- Do we need to redact prompts from the client filter to avoid sensitive data exposure? (assume acceptable for now.)
