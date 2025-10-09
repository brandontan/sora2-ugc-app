# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-09)
- Automation session endpoint (`/api/testing/session`) now provisions Supabase login and credit top-ups when called with `x-automation-secret`.
- Credit pack economics set at 5 credits per Sora job, with automation helpers deducting ledger balances automatically.
- Live Playwright flow reaches dashboard but still blocks Sora submission because the balance banner does not refresh after automation top-up.
- Mock flow remains green and new scripts seed QA users with high/medium/low balances.

## Next Steps
1. Refresh dashboard credit state post top-up so the Sora job button unlocks for automation.
2. Re-run `frontend/tests/e2e/live-genvidsfast.spec.ts` against production once balance refresh works.
3. Deploy frontend to production after the live automation run completes without manual steps.

## References
- Handoff log: `HANDOFF-2025-10-09.md`
- Agents guide: `Agents.md`
