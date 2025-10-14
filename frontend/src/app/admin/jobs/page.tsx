import { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { getServiceClient } from "@/lib/supabase/service-client";
import { AdminJobsDashboard } from "./page.client";

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  prompt: string | null;
  video_url: string | null;
  provider: string | null;
  provider_status: string | null;
  queue_position: number | null;
  provider_error: string | null;
  provider_last_checked: string | null;
  created_at: string;
  updated_at: string | null;
};

export const metadata: Metadata = {
  title: "Admin Jobs Dashboard",
};

const DEFAULT_LIMIT = 200;
const ALLOWED_EMAILS = (process.env.ADMIN_ALLOWED_EMAILS ?? "brandontan@gmail.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.length > 0);

export default async function AdminJobsPage() {
  noStore();

  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const authClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set() {
        return undefined;
      },
      remove() {
        return undefined;
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user?.email) {
    redirect("/");
  }

  const normalizedEmail = user.email.toLowerCase();
  if (!ALLOWED_EMAILS.includes(normalizedEmail)) {
    redirect("/");
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, user_id, status, prompt, video_url, provider, provider_status, queue_position, provider_error, provider_last_checked, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(DEFAULT_LIMIT);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="glass-surface rounded-2xl p-10 text-center shadow-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Admin Jobs Dashboard
          </h1>
          <p className="mt-6 text-base text-muted-foreground">
            Failed to load jobs from Supabase.
          </p>
          <code className="mt-6 inline-block rounded-lg bg-secondary/60 px-4 py-3 text-sm text-rose-400">
            {error.message}
          </code>
        </div>
      </div>
    );
  }

  const jobs: JobRow[] = (data ?? []).map((raw) => {
    const job = raw as Record<string, unknown>;
    const queuePositionRaw = job.queue_position;
    const queuePosition =
      typeof queuePositionRaw === "number"
        ? queuePositionRaw
        : typeof queuePositionRaw === "string" && queuePositionRaw.trim().length > 0
          ? Number.parseInt(queuePositionRaw, 10)
          : null;

    return {
      id: String(job.id ?? ""),
      user_id: String(job.user_id ?? ""),
      status: String(job.status ?? "unknown"),
      prompt: typeof job.prompt === "string" ? job.prompt : null,
      video_url: typeof job.video_url === "string" ? job.video_url : null,
      provider: typeof job.provider === "string" ? job.provider : null,
      provider_status:
        typeof job.provider_status === "string" ? job.provider_status : null,
      queue_position:
        typeof queuePosition === "number" && Number.isFinite(queuePosition)
          ? queuePosition
          : null,
      provider_error:
        typeof job.provider_error === "string" ? job.provider_error : null,
      provider_last_checked:
        typeof job.provider_last_checked === "string"
          ? job.provider_last_checked
          : null,
      created_at:
        typeof job.created_at === "string"
          ? job.created_at
          : new Date().toISOString(),
      updated_at:
        typeof job.updated_at === "string" && job.updated_at.length > 0
          ? job.updated_at
          : null,
    };
  });

  const generatedAt = new Date().toISOString();

  return (
    <AdminJobsDashboard
      jobs={jobs}
      generatedAt={generatedAt}
      limit={DEFAULT_LIMIT}
    />
  );
}
