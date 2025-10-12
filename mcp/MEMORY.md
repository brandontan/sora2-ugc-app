# MCP Memory — sora2-ugc-app

## Latest Snapshot (2025-10-12)
- Supabase jobs table now includes provider metadata columns (`provider`, `provider_status`, `queue_position`, `provider_error`, timestamps) with triggers to keep `updated_at` fresh.
- `/api/sora` POST/GET endpoints call the real fal.ai queue and WaveSpeed.ai prediction API; dashboard polls provider status and exposes queue/error text.
- Dashboard submission flow stays interactive (no blocking overlay) so users can stack multiple jobs while earlier runs process.
- Production still needs environment keys (`FAL_KEY`, `WAVESPEED_API_KEY`) and migration applied through the Supabase dashboard before live validation.

## Next Steps
1. Apply `supabase/migrations/add_provider_metadata_to_jobs.sql` on production via the Supabase SQL editor.
2. Configure/verify `FAL_KEY` and `WAVESPEED_API_KEY` secrets in the backend environment (no runs without them).
3. Execute fal.ai and WaveSpeed.ai jobs end-to-end in production, confirm queue progression and saved video URLs.
4. Monitor multi-job submissions after deploy to ensure provider telemetry remains accurate under load.

## References
- Handoff log: `HANDOFF-2025-10-11.md`
- Agents guide: `Agents.md`
