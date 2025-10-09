# Spec: Sora2 Product Placement UGC MVP

## Problem
Brands need fast product-placement videos without managing subscriptions or complex tools.

## Target Users
- Small marketing teams that want quick social-ready ads.
- Solo founders running paid campaigns with limited budget.

## Goals
- Users sign in with Supabase OTP.
- Users prepay credits, see live balance, and top up when low.
- Users upload one product image, add a prompt, and trigger Sora2 generation.
- Users download the finished video from the dashboard.
- Credits decrement precisely per generation; block runs when balance is insufficient.

## Non-Goals
- No subscriptions or trials.
- No multi-tenancy or workspace roles.
- No advanced editing or prompt templates beyond MVP defaults.

## Constraints
- Stay on Supabase free tier (Auth, Postgres, Storage, Edge Functions).
- Use one frontend (Next.js) reusing genvidsfast.com design.
- Keep external services minimal: Stripe for credit packs, OpenAI Sora2 for video.

## Success Metrics
- Time from upload to downloadable video under 5 minutes for standard prompts.
- Credit ledger mismatch rate less than 0.1% across all runs.
- 95% of generations finish without manual intervention.

## Open Questions
- Final credit price per video (needs decision before launch).
- Required video resolution/length constraints from Sora2 quota.
- Stripe pack sizes to offer on day one.
