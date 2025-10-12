# Agents.md

## Start Here
- Memory MCP: mcp://memory/sora2-ugc-app/handoff
- Daily handoff: HANDOFF-2025-10-13.md

## Overview
- Project: sora2-ugc-app — build a Supabase-backed Sora2 UGC flow with credit packs, video generation, and download delivery.
- Code lives in this repo. Frontend is Next.js under `frontend/`; Supabase schema in `supabase/`.
- Automated tests use Playwright (see `frontend/tests`).

## Current Priorities
1. **MANUAL STEP REQUIRED**: Apply provider metadata migration via Supabase dashboard SQL editor
   - File: supabase/migrations/add_provider_metadata_to_jobs.sql
   - URL: https://supabase.com/dashboard/project/thmsrumxinyjyljdgcgy/sql/new
2. After migration: Update /api/sora routes to persist provider_status and queue_position
3. Test rapid multi-job submission flow (dashboard no longer blocks with overlay)
4. Verify dashboard shows real-time queue position updates

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
