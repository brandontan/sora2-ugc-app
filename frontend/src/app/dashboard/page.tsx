"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { dicebearUrl } from "@/lib/profile";
import { getPricingSummary } from "@/lib/pricing";

type Job = {
  id: string;
  prompt: string;
  status: string;
  video_url: string | null;
  created_at: string;
  credit_cost: number;
};

const jobSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  status: z.string(),
  video_url: z.string().nullable(),
  created_at: z.string(),
  credit_cost: z.number(),
});

const jobsResponseSchema = z
  .array(jobSchema)
  .catch(() => [] satisfies Job[]);

const soraResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
});

const DEFAULT_CREDIT_COST = Number(
  process.env.NEXT_PUBLIC_SORA_CREDIT_COST ??
    process.env.SORA_CREDIT_COST ??
    5,
);

const ENV_DURATION_OPTIONS = (process.env
  .NEXT_PUBLIC_FAL_DURATION_OPTIONS?.split(",") || [])
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 5 && value <= 60);

const DURATION_OPTIONS =
  ENV_DURATION_OPTIONS.length > 0 ? ENV_DURATION_OPTIONS : [10, 20, 30];

export default function Dashboard() {
  const { supabase, session, loading, profile, profileLoading } = useSupabase();
  const router = useRouter();

  const [balance, setBalance] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const defaultDuration = DURATION_OPTIONS[1] ?? DURATION_OPTIONS[0];
  const [duration, setDuration] = useState<number>(defaultDuration);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [isFetching, setIsFetching] = useState(false);

  const isLowBalance = useMemo(() => {
    if (balance === null) return false;
    return balance < DEFAULT_CREDIT_COST;
  }, [balance]);

  const pricingSummary = useMemo(() => getPricingSummary(), []);
  const packLabel = `${pricingSummary.creditsPerPack.toFixed(0)}-credit pack`;
  const creatorName = profile?.display_name ?? "Creator";
  const avatarUrl = profile?.avatar_seed
    ? dicebearUrl(profile.avatar_seed, profile.avatar_style ?? undefined)
    : null;

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/");
    }
  }, [loading, session, router]);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!supabase || !session?.access_token) {
        throw new Error("Auth token missing.");
      }
      const headers = new Headers(init?.headers ?? {});
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
       if (init?.body && !headers.has("Content-Type")) {
         headers.set("Content-Type", "application/json");
       }
      return fetch(input, {
        ...init,
        headers,
      });
    },
    [supabase, session?.access_token],
  );

  const refreshBalance = useCallback(async () => {
    if (!supabase) return;
    const userId = session?.user?.id;
    if (!userId) return;
    setIsFetching(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("credit_ledger")
        .select("delta")
        .eq("user_id", userId);

      if (error || !data) {
        setBalance(null);
        setMessageTone("error");
        setMessage("Could not load credits. Try again soon.");
        return;
      }

      const ledgerRows = data as Array<{ delta?: number }>;
      const total = ledgerRows.reduce(
        (acc, row) => acc + Number(row.delta ?? 0),
        0,
      );
      setBalance(total);
    } finally {
      setIsFetching(false);
    }
  }, [session?.user?.id, supabase]);

  const refreshJobs = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("jobs")
      .select(
        "id,prompt,status,video_url,created_at,credit_cost,provider_job_id,user_id",
      )
      .eq("user_id", session?.user.id)
      .order("created_at", { ascending: false });

    if (error || !data) {
      setJobs([]);
      return;
    }

    const jobsData = data as Array<Record<string, unknown>>;
    const parsedList = jobsData.map((job) => ({
      id: typeof job.id === "string" ? job.id : crypto.randomUUID(),
      prompt: typeof job.prompt === "string" ? job.prompt : "",
      status: typeof job.status === "string" ? job.status : "queued",
      video_url:
        typeof job.video_url === "string" ? (job.video_url as string) : null,
      created_at:
        typeof job.created_at === "string"
          ? job.created_at
          : new Date().toISOString(),
      credit_cost:
        typeof job.credit_cost === "number"
          ? job.credit_cost
          : Number(job.credit_cost ?? DEFAULT_CREDIT_COST),
    }));
    const parsed = jobsResponseSchema.parse(parsedList);

    const upgraded = await Promise.all(
      parsed.map(async (job) => {
        if (job.status !== "processing") return job;
        try {
          const response = await authFetch(`/api/sora/jobs/${job.id}`);
          if (!response.ok) return job;
          const payload = await response.json();
          const result = jobSchema.safeParse(payload.job);
          return result.success ? result.data : job;
        } catch {
          return job;
        }
      }),
    );

    setJobs(upgraded);
  }, [authFetch, session?.user?.id, supabase]);

  useEffect(() => {
    if (!session || !supabase) return;
    void refreshBalance();
    void refreshJobs();
  }, [session, supabase, refreshBalance, refreshJobs]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      return;
    }

    const supportsRealtime =
      typeof (supabase as SupabaseClient).channel === "function";
    if (!supportsRealtime) {
      return;
    }

    const client = supabase as SupabaseClient;
    const userId = session.user.id;
    const balanceChannel = client
      .channel(`ledger:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "credit_ledger",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshBalance();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(balanceChannel);
    };
  }, [refreshBalance, session?.user?.id, supabase]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0];
    if (!candidate) return;
    if (!candidate.type.startsWith("image/")) {
      setMessageTone("error");
      setMessage("Only image files are supported for now.");
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      setMessageTone("error");
      setMessage("Image must be 10MB or less.");
      return;
    }
    setFile(candidate);
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    if (!file) {
      setMessageTone("error");
      setMessage("Upload a product shot first.");
      return;
    }
    if (!prompt.trim()) {
      setMessageTone("error");
      setMessage("Add a short prompt so Sora2 knows the style.");
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    if (!supabase) {
      setMessageTone("error");
      setMessage("Supabase client not ready. Refresh and try again.");
      setIsSubmitting(false);
      return;
    }

    const path = `${session.user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("product-uploads")
      .upload(path, file);

    if (uploadError) {
      setMessageTone("error");
      setMessage(uploadError.message);
      setIsSubmitting(false);
      return;
    }

    const response = await authFetch("/api/sora/jobs", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        assetPath: path,
        durationSeconds: duration,
      }),
    });

    if (!response.ok) {
      const { error } = await response.json().catch(() => ({
        error: { message: "Something went wrong." },
      }));
      setMessageTone("error");
      setMessage(error.message ?? "Unable to start generation.");
      setIsSubmitting(false);
      return;
    }

    const parsed = soraResponseSchema.parse(await response.json());

    setMessageTone("neutral");
    setMessage(
      `Job ${parsed.jobId.slice(0, 6)} queued. We’ll email you when the video is ready.`,
    );
    setPrompt("");
    setFile(null);
    setDuration(defaultDuration);
    const uploadInput = document.getElementById(
      "product-file",
    ) as HTMLInputElement | null;
    if (uploadInput) uploadInput.value = "";
    setIsSubmitting(false);
    await Promise.all([refreshBalance(), refreshJobs()]);
  };

  const handleCheckout = async () => {
    try {
      const response = await authFetch("/api/credits/checkout", {
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const reason =
          typeof payload?.error?.message === "string"
            ? payload.error.message
            : "Could not start checkout. Try again.";
        setMessageTone("error");
        setMessage(reason);
        return;
      }

      const data = await response.json();
      const url = z.string().url().parse(data.url);
      window.location.href = url;
    } catch {
      setMessageTone("error");
      setMessage("Network error starting checkout.");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="floating-ring -left-1/3 -top-44" />
      <div className="floating-ring right-[-30%] top-1/4" />
      <div className="floating-ring left-1/2 bottom-[-30%]" />

      <header className="relative z-30 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
          >
            <Sparkles className="h-5 w-5 text-primary" />
            GenVids Fast
          </button>
          <div className="flex items-center gap-3">
            {profileLoading ? (
              <div className="h-12 w-32 rounded-full border border-border/60 bg-muted/40" />
            ) : avatarUrl ? (
              <div className="flex items-center gap-3 rounded-full border border-border/70 px-4 py-2">
                <Image
                  src={avatarUrl}
                  alt={`${creatorName} avatar`}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full border border-border/40 bg-background object-cover"
                />
                <div className="leading-tight">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Creator ID</p>
                  <p className="text-sm font-semibold text-foreground">{creatorName}</p>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleCheckout}
              className="rounded-full border border-border/70 px-5 py-2 text-sm font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              Buy credits
            </button>
            <button
              type="button"
              onClick={() => supabase?.auth.signOut()}
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-20 mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-16">
        <section className="glass-surface rounded-[32px] border border-border/60 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Available credits</p>
              <p className="mt-1 text-5xl font-semibold text-foreground" data-testid="balance-value">
                {balance === null ? <span className="text-muted-foreground/60">--</span> : balance}
              </p>
              {isLowBalance ? (
                <p className="mt-1 text-xs text-amber-300">
                  Balance low. Top up before launching the next job.
                </p>
              ) : null}
            </div>
            <div className="space-y-1 text-right text-xs text-muted-foreground">
              <p>{packLabel} = {pricingSummary.runsPerPack.toFixed(0)} runs (~${pricingSummary.runPriceUsd.toFixed(2)} each)</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCheckout}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition hover:bg-primary/90"
            >
              Buy {packLabel}
            </button>
            <button
              type="button"
              onClick={refreshBalance}
              className="inline-flex items-center gap-2 rounded-full border border-border/70 px-6 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/60"
              disabled={isFetching}
            >
              {isFetching ? "Refreshing…" : "Refresh balance"}
            </button>
          </div>
        </section>

        <section className="grid gap-10 lg:grid-cols-[1.8fr_1fr]">
          <form onSubmit={handleSubmit} className="glass-surface rounded-[28px] border border-border/60 p-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Sora2 pipeline</p>
                <h2 className="text-2xl font-semibold text-foreground">Launch a generation</h2>
              </div>
              <p className="text-xs text-muted-foreground">Charged on submit • Auto refund if job fails</p>
            </div>

            <div className="mt-8 grid gap-6">
              <label className="text-sm text-muted-foreground">
                Product image
                <div className="mt-2 rounded-3xl border border-dashed border-border/70 bg-secondary/40 p-5">
                  <input
                    id="product-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUpload}
                    className="w-full cursor-pointer text-sm text-muted-foreground file:mr-4 file:rounded-full file:border-0 file:bg-primary/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground file:transition file:hover:bg-primary/30"
                  />
                  <p className="mt-2 text-xs text-muted-foreground/80">Max 10MB • JPG/PNG/WebP</p>
                </div>
              </label>

              <label className="text-sm text-muted-foreground">
                Prompt
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Creator unboxes product, shows 3 hero shots, ends with CTA overlay."
                  rows={4}
                  className="mt-2 w-full rounded-3xl border border-border/70 bg-secondary/40 px-5 py-4 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/40"
                />
              </label>

              <label className="text-sm text-muted-foreground">
                Video duration
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="mt-2 w-full rounded-3xl border border-border/70 bg-secondary/40 px-5 py-4 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/40"
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>{`${option} seconds`}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                disabled={isSubmitting || isLowBalance}
              >
                {isLowBalance ? "Add credits first" : isSubmitting ? "Queuing job…" : "Generate with Sora2"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrompt("");
                  setFile(null);
                  const uploadInput = document.getElementById("product-file") as HTMLInputElement | null;
                  if (uploadInput) uploadInput.value = "";
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 px-6 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
              >
                Reset
              </button>
            </div>

            {message && (
              <p
                className={`mt-5 text-sm ${
                  messageTone === "error" ? "text-red-400" : "text-primary"
                }`}
              >
                {message}
              </p>
            )}
          </form>

          <aside className="glass-surface rounded-[28px] border border-border/60 p-8">
            <h3 className="text-lg font-semibold text-foreground">Runbook</h3>
            <ul className="mt-5 space-y-4 text-sm text-muted-foreground">
              <li>• Credit ledger writes happen inside a single transaction with the job enqueue.</li>
              <li>
                • Policy failures stream back as <code>status: &quot;policy_blocked&quot;</code> and trigger refunds.
              </li>
              <li>• Signed download URLs expire after 24h; regenerate to refresh.</li>
              <li>• Automation secret seeds sessions for Playwright productions runs.</li>
            </ul>
            <button
              type="button"
              onClick={refreshJobs}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-border/70 px-5 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              Refresh jobs
            </button>
          </aside>
        </section>

        <section className="glass-surface rounded-[28px] border border-border/60 p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Activity</p>
              <h2 className="text-2xl font-semibold text-foreground">Recent jobs</h2>
            </div>
            <p className="text-xs text-muted-foreground">Latest 20 runs pulled directly from Supabase.</p>
          </div>

          <div className="mt-6 space-y-4">
            {jobs.length === 0 ? (
              <div className="rounded-3xl border border-border/60 bg-secondary/40 p-6 text-sm text-muted-foreground">
                No jobs yet. Launch your first Sora2 generation to populate this feed.
              </div>
            ) : (
              jobs.map((job) => {
                const createdAt = new Date(job.created_at).toLocaleString();
                const statusLabel = job.status.replace(/_/g, " ");
                const isComplete = job.status === "completed" && Boolean(job.video_url);
                return (
                  <div
                    key={job.id}
                    className="flex flex-col gap-4 rounded-3xl border border-border/70 bg-secondary/30 p-6 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-foreground">
                        {job.prompt.length > 110 ? `${job.prompt.slice(0, 110)}…` : job.prompt}
                      </p>
                      <p className="text-xs text-muted-foreground">{createdAt}</p>
                      <p className="text-xs text-muted-foreground">Credit cost: {job.credit_cost}</p>
                    </div>
                    <div className="flex flex-col gap-3 md:items-end">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                          job.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : job.status === "processing"
                              ? "bg-primary/15 text-primary"
                              : job.status === "policy_blocked"
                                ? "bg-red-500/15 text-red-300"
                                : "bg-border/40 text-muted-foreground"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      {isComplete ? (
                        <a
                          href={job.video_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow shadow-primary/30 transition hover:bg-primary/90"
                        >
                          Download MP4
                          <ArrowRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {job.status === "processing" ? "Sora2 is rendering…" : "Awaiting next update"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
