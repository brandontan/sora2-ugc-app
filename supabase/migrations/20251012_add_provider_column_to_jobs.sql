-- Migration: Add provider column to jobs table for multi-provider support
-- Date: 2025-10-12

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'fal';

-- Backfill any existing nulls just in case defaults did not apply
UPDATE public.jobs
SET provider = 'fal'
WHERE provider IS NULL;
