-- Verification script to ensure jobs table matches expected schema in production.
-- Run inside Supabase SQL editor or psql against the production database.

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'jobs'
order by ordinal_position;

-- Validate RLS status (should be TRUE before launch).
select relrowsecurity as rls_enabled
from pg_class
where oid = 'public.jobs'::regclass;

-- Confirm provider metadata columns exist and carry recent updates.
select id,
       status,
       provider,
       provider_status,
       queue_position,
       provider_error,
       updated_at
from public.jobs
order by updated_at desc
limit 10;
