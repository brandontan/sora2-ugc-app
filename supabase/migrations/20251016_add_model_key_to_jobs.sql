-- Migration: Add model_key to jobs
-- Date: 2025-10-16

alter table public.jobs
  add column if not exists model_key text;
