"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useSupabase } from "@/components/providers/supabase-provider";

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
    15,
);

const ENV_DURATION_OPTIONS = (process.env
  .NEXT_PUBLIC_FAL_DURATION_OPTIONS?.split(",") || [])
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 5 && value <= 60);

const DURATION_OPTIONS =
  ENV_DURATION_OPTIONS.length > 0 ? ENV_DURATION_OPTIONS : [10, 20, 30];

export default function Dashboard() {
  const { supabase, session, loading } = useSupabase();
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
    return balance < 15;
  }, [balance]);

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
    if (!supabase || !session?.user?.id) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("credit_ledger")
      .select("delta")
      .eq("user_id", session?.user.id);

    if (error || !data) {
      setBalance(null);
      setMessageTone("error");
      setMessage("Could not load credits. Try again soon.");
      setIsFetching(false);
      return;
    }

    const ledgerRows = data as Array<{ delta?: number }>;
    const total = ledgerRows.reduce(
      (acc, row) => acc + Number(row.delta ?? 0),
      0,
    );
    setBalance(total);
    setIsFetching(false);
  }, [session?.user.id, supabase]);

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
        setMessageTone("error");
        setMessage("Could not start checkout. Try again.");
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
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-lg font-semibold tracking-tight"
          >
            GenVids Fast
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCheckout}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/80 hover:border-white hover:text-white"
            >
              Buy credits
            </button>
            <button
              type="button"
              onClick={() => supabase?.auth.signOut()}
              className="rounded-full bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-6 py-12">
        <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-semibold">Credit balance</h1>
              <p className="text-sm text-white/60">
                We stop runs if balance is below 15 credits. No surprise charges.
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/50">Available credits</p>
              <p
                className="text-4xl font-semibold text-white"
                data-testid="balance-value"
              >
                {balance === null ? (
                  <span className="text-white/40">--</span>
                ) : (
                  balance
                )}
              </p>
              {isLowBalance && (
                <p className="text-xs text-amber-300">
                  Balance low. Add credits before launching a new job.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCheckout}
              className="rounded-full bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400"
            >
              Buy 15-credit pack ($15)
            </button>
            <button
              type="button"
              onClick={refreshBalance}
              className="rounded-full border border-white/20 px-5 py-3 text-sm text-white/70 hover:border-white disabled:cursor-not-allowed disabled:text-white/40"
              disabled={isFetching}
            >
              {isFetching ? "Refreshing…" : "Refresh balance"}
            </button>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur"
          >
            <h2 className="text-xl font-semibold text-white">Launch a Sora2 job</h2>
            <p className="mt-2 text-sm text-white/60">
              Upload one product image and describe the scene. We charge 15 credits
              on submission and refund automatically if Sora2 fails.
            </p>

            <div className="mt-6 space-y-5">
              <label className="block text-sm text-white/70">
                Product image
                <input
                  id="product-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUpload}
                  className="mt-2 w-full rounded-2xl border border-dashed border-white/20 bg-slate-900 p-4 text-sm text-white outline-none transition hover:border-white/40 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
                />
              </label>

              <label className="block text-sm text-white/70">
                Prompt
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: TikTok creator shows product close-ups, upbeat voiceover, call to action in final frame."
                  rows={4}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
                />
              </label>

              <label className="block text-sm text-white/70">
                Video length
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>{`${option} seconds`}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-full bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                disabled={isSubmitting || isLowBalance}
              >
                {isLowBalance ? "Add credits first" : "Generate with Sora2"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrompt("");
                  setFile(null);
                  const uploadInput = document.getElementById(
                    "product-file",
                  ) as HTMLInputElement | null;
                  if (uploadInput) uploadInput.value = "";
                }}
                className="rounded-full border border-white/20 px-5 py-3 text-sm text-white/70 hover:border-white"
              >
                Reset
              </button>
            </div>

            {message && (
              <p
                className={`mt-4 text-sm ${
                  messageTone === "error" ? "text-red-400" : "text-sky-300"
                }`}
              >
                {message}
              </p>
            )}
          </form>

          <aside className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
            <h3 className="text-lg font-semibold text-white">Quick facts</h3>
            <ul className="mt-4 space-y-3 text-sm text-white/60">
              <li>• 480p output today, 720p staging later.</li>
              <li>• Retry automatically if Sora2 times out.</li>
              <li>• Ledger writes happen inside a single transaction.</li>
              <li>• Signed URLs expire after 24 hours for security.</li>
            </ul>
          </aside>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Recent jobs</h2>
            <button
              type="button"
              onClick={refreshJobs}
              className="text-xs text-white/60 hover:text-white"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {jobs.length === 0 ? (
              <p className="text-sm text-white/50">
                Jobs will appear here once you start generating.
              </p>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/60 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {job.prompt.slice(0, 80)}
                      {job.prompt.length > 80 ? "…" : ""}
                    </p>
                    <p className="text-xs text-white/40">
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs uppercase tracking-widest text-white/50">
                      {job.status}
                    </span>
                    {job.video_url ? (
                      <a
                        href={job.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/50">
                        Processing
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
