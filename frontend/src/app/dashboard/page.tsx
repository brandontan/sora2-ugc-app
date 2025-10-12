"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import Image from "next/image";
import { ArrowRight, Loader2, Sparkles, Trash2 } from "lucide-react";
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
  provider_status?: string | null;
  queue_position?: number | null;
  provider_error?: string | null;
  provider_last_checked?: string | null;
  provider_logs?: string[] | null;
};

const jobSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  status: z.string(),
  video_url: z.string().nullable(),
  created_at: z.string(),
  credit_cost: z.number(),
  provider_status: z.string().nullable().optional(),
  queue_position: z.number().nullable().optional(),
  provider_error: z.string().nullable().optional(),
  provider_last_checked: z.string().nullable().optional(),
  provider_logs: z.array(z.string()).nullable().optional(),
});

const jobsResponseSchema = z
  .array(jobSchema)
  .catch(() => [] satisfies Job[]);

const soraResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  queuePosition: z.number().nullable().optional(),
  providerStatus: z.string().optional(),
  note: z.string().optional(),
  requestId: z.string().nullable().optional(),
});

const ENV_FAL_DURATION_OPTIONS = (process.env
  .NEXT_PUBLIC_FAL_DURATION_OPTIONS?.split(",") || [])
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 4 && value <= 60);

const FAL_DURATION_OPTIONS =
  ENV_FAL_DURATION_OPTIONS.length > 0 ? ENV_FAL_DURATION_OPTIONS : [4, 8, 12];

const PROVIDER_CONFIG = {
  fal: {
    value: "fal" as const,
    label: "fal.ai",
    helper: "Image-to-video with product shot placement.",
    durations: FAL_DURATION_OPTIONS as readonly number[],
    aspectRatios: ["16:9", "9:16"] as const,
    resolutions: ["auto", "720p", "1080p"] as const,
    slug: (model: "sora2" | "sora2-pro") =>
      model === "sora2-pro"
        ? "fal.ai/sora-2-pro/image-to-video"
        : "fal.ai/sora-2/image-to-video",
  },
  wavespeed: {
    value: "wavespeed" as const,
    label: "WaveSpeed.ai",
    helper: "Text-to-video tuned for permissive policy content.",
    durations: [4, 8, 12] as const,
    aspectRatios: ["16:9", "9:16", "1:1"] as const,
    sizesByAspect: {
      "16:9": ["1280*720"],
      "9:16": ["720*1280"],
      "1:1": ["720*720"],
    } as Record<"16:9" | "9:16" | "1:1", readonly string[]>,
    slug: () => "wavespeed.ai/openai/sora",
  },
} as const;

const PROVIDER_OPTIONS = [
  {
    value: PROVIDER_CONFIG.fal.value,
    label: PROVIDER_CONFIG.fal.label,
  },
  {
    value: PROVIDER_CONFIG.wavespeed.value,
    label: PROVIDER_CONFIG.wavespeed.label,
  },
] as const;

const MODEL_OPTIONS = [
  {
    value: "sora2",
    label: "Sora2",
    helper: "Balanced quality with faster queue times.",
  },
  {
    value: "sora2-pro",
    label: "Sora2 Pro",
    helper: "Sharper detail; allow extra render time.",
  },
] as const;

type AspectRatioOption = "16:9" | "9:16" | "1:1";
type ProviderKey = keyof typeof PROVIDER_CONFIG;

const MAX_PROMPT_LENGTH = 2000;

const DEFAULT_PROVIDER: ProviderKey = "fal";
const DEFAULT_ASPECT_RATIO: AspectRatioOption =
  PROVIDER_CONFIG[DEFAULT_PROVIDER].aspectRatios[0];

const formatRelativeTime = (iso: string | null | undefined): string => {
  if (!iso) return "just now";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "just now";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const describeProviderState = (job: Job | null): string | null => {
  if (!job?.provider_status) return null;
  const status = job.provider_status.toUpperCase();
  const checked = formatRelativeTime(job.provider_last_checked);
  const queuePosition =
    typeof job.queue_position === "number"
      ? job.queue_position
      : null;
  const providerError =
    typeof job.provider_error === "string" && job.provider_error.trim().length > 0
      ? job.provider_error.trim()
      : null;

  switch (status) {
    case "IN_QUEUE":
      if (queuePosition !== null) {
        return `In queue · position ${queuePosition} (checked ${checked})`;
      }
      return `In queue (checked ${checked})`;
    case "IN_PROGRESS":
      return `Rendering with provider (checked ${checked})`;
    case "COMPLETED":
      return `Provider finished (checked ${checked})`;
    case "FAILED":
      return providerError
        ? `Provider failed: ${providerError} (checked ${checked})`
        : `Provider reported a failure (checked ${checked})`;
    case "CANCELLATION_REQUESTED":
      return `Cancellation requested at provider (checked ${checked})`;
    default:
      return `Provider status: ${job.provider_status} (checked ${checked})`;
  }
};

export default function Dashboard() {
  const { supabase, session, loading, profile, profileLoading } = useSupabase();
  const router = useRouter();

  const [balance, setBalance] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderKey>(DEFAULT_PROVIDER);
  const [aspectRatio, setAspectRatio] =
    useState<AspectRatioOption>(DEFAULT_ASPECT_RATIO);
  const [duration, setDuration] = useState<number>(
    PROVIDER_CONFIG[DEFAULT_PROVIDER].durations[0],
  );
  const [model, setModel] =
    useState<(typeof MODEL_OPTIONS)[number]["value"]>(MODEL_OPTIONS[0].value);
  const [falResolution, setFalResolution] = useState<
    (typeof PROVIDER_CONFIG.fal.resolutions)[number]
  >(PROVIDER_CONFIG.fal.resolutions[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [isFetching, setIsFetching] = useState(false);
  const [productPreviewUrl, setProductPreviewUrl] = useState<string | null>(null);
  const [cancellingJobIds, setCancellingJobIds] = useState<Record<string, boolean>>({});

  const resetFormState = useCallback(() => {
    console.log("[dashboard] resetFormState invoked");
    setPrompt("");
    setFile(null);
    setProductPreviewUrl(null);
    setProvider(DEFAULT_PROVIDER);
    setDuration(PROVIDER_CONFIG[DEFAULT_PROVIDER].durations[0]);
    setAspectRatio(PROVIDER_CONFIG[DEFAULT_PROVIDER].aspectRatios[0]);
    setModel(MODEL_OPTIONS[0].value);
    setFalResolution(PROVIDER_CONFIG.fal.resolutions[0]);
    setMessage(null);
    setMessageTone("neutral");
    setIsSubmitting(false);
    setCancellingJobIds({});
    const uploadInput = document.getElementById(
      "product-file",
    ) as HTMLInputElement | null;
    if (uploadInput) uploadInput.value = "";
  }, []);

  const pricingSummary = useMemo(() => getPricingSummary(), []);
  const creditCostPerRun = pricingSummary.creditCostPerRun;
  const packLabel = `${pricingSummary.creditsPerPack} credits`;
  const perRunLabel = `${creditCostPerRun} credits/run`;

  const isLowBalance = useMemo(() => {
    if (balance === null) return false;
    return balance < creditCostPerRun;
  }, [balance, creditCostPerRun]);
  const creatorName = profile?.display_name ?? "Creator";
  const avatarUrl = profile?.avatar_seed
    ? dicebearUrl(profile.avatar_seed, profile.avatar_style ?? undefined)
    : null;

  const providerConfig = useMemo(() => PROVIDER_CONFIG[provider], [provider]);
  const isFalProvider = provider === "fal";

  const selectedModelLabel = useMemo(() => {
    const match = MODEL_OPTIONS.find((item) => item.value === model);
    return match?.label ?? "Sora2";
  }, [model]);

  useEffect(() => {
    const allowed = providerConfig.aspectRatios as readonly AspectRatioOption[];
    if (!allowed.includes(aspectRatio)) {
      setAspectRatio(allowed[0]);
    }
  }, [providerConfig, aspectRatio]);

  useEffect(() => {
    const allowedDurations = providerConfig.durations as readonly number[];
    if (!allowedDurations.includes(duration)) {
      setDuration(allowedDurations[0]);
    }
  }, [providerConfig, duration]);

  useEffect(() => {
    if (!isFalProvider && model !== "sora2") {
      setModel("sora2");
    }
  }, [isFalProvider, model]);

  useEffect(() => {
    if (provider === "fal") {
      const options = PROVIDER_CONFIG.fal.resolutions;
      if (!options.includes(falResolution)) {
        setFalResolution(options[0]);
      }
    }
  }, [provider, falResolution]);

  useEffect(() => {
    if (!file) {
      setProductPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setProductPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const featuredJob = useMemo(() => {
    if (!jobs.length) return null;
    const activeStatuses = new Set([
      "processing",
      "queued",
      "queueing",
      "pending",
      "submitted",
      "in_progress",
      "started",
    ]);

    const activeJob = jobs.find((job) => activeStatuses.has(job.status));
    if (activeJob) return activeJob;

    const completedJob = jobs.find(
      (job) => job.status === "completed" && Boolean(job.video_url),
    );
    if (completedJob) return completedJob;

    return null;
  }, [jobs]);

  const featuredVideoUrl = featuredJob?.video_url ?? null;
  const featuredVideoStatus = featuredJob
    ? ["cancelled", "cancelled_user", "failed", "policy_blocked"].includes(
        featuredJob.status,
      )
      ? null
      : featuredJob.status
    : null;
  const isFeaturedFinal = featuredJob
    ? ["completed", "failed", "cancelled", "cancelled_user", "policy_blocked"].includes(
        featuredJob.status,
      )
    : false;
  const isFeaturedCancellable = featuredJob ? !isFeaturedFinal : false;
  const isFeaturedCancelling = featuredJob
    ? Boolean(cancellingJobIds[featuredJob.id])
    : false;
  const featuredProviderSummary = describeProviderState(featuredJob);

  useEffect(() => {
    if (!loading && !session) {
      resetFormState();
      setBalance(null);
      setJobs([]);
      router.replace("/");
    }
  }, [loading, session, router, resetFormState]);

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
      .select("*")
      .eq("user_id", session?.user.id)
      .order("created_at", { ascending: false });

    if (error || !data) {
      setJobs([]);
      return;
    }

    const jobsData = data as Array<Record<string, unknown>>;
    console.log("[dashboard] refreshJobs", jobsData);
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
          : Number(job.credit_cost ?? creditCostPerRun),
      provider_status:
        typeof job.provider_status === "string"
          ? job.provider_status
          : null,
      queue_position:
        typeof job.queue_position === "number"
          ? job.queue_position
          : typeof job.queue_position === "string"
            ? Number.isNaN(Number.parseInt(job.queue_position, 10))
              ? null
              : Number.parseInt(job.queue_position, 10)
            : null,
      provider_error:
        typeof job.provider_error === "string" && job.provider_error.length > 0
          ? job.provider_error
          : null,
      provider_last_checked:
        typeof job.provider_last_checked === "string"
          ? job.provider_last_checked
          : null,
      provider_logs: Array.isArray(job.provider_logs)
        ? (job.provider_logs.filter((item) => typeof item === "string") as string[])
        : null,
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

    console.log("[dashboard] upgradedJobs", upgraded);
    setJobs(upgraded);
  }, [authFetch, creditCostPerRun, session?.user?.id, supabase]);

  const handleCancelJob = useCallback(
    async (jobId: string) => {
      console.log("[dashboard] handleCancelJob", { jobId });
      setCancellingJobIds((prev) => ({ ...prev, [jobId]: true }));
      try {
        const response = await authFetch(`/api/sora/jobs/${jobId}`, {
          method: "DELETE",
        });

        console.log("[dashboard] cancel response", {
          jobId,
          ok: response.ok,
          status: response.status,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          console.log("[dashboard] cancel error payload", payload);
          const reason =
            typeof payload?.error?.message === "string"
              ? payload.error.message
              : "Could not cancel the job. Try again.";
          setMessageTone("error");
          setMessage(reason);
          return;
        }

        const payload = await response.json().catch(() => null);
        console.log("[dashboard] cancel success payload", payload);
        const parsed = payload?.job ? jobSchema.safeParse(payload.job) : null;

        if (parsed?.success) {
          setJobs((prev) =>
            prev.map((job) => (job.id === jobId ? parsed.data : job)),
          );
        } else {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === jobId
                ? { ...job, status: "cancelled_user" }
                : job,
            ),
          );
        }

        setMessageTone("neutral");
        setMessage("Job cancelled. Credits stay reserved for this run.");
        await Promise.all([refreshBalance(), refreshJobs()]);
      } catch {
        setMessageTone("error");
        setMessage("Network error cancelling job.");
      } finally {
        setCancellingJobIds((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }
    },
    [authFetch, refreshBalance, refreshJobs],
  );

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

    const payload: Record<string, unknown> = {
      prompt,
      assetPath: path,
      durationSeconds: duration,
      aspectRatio,
      model,
      provider,
    };

    if (provider === "fal") {
      payload.resolution = falResolution;
    }
    if (provider === "wavespeed") {
      const sizesByAspect = PROVIDER_CONFIG.wavespeed.sizesByAspect;
      payload.size =
        sizesByAspect[aspectRatio]?.[0] ??
        sizesByAspect[PROVIDER_CONFIG.wavespeed.aspectRatios[0]][0];
    }

    const response = await authFetch("/api/sora/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
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
    const queueInfo =
      typeof parsed.queuePosition === "number"
        ? ` Queue spot ${parsed.queuePosition}.`
        : parsed.note
          ? ` ${parsed.note}`
          : parsed.providerStatus
            ? ` Provider ${parsed.providerStatus}.`
            : "";
    setMessage(
      `Job ${parsed.jobId.slice(0, 6)} ${parsed.status}.${queueInfo} We'll email when ready.`,
    );
    setPrompt("");
    setFile(null);
    const resetDuration = (providerConfig.durations as readonly number[])[0];
    const resetAspect =
      (providerConfig.aspectRatios as readonly AspectRatioOption[])[0];
    setDuration(resetDuration);
    setAspectRatio(resetAspect);
    if (provider === "fal") {
      setFalResolution(PROVIDER_CONFIG.fal.resolutions[0]);
    }
    const uploadInput = document.getElementById(
      "product-file",
    ) as HTMLInputElement | null;
    if (uploadInput) uploadInput.value = "";
    setIsSubmitting(false);
    void Promise.all([refreshBalance(), refreshJobs()]);
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
                  Balance below {creditCostPerRun} credits. Add credits before launching the next job.
                </p>
              ) : null}
            </div>
            <div className="space-y-1 text-right text-xs text-muted-foreground" />
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

        <section className="flex flex-col">
          <form
            onSubmit={handleSubmit}
            className="glass-surface rounded-[28px] border border-border/60 p-8"
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Sora2 pipeline
                  </p>
                  <h2 className="text-2xl font-semibold text-foreground">Launch a generation</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Charged on submit • Auto refund if job fails • {perRunLabel}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <div
                    className={`relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-[32px] border border-border/60 bg-secondary/40 shadow-lg shadow-primary/20 ${
                      aspectRatio === "16:9"
                        ? "aspect-video max-w-5xl"
                        : "aspect-[9/16] max-w-sm sm:max-w-md"
                    }`}
                  >
                    {featuredVideoUrl ? (
                      <video
                        key={featuredVideoUrl}
                        src={featuredVideoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : productPreviewUrl ? (
                      <Image
                        src={productPreviewUrl}
                        alt="Product preview"
                        fill
                        sizes="(min-width: 1024px) 800px, 100vw"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="rounded-full bg-primary/10 p-6">
                          <Sparkles className="h-10 w-10 text-primary" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Upload a product image and refine your prompt to preview the vibe.
                        </p>
                      </div>
                    )}

                    {isSubmitting ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-sm">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-xs text-muted-foreground">Queuing your job…</p>
                      </div>
                    ) : null}
                  </div>
                  {featuredVideoStatus ? (
                    <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground backdrop-blur">
                      {featuredVideoStatus.replace(/_/g, " ")}
                    </div>
                  ) : null}
                  {isFeaturedCancellable ? (
                    <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => featuredJob && handleCancelJob(featuredJob.id)}
                        disabled={isFeaturedCancelling}
                        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isFeaturedCancelling ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Cancelling…
                          </>
                        ) : (
                          "Cancel job"
                        )}
                      </button>
                      <span className="rounded-full bg-background/70 px-3 py-1 text-[0.65rem] text-muted-foreground">
                        Cancelling now keeps credits for this run.
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {featuredProviderSummary ? (
                <p className="text-xs text-muted-foreground">
                  {featuredProviderSummary}
                </p>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(340px,1.4fr)]">
                <div className="rounded-3xl border border-border/60 bg-secondary/40 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                        Product placement
                      </p>
                      <h3 className="text-lg font-semibold text-foreground">Upload product shot</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    PNG or JPG up to 10MB. We auto-crop and center in the video frame.
                  </p>

                    <div className="mt-6 flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-border/50 bg-background/50">
                      {productPreviewUrl ? (
                        <Image
                          src={productPreviewUrl}
                          alt="Selected product preview"
                          width={64}
                          height={64}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Sparkles className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>{file ? file.name : "No file selected"}</p>
                      <p>
                        {file
                          ? `${Math.round(file.size / 1024)} KB`
                          : "Drop a product mockup to get started."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <label
                      htmlFor="product-file"
                      className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                      Upload image
                      <input
                        id="product-file"
                        name="product-file"
                        className="hidden"
                        type="file"
                        accept="image/*"
                        onChange={handleUpload}
                      />
                    </label>
                    {file ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          setProductPreviewUrl(null);
                          const uploadInput = document.getElementById("product-file") as HTMLInputElement | null;
                          if (uploadInput) uploadInput.value = "";
                        }}
                        aria-label="Remove product image"
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label htmlFor="prompt" className="text-sm font-semibold text-foreground">
                      Prompt
                    </label>
                    <textarea
                      id="prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the scene, movement, camera notes, and product callouts."
                      rows={4}
                      maxLength={MAX_PROMPT_LENGTH}
                      className="mt-3 w-full rounded-3xl border border-border/70 bg-secondary/40 px-5 py-4 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/40"
                    />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>Describe every shot, movement, and cue—Sora thrives on detail.</span>
                      <span>{prompt.length}/{MAX_PROMPT_LENGTH}</span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                        Provider
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {PROVIDER_OPTIONS.map((option) => {
                          const isActive = provider === option.value;
                          return (
                            <button
                              type="button"
                              key={option.value}
                              onClick={() => setProvider(option.value)}
                              aria-pressed={isActive}
                              className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                isActive
                                  ? "border-primary/70 bg-primary/15 text-primary"
                                  : "border border-border/70 bg-secondary/50 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">{providerConfig.helper}</p>
                      {isFalProvider ? (
                        <div className="space-y-1">
                          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
                            Resolution
                          </p>
                          <select
                            value={falResolution}
                            onChange={(event) =>
                              setFalResolution(
                                event.target.value as (typeof PROVIDER_CONFIG.fal.resolutions)[number],
                              )
                            }
                            className="w-full rounded-2xl border border-border/70 bg-secondary/40 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground focus:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            {PROVIDER_CONFIG.fal.resolutions.map((option) => (
                              <option key={option} value={option}>
                                {option === "auto" ? "Auto (provider default)" : option}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                        Model
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {MODEL_OPTIONS.map((option) => {
                          const isActive = model === option.value;
                          const isDisabled = !isFalProvider && option.value === "sora2-pro";
                          return (
                            <button
                              type="button"
                              key={option.value}
                              onClick={() => {
                                if (!isDisabled) setModel(option.value);
                              }}
                              aria-pressed={isActive}
                              disabled={isDisabled}
                              className={`flex flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                isActive
                                  ? "border-primary/70 bg-primary/15 text-primary"
                                  : "border border-border/70 bg-secondary/50 text-muted-foreground hover:border-border hover:text-foreground"
                              } ${isDisabled ? "cursor-not-allowed opacity-40 hover:text-muted-foreground" : ""}`}
                            >
                              <span>{option.label}</span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {option.helper}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {!isFalProvider ? (
                        <p className="text-[0.65rem] text-muted-foreground">
                          Sora2 Pro is only available on fal.ai.
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                          Duration
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {(providerConfig.durations as readonly number[]).map((option) => {
                            const isActive = duration === option;
                            return (
                              <button
                                type="button"
                                key={option}
                                onClick={() => setDuration(option)}
                                aria-pressed={isActive}
                                className={`flex flex-col items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                  isActive
                                    ? "border-primary/70 bg-primary/15 text-primary"
                                    : "border border-border/70 bg-secondary/50 text-muted-foreground hover:border-border hover:text-foreground"
                                }`}
                              >
                                <span>{option}s</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                          Aspect ratio
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {(providerConfig.aspectRatios as readonly AspectRatioOption[]).map((option) => {
                            const isActive = aspectRatio === option;
                            return (
                              <button
                                type="button"
                                key={option}
                                onClick={() => setAspectRatio(option)}
                                aria-pressed={isActive}
                                className={`flex flex-col items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                  isActive
                                    ? "border-primary/70 bg-primary/15 text-primary"
                                    : "border border-border/70 bg-secondary/50 text-muted-foreground hover:border-border hover:text-foreground"
                                }`}
                              >
                                <span>{option}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-4">
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>Cost this run: {perRunLabel}</p>
                        <p>
                          Credits available:
                          {" "}
                          <span className="font-semibold text-foreground">
                            {balance === null ? "--" : balance}
                          </span>
                        </p>
                        {isLowBalance ? (
                          <p className="text-amber-300">
                            Balance below requirement. Add credits before launching the next job.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                          disabled={isSubmitting || isLowBalance}
                        >
                          {isLowBalance
                            ? `Add credits first (${perRunLabel})`
                            : isSubmitting
                              ? "Queuing job…"
                              : `Generate with ${selectedModelLabel}`}
                        </button>
                        <button
                          type="button"
                          onClick={resetFormState}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border/70 px-6 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>
                  {message ? (
                    <p
                      className={`text-sm ${
                        messageTone === "error" ? "text-red-400" : "text-primary"
                      }`}
                    >
                      {message}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </form>
        </section>

        <section className="glass-surface rounded-[28px] border border-border/60 p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Activity</p>
              <h2 className="text-2xl font-semibold text-foreground">Latest 5 runs</h2>
            </div>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground md:items-end">
              <p>Keep an eye on your most recent generations.</p>
              <button
                type="button"
                onClick={refreshJobs}
                className="inline-flex items-center gap-2 self-start rounded-full border border-border/70 px-5 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground md:self-auto"
              >
                Refresh jobs
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {jobs.length === 0 ? (
              <div className="rounded-3xl border border-border/60 bg-secondary/40 p-6 text-sm text-muted-foreground">
                No jobs yet. Launch your first Sora2 generation to populate this feed.
              </div>
            ) : (
              jobs.slice(0, 5).map((job) => {
                const createdAt = new Date(job.created_at).toLocaleString();
                const statusLabel =
                  job.status === "cancelled_user"
                    ? "cancelled"
                    : job.status.replace(/_/g, " ");
                const isComplete = job.status === "completed" && Boolean(job.video_url);
                const isFinalStatus =
                  job.status === "completed" ||
                  job.status === "failed" ||
                  job.status === "cancelled" ||
                  job.status === "cancelled_user" ||
                  job.status === "policy_blocked";
                const isCancellable = !isFinalStatus;
                const isCancelling = Boolean(cancellingJobIds[job.id]);
                const providerSummary = describeProviderState(job);
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
                      ) : isCancellable ? (
                        <div className="flex flex-col items-start gap-2 md:items-end">
                          <button
                            type="button"
                            onClick={() => handleCancelJob(job.id)}
                            disabled={isCancelling}
                            className="inline-flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isCancelling ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Cancelling…
                              </>
                            ) : (
                              "Cancel job"
                            )}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {providerSummary
                              ? providerSummary
                              : job.status === "processing"
                                ? "Rendering in provider—cancelling will still use the credits."
                                : "Queued today—cancelling keeps credits for this run."}
                          </span>
                        </div>
                      ) : job.status === "cancelled" ? (
                        <span className="text-xs text-muted-foreground">Cancelled. Credits returned.</span>
                      ) : job.status === "cancelled_user" ? (
                        <span className="text-xs text-muted-foreground">Cancelled early. Credits remain used.</span>
                      ) : job.status === "cancelled_user" ? (
                        <span className="text-xs text-muted-foreground">Cancelled early. Credits remain used.</span>
                      ) : job.status === "failed" ? (
                        <span className="text-xs text-muted-foreground">
                          Generation failed. Credits already refunded.
                          {job.provider_error
                            ? ` Provider note: ${job.provider_error}`
                            : ""}
                        </span>
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
