# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-12)
- Supabase jobs table now includes provider metadata columns (`provider`, `provider_status`, `queue_position`, `provider_error`, timestamps) with triggers to keep `updated_at` fresh.
- `/api/sora` POST/GET endpoints call the real fal.ai queue; Fal webhooks (`/api/provider/fal/webhook`) now drive status updates with the poller kept as manual fallback.
- Dashboard submission flow stays interactive (no blocking overlay) so users can stack multiple jobs while earlier runs process.
- Production still needs environment keys (`FAL_KEY`) and migration applied through the Supabase dashboard before live validation.
- Frontend now supports dynamic asset requirements per model (single image, first/last frames, reference gallery) and posts structured `assets` payloads to the API.

## Next Steps
1. Apply `supabase/migrations/add_provider_metadata_to_jobs.sql` on production via the Supabase SQL editor.
2. Configure/verify `FAL_KEY` secret in the backend environment (no runs without it).
3. Execute fal.ai jobs end-to-end in production, confirm webhook delivery and saved video URLs.
4. Monitor multi-job submissions after deploy to ensure provider telemetry remains accurate under load.
5. Update ops/spec docs to capture dynamic asset upload modes per model.

## References
- Handoff log: `HANDOFF-2025-10-11.md`
- Agents guide: `Agents.md`
