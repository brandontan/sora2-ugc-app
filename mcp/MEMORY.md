# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-11)
- Production Supabase project (`thmsrumxinyjyljdgcgy`) is missing the tables defined in `supabase/schema.sql` (profiles, credit_ledger, jobs), so job tracking and ledger queries currently fail.
- Dashboard still shows a full-screen "Queuing" overlay after submission, preventing additional runs while a job is pending.
- Provider metadata (status, queue position) is not persisted; any values shown in the UI vanish on refresh.
- Fal queue API verified manually via curl; WaveSpeed integration remains unimplemented.

## Next Steps
1. Apply the schema from `supabase/schema.sql` (or regenerate equivalent migrations) to the live Supabase project and confirm REST access.
2. Add persistent provider metadata columns (`provider_status`, `queue_position`, `provider_error`, `provider_last_checked`, etc.) and update the API endpoints to populate them.
3. Redesign the dashboard submission UX to allow multiple queued jobs without blocking the form.
4. Once foundation is stable, implement and verify WaveSpeed.ai provider support.

## References
- Handoff log: `HANDOFF-2025-10-11.md`
- Agents guide: `Agents.md`
