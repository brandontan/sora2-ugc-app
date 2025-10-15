-- Add Stripe audit tables for idempotency and session logging

create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text,
  session_id text,
  status text not null default 'received',
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create index if not exists stripe_events_event_id_idx on public.stripe_events (event_id);

create table if not exists public.stripe_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists stripe_checkout_sessions_user_idx on public.stripe_checkout_sessions (user_id, created_at desc);

alter table public.stripe_events enable row level security;
alter table public.stripe_checkout_sessions enable row level security;

-- no RLS policies provided to keep access limited to service role only
