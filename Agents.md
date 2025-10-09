# Agents.md

## Start Here
- Memory MCP server: mcp/MEMORY.md
- Daily handoff: HANDOFF-2025-10-09.md

## Overview
- Project: sora2-ugc-app — build a Supabase-backed Sora2 UGC flow with credit packs, video generation, and download delivery.
- Code lives in this repo. Frontend is Next.js under `frontend/`; Supabase schema in `supabase/`.
- Automated tests use Playwright (see `frontend/tests`).

## Current Priorities
1. Verify the new realtime balance refresh in production so automation keeps the Sora button unlocked.
2. Re-run the live Playwright flow with seeded Supabase creds to ensure credits, job queueing, and downloads stay green.
3. Prep the Next.js deploy once the live automation passes and dashboards show accurate balances.

## Useful Paths
- Mock/test helpers: `frontend/src/lib/`
- API routes: `frontend/src/app/api/`
- E2E specs: `frontend/tests/e2e/`

Keep Memory MCP and the latest handoff updated whenever work is handed over.
