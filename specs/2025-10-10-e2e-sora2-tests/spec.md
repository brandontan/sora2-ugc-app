# Spec: Sora2 UGC End-to-End Automation

## Problem
We need a fully automated Playwright flow that mimics a real buyer from login through download. Manual sign-ins or credit adjustments slow launches and create risk.

## Target Users
- Internal QA engineers who run nightly Playwright suites.
- Product managers who rely on dashboards for release health.
- Founders watching per-run unit economics.

## Goals
- Log in with Supabase Auth without manual email clicks or password resets.
- Confirm credit packs can be bought, ledger updates instantly, and header shows the latest balance.
- Cover the entire video run: upload, prompt entry, job polling, preview, download, and regeneration.
- Enforce paywall whenever balance is below one Sora2 generation.
- Surface clear warnings about OpenAI policy failures inside the flow.
- Keep the browser session clean between runs (cookies, local storage, Sora caches).

## Pricing Notes
- Credit packs stay at $15 for 15 credits (three Sora2 runs per checkout).
- Each generation deducts 5 credits ($5 revenue) for an 83% gross margin assuming ~$0.40 OpenAI Sora cost and 2.9% + $0.30 Stripe fees per order.

## Non-Goals
- Building new UI components beyond what the flow needs.
- Optimizing Sora2 job processing speed (handled server-side).
- Exploring alternative payment providers.

## Constraints
- Tests run with Playwright `serial` mode to avoid race conditions on shared accounts.
- Supabase login must work with service keys or a seeded password user—no inbox polling.
- Stripe test mode only; live mode remains separate.
- Respect current security posture: zero plaintext keys in code, rely on env vars.

## Success Metrics
- Playwright spec passes headless within 7 minutes 95% of the time.
- Credit ledger matches balance UI for every test run.
- Failed Sora2 runs show policy messaging within 3 seconds of receiving the error.
- No leftover auth tokens or storage entries after logout helper runs.

## Key Risks
- Supabase still blocking automated sessions (needs fallback plan).
- Sora2 API quotas causing flakiness; need robust retries and skip logic.
- Stripe checkout iframe changes breaking selectors.
- Cost model drift if OpenAI updates pricing—must track margin.

## Open Questions
- Can we provision a dedicated Supabase test user with persistent password access?
- Should we queue multiple regenerations per run or limit to one retry?
- How do we archive Sora2 logs for audit past 30 days?

## References
- Existing `frontend/tests/e2e/live-genvidsfast.spec.ts` baseline.
- Supabase auth docs on password and magic-link flows.
- Sora pricing research: [eesel.ai](https://www.eesel.ai/blog/sora-2-pricing), [Stewart Gauld](https://stewartgauld.com/how-much-does-sora-cost-sora-pricing-plans/).
