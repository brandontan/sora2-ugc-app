-- Create admin audit logs table for tracking privileged page access
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_audit_logs'
      and policyname = 'admin_audit_logs_service_insert'
  ) then
    execute $chunk$
      create policy admin_audit_logs_service_insert
        on public.admin_audit_logs
        for insert
        with check (auth.role() = 'service_role');
    $chunk$;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_audit_logs'
      and policyname = 'admin_audit_logs_service_select'
  ) then
    execute $chunk$
      create policy admin_audit_logs_service_select
        on public.admin_audit_logs
        for select
        using (auth.role() = 'service_role');
    $chunk$;
  end if;
end;
$$;
