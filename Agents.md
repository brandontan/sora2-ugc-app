# Agents.md

## Start Here
- Memory MCP: mcp://memory/sora2-ugc-app/handoff
- Daily handoff: HANDOFF-2025-10-16.md

## Overview
- Project: sora2-ugc-app — build a Supabase-backed Sora2 UGC flow with credit packs, video generation, and download delivery.
- Code lives in this repo. Frontend is Next.js under `frontend/`; Supabase schema in `supabase/`.
- Automated tests use Playwright (see `frontend/tests`).

## Current Priorities
1. Schedule `/api/sora/poller?limit=5` cron with `ADMIN_DASHBOARD_TOKEN` (WaveSpeed + Fal)
2. Finish `/admin/jobs` telemetry view (jobs table + provider timeline) plus evidence
3. Resolve provider gaps: Fal jobs stuck `IN_QUEUE`; Replicate Sora blocked until OpenAI org verified

## Useful Paths
- Mock/test helpers: `frontend/src/lib/`
- API routes: `frontend/src/app/api/`
- E2E specs: `frontend/tests/e2e/`

Keep Memory MCP and the latest handoff updated whenever work is handed over.

## Working Agreement
- Alias `slv` means “speak in simple English with minimal words”; keep all user-facing replies in that tone.
- Always ask for fresh API keys or credentials needed to run flows before assuming access.
- Do not ask the human to perform actions the agent can handle (commands, edits, deployments, validations, etc.).
- Before wrap-up, run lint/tests as needed, ensure no secrets are committed, and finish with a clean commit + push to main.
- Default to deploying to genvidsfast.com once changes are validated unless explicitly told otherwise.
