# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-09)
- Repo bootstrapped with Next.js frontend, Supabase schema, and Playwright tests.
- Local mock flow (Supabase mock + Stripe stub + fal stub) passes Playwright e2e.
- Production Supabase admin/password APIs reject keys when called from Node, blocking live automation.
- Awaiting working Supabase session path before deploying or running live Stripe + Sora tests.

## Next Steps
1. Gain programmatic Supabase session (valid API response or provided credentials).
2. Re-run `frontend/tests/e2e/live-genvidsfast.spec.ts` against genvidsfast.com once auth works.
3. Deploy frontend to production after live flow succeeds.

## References
- Handoff log: `HANDOFF-2025-10-09.md`
- Agents guide: `Agents.md`
