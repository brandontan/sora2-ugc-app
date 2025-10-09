# Frontend SDD — Sora2 UGC App

## 1. Summary

This document locks the visual and interaction design for the GenVids Fast web app. The frontend stays on Next.js App Router, delivers two core surfaces (marketing home + logged-in dashboard), and leans on Supabase and Stripe APIs that already exist. We now keep the marketing surface ultra-minimal: chaotic-video hero, single CTA, and magic-link card.

## 2. Scope & Goals

- Ship responsive layouts for home, dashboard, checkout handoff, and generation flow without touching backend logic.
- Landing page stays as chaotic-video hero + OTP form (no extra sections) for maximum focus on conversion.
- Reuse the dark glassmorphism style already in `app/page.tsx`, tidy spacing, and unify components for faster iteration.
- Surface credit balance, paywall warnings, and generation progress in plain english. No hidden states.
- Support automation runs (Playwright) by keeping deterministic test ids and accessible hooks.

Out of scope: rewriting Supabase provider logic, touching backend APIs, or adding brand-new navigation shells.

## 3. User Journeys

- **J1: First visit → signup.** Visitor lands on `/`, reads value props, drops email for OTP, and jumps into `/dashboard` once session is ready.
- **J2: Low balance → buy credits.** Authenticated user views balance banner, hits `Buy credits`, completes Stripe checkout, lands back with updated balance.
- **J3: Launch new video.** User uploads product shot, writes prompt, picks duration, submits, sees confirmation message, and watches balance drop by five.
- **J4: Monitor job + download.** User watches job list update in real time, opens preview, downloads final file, or taps `Re-run` if unsatisfied.
- **J5: Automation guardrails.** Playwright suite can seed session, assert balance card, run a mock upload, and sign out without manual clicks.

## 4. Information Architecture

- **Routes.** `/` marketing, `/dashboard` authenticated workspace, `/api/*` endpoints, `/stripe-return` (client-only handoff view we show after checkout success), `/stripe-cancel` to explain abort.
- **Navigation.** Header stays minimal: brand + CTA on home, brand + `Buy credits` + `Sign out` on dashboard. Footer not needed for MVP.
- **Data zones.** Dashboard top card owns balance, middle card owns generation form, lower grid lists historical jobs. Each zone updates through Supabase hooks.

## 5. Screen Blueprints

- **Landing (`/`).** Chaotic video background hero, two CTAs (open dashboard / focus email field), and single magic-link card. No additional sections.
- **Dashboard (`/dashboard`).**
  - Row 1: Header bar with credit CTA and sign out.
  - Section A: Balance panel with realtime updates, warning ribbon when balance < cost.
  - Section B: Generation form (upload, prompt, duration select, submit button, copy safe note).
  - Section C: Job timeline list showing status pills, preview thumbnail slot, download + regenerate buttons.
- **Stripe return/cancel modals.** Lightweight pages telling the user what happened and directing them back to `Buy credits` or to start a run.
- **Policy warning overlay.** When a job returns policy block, show inline callout inside job card with action button to edit prompt.

## 6. Component Specifications

- **ShellHeader.** Reusable header component with variant props for home vs dashboard. Handles sticky blur background and CTA buttons.
- **CreditBadge.** Displays current balance, uses `balance-value` test id, animates number changes, shows low-balance hint.
- **UploadCard.** Contains file picker, prompt textarea, duration select, submit button, help copy. Disables controls while submitting.
- **JobCard.** Renders status, prompt snippet, timestamp, action buttons (preview, download, regenerate). Contains slots for policy warning and error view.
- **ToastBanner.** Inline message area at top of dashboard controlling success/error copy shared across actions.
- **EmptyState.** Friendly copy + CTA when there are no jobs yet.

All components expose `data-testid` hooks for automation and keep prop surfaces tiny (no heavy context).

## 7. State & Error Handling

- **Auth.** While session loads, show skeleton shimmer in dashboard sections. If session missing, redirect to `/`.
- **Uploads.** Reject non-image or >10MB files with red message, never clear the existing good file.
- **Credit guard.** Submit button disabled when balance < cost; show inline warning linking back to checkout.
- **API errors.** Display exact message from backend when available, fallback to “Try again.” Keep message in ToastBanner until dismissed or replaced.
- **Realtime.** Subscribe to `credit_ledger` and `jobs` channels; if they fail, show small banner telling user to refresh.
- **Automation skip.** If automation secret not present, still allow manual run; log skip reason to console for tests.

## 8. Platform Considerations

- **Responsive.** Breakpoints at 640px and 1024px. Mobile stacks everything vertically with generous tap targets; desktop uses two-column hero and grid job list.
- **Accessibility.** All interactive elements must have visible focus ring, labels tied via `aria` or `<label>`. Ensure color contrast ≥ 4.5:1 (sky buttons on dark background already pass but verify).
- **Performance.** Lazy-load preview thumbnails, debounce Supabase refetches, reuse React state to avoid re-render storms. Aim for <100KB critical CSS.
- **Theming.** Primary palette: slate background, sky accent, amber warning, red error. Document tokens in a central file later if theme grows.

## 9. Integration Boundaries

- **Supabase.** Client handles session, storage upload, real-time channels. Keep helper in `supabase-provider` and call local `authFetch` for signed routes.
- **Stripe.** Dashboard triggers `/api/credits/checkout`, expects redirect URL response. After returning, front-end polls balance to reflect new credits.
- **Sora job API.** POST `/api/sora/jobs` with prompt, asset path, duration. Poll list via Supabase `jobs` table order by `created_at`.
- **Telemetry.** Console logs already in Playwright helper; add optional `window.plausible` events (`credits_purchase`, `job_started`, `job_error`) later.

## 10. Open Questions & Risks

- Confirm final list of Stripe price ids (only 15-pack today). Add toggles once pricing expands.
- Need creative assets (sample previews) for empty state; placeholder icons for now.
- How to surface long-running job statuses without spamming toast? Maybe add subtle loader badge.
- Device testing: ensure uploads and preview video playback feel good on iOS Safari.
