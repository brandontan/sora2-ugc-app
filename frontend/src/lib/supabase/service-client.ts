import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function sanitizeEnv(value: string | undefined) {
  if (!value) return value;
  const trimmed = value.trim();
  return trimmed.replace(/^"|"$/g, "");
}

export function getServiceClient() {
  if (cached) return cached;

  const url = sanitizeEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = sanitizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
