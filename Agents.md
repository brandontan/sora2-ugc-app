# Agents.md

## Start Here
- Memory MCP server: mcp/MEMORY.md
- Daily handoff: HANDOFF-2025-10-09.md

## Overview
- Project: sora2-ugc-app — build a Supabase-backed Sora2 UGC flow with credit packs, video generation, and download delivery.
- Code lives in this repo. Frontend is Next.js under `frontend/`; Supabase schema in `supabase/`.
- Automated tests use Playwright (see `frontend/tests`).

## Current Priorities
1. Refresh dashboard balance after automation top-ups so Sora job button unlocks.
2. Stabilize live Playwright flow (login → credits → Sora preview/download).
3. Deploy Next.js frontend once the live automation run stays green end-to-end.

## Useful Paths
- Mock/test helpers: `frontend/src/lib/`
- API routes: `frontend/src/app/api/`
- E2E specs: `frontend/tests/e2e/`

Keep Memory MCP and the latest handoff updated whenever work is handed over.
