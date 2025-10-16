-- Enable required extensions
create extension if not exists "uuid-ossp";

-- Profiles for optional display data
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_seed text,
  avatar_style text default 'bottts',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists avatar_seed text;

alter table public.profiles
  add column if not exists avatar_style text default 'bottts';

alter table public.profiles
  add column if not exists updated_at timestamptz default timezone('utc', now());

alter table public.profiles
  add column if not exists job_tray_cleared_before timestamptz;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute procedure public.set_profiles_updated_at();

-- Credit ledger tracks every movement (+/-)
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

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

-- Jobs table keeps Sora2 requests
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  asset_path text not null,
  status text not null default 'queued',
  model_key text,
  provider text not null default 'fal',
  provider_job_id text,
  video_url text,
  credit_cost integer not null default 5,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists jobs_user_idx on public.jobs (user_id, created_at desc);

-- Add provider metadata columns for queue transparency
alter table public.jobs
  add column if not exists provider_status text;

alter table public.jobs
  add column if not exists queue_position integer;

alter table public.jobs
  add column if not exists provider_error text;

alter table public.jobs
  add column if not exists provider_last_checked timestamptz;

alter table public.jobs
  add column if not exists model_key text;

-- Auto-update updated_at on jobs
create or replace function public.set_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_jobs_updated_at on public.jobs;

create trigger set_jobs_updated_at
before update on public.jobs
for each row
execute procedure public.set_jobs_updated_at();

-- Optional assets table for quick lookup
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('product', 'video')),
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists assets_user_idx on public.assets (user_id, created_at desc);

-- Storage buckets (idempotent)
insert into storage.buckets (id, name, public)
values ('product-uploads', 'product-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('ugc-outputs', 'ugc-outputs', false)
on conflict (id) do nothing;

-- Persist Fal webhook payloads for auditing
create table if not exists public.job_webhooks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete set null,
  provider_job_id text,
  provider text,
  status text,
  payload jsonb not null,
  received_at timestamptz not null default timezone('utc', now())
);
create index if not exists job_webhooks_provider_job_idx
  on public.job_webhooks (provider_job_id, received_at desc);
create index if not exists job_webhooks_job_idx
  on public.job_webhooks (job_id, received_at desc);
alter table public.job_webhooks enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'job_webhooks-select-own'
      and schemaname = 'public'
      and tablename = 'job_webhooks'
  ) then
    create policy "job_webhooks-select-own" on public.job_webhooks
      for select using (
        job_id is null or auth.uid() = (
          select user_id from public.jobs where id = job_id
        )
      );
  end if;
end;
$$;

-- RLS policies
alter table public.credit_ledger enable row level security;
alter table public.jobs enable row level security;
alter table public.assets enable row level security;
alter table public.profiles enable row level security;
alter table public.stripe_events enable row level security;
alter table public.stripe_checkout_sessions enable row level security;

create policy "profiles-select-own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles-update-own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles-insert-own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "ledger-select-own" on public.credit_ledger
  for select using (auth.uid() = user_id);

create policy "jobs-select-own" on public.jobs
  for select using (auth.uid() = user_id);

create policy "assets-select-own" on public.assets
  for select using (auth.uid() = user_id);

create policy "assets-insert-own" on public.assets
  for insert with check (auth.uid() = user_id);

-- Allow users to list their own storage objects
create policy if not exists "Users can read product assets"
on storage.objects
for select using (
  bucket_id in ('product-uploads', 'ugc-outputs')
  and auth.uid() = owner
);

create policy if not exists "Users can upload product assets"
on storage.objects
for insert with check (
  bucket_id = 'product-uploads'
  and auth.uid() = owner
);

-- Atomic credit reservation + job creation
create or replace function public.start_sora_job(
  p_user_id uuid,
  p_prompt text,
  p_asset_path text,
  p_credit_cost integer
) returns table(job_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_balance integer;
  new_job_id uuid;
begin
  select coalesce(sum(delta), 0)
    into current_balance
  from public.credit_ledger
  where user_id = p_user_id;

  if current_balance < p_credit_cost then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.jobs (user_id, prompt, asset_path, credit_cost)
    values (p_user_id, p_prompt, p_asset_path, p_credit_cost)
    returning id into new_job_id;

  insert into public.credit_ledger (user_id, delta, reason)
    values (p_user_id, -p_credit_cost, 'sora_generation');

  return query select new_job_id;
end;
$$;
