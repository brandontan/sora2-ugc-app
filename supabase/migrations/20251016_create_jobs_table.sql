-- Migration: Ensure jobs table and metadata columns exist
-- Date: 2025-10-16
-- Purpose: Backfill missing jobs schema so webhook updates persist status changes.

-- Required extensions for UUID generation utilities used by defaults/functions.
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Core jobs table definition. Uses IF NOT EXISTS to stay idempotent when
-- applied against environments that already have the table.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  asset_path text not null,
  status text not null default 'queued',
  provider text not null default 'fal',
  provider_job_id text,
  video_url text,
  credit_cost integer not null default 5,
  provider_status text,
  queue_position integer,
  provider_error text,
  provider_last_checked timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Helpful composite index for dashboard/job tray queries.
create index if not exists jobs_user_idx
  on public.jobs (user_id, created_at desc);

-- Ensure provider metadata columns exist when table predates this migration.
alter table public.jobs
  add column if not exists provider text not null default 'fal';

alter table public.jobs
  add column if not exists provider_status text;

alter table public.jobs
  add column if not exists queue_position integer;

alter table public.jobs
  add column if not exists provider_error text;

alter table public.jobs
  add column if not exists provider_last_checked timestamptz;

alter table public.jobs
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

-- Trigger to keep updated_at fresh on any row change.
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

-- RLS should be active so users only see their own jobs.
alter table public.jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'jobs-select-own'
      and schemaname = 'public'
      and tablename = 'jobs'
  ) then
    create policy "jobs-select-own" on public.jobs
      for select using (auth.uid() = user_id);
  end if;
end;
$$;
