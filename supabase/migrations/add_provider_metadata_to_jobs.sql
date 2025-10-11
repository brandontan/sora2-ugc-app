-- Migration: Add provider metadata columns to jobs table
-- Date: 2025-10-12
-- Purpose: Enable provider status/queue transparency in dashboard

-- Add updated_at column to jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc', now());

-- Add provider metadata columns for queue transparency
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS provider_status text;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS queue_position integer;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS provider_error text;

-- Auto-update updated_at on jobs
CREATE OR REPLACE FUNCTION public.set_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_jobs_updated_at ON public.jobs;

CREATE TRIGGER set_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE PROCEDURE public.set_jobs_updated_at();
