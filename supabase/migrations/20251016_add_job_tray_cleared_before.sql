-- Migration: Add job tray cleared timestamp to profiles
-- Date: 2025-10-16
-- Purpose: Persist dashboard clear-all state across sessions/devices.

alter table public.profiles
  add column if not exists job_tray_cleared_before timestamptz;
