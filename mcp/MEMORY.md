# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-09)
- Automation session endpoint (`/api/testing/session`) provisions Supabase login and credit top-ups when called with `x-automation-secret`.
- Credit pack economics stay at 5 credits per Sora job, with automation helpers deducting ledger balances automatically.
- Dashboard now listens to Supabase realtime changes, so balances refresh instantly after a top-up and the Sora button unlocks.
- Live Playwright spec runs locally with supplied env vars; production verification still pending the seeded credentials.

## Next Steps
1. Re-run `frontend/tests/e2e/live-genvidsfast.spec.ts` against production with seeded Supabase user to confirm the realtime balance fix.
2. Monitor automation runs to ensure the Sora button stays unlocked after top-ups.
3. Deploy the frontend once live automation is green end-to-end.

## References
- Handoff log: `HANDOFF-2025-10-09.md`
- Agents guide: `Agents.md`
