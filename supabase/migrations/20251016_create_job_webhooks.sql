-- Migration: Create job webhooks log table
-- Date: 2025-10-16
-- Purpose: Persist Fal webhook payloads for auditing and debugging.

create table if not exists public.job_webhooks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
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
