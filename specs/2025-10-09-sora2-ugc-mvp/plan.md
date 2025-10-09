# Plan: Sora2 Product Placement UGC MVP

## Architecture
- **Frontend (Next.js App Router)**: Supabase client, upload wizard, credit balance and history, Sora2 job status + download link. Deployed on Vercel or similar static host.
- **Supabase**: Auth (OTP email), Postgres (tables: users, credit_ledger, jobs, assets), Storage buckets for user uploads and final video URLs, Edge Functions for Sora2 orchestration and Stripe webhooks.
- **Stripe**: Checkout sessions for credit packs; webhook posts to Supabase Edge Function to credit ledger.
- **OpenAI Sora2**: `/videos` endpoint invoked from Edge Function using signed Supabase Storage URL as `input_reference`.

## Data Flow
1. User signs in via Supabase OTP; frontend stores session.
2. Credit purchase triggers Stripe Checkout → webhook credits ledger.
3. Frontend upload posts product image to Supabase Storage, then calls Edge Function with prompt + asset path.
4. Edge Function checks credits, decrements in a transaction, calls Sora2, stores job + pending video URL.
5. Polling Edge Function updates job status and stores final video location; frontend surfaces download and balance.

## Key Decisions
- Minimal tables to keep free tier usage low: ledger holds signed ints (positive credits from Stripe, negative per generation).
- Use Supabase Row Level Security to isolate user rows; rely on `auth.uid()` for credit queries.
- Run Sora2 orchestration in Edge Function to avoid shipping backend servers; keep cold start small.
- Frontend uses optimistic UI for credit deductions but always reconciles with server balance response.

## Validation Strategy
- Unit tests: ledger math and balance endpoints (supabase-js + vitest). Edge Function unit for credit transaction.
- Integration: scripted run hitting Edge Function with mock Sora2 (recorded response) to ensure credit guard.
- Manual: one end-to-end Sora2 call using staging keys, confirm video download and ledger entry.
- Security: run `aud full` after initial implementation to baseline SAST; re-run before release.
