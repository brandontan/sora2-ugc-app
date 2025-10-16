"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type SyntheticEvent,
} from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import Image from "next/image";
import {
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  MinusCircle,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { dicebearUrl } from "@/lib/profile";
import { getPricingSummary } from "@/lib/pricing";

type Job = {
  id: string;
  prompt: string;
  status: string;
  video_url: string | null;
  created_at: string;
  updated_at: string | null;
  credit_cost: number;
  provider?: string | null;
  provider_status?: string | null;
  queue_position?: number | null;
  provider_error?: string | null;
  provider_last_checked?: string | null;
  provider_logs?: string[] | null;
};

const DISMISSED_JOBS_STORAGE_KEY = "dashboard.dismissedJobIds";
const HIDE_COMPLETED_BEFORE_STORAGE_KEY = "dashboard.hideCompletedBefore";

const jobSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  status: z.string(),
  video_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  credit_cost: z.number(),
  provider: z.string().nullable().optional(),
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

type AspectRatioOption = "16:9" | "9:16" | "1:1";
type AssetMode = "single" | "first_last" | "references" | "none";
type ModelKey =
  | "veo31_fast_image"
  | "veo31_fast_first_last"
  | "veo31_reference"
  | "sora2";

type ModelConfig = {
  value: ModelKey;
  label: string;
  helper?: string;
  assetMode: AssetMode;
  durations: readonly number[];
  aspectRatios?: readonly AspectRatioOption[];
  provider: string;
};

type AssetUploads = {
  primary?: File;
  firstFrame?: File;
  lastFrame?: File;
  references: File[];
};

type UploadedAssetPaths = {
  primary?: string;
  firstFrame?: string;
  lastFrame?: string;
  references: string[];
};

const MODEL_CONFIG: Record<ModelKey, ModelConfig> = {
  veo31_fast_image: {
    value: "veo31_fast_image",
    label: "Veo 3.1 Fast — Image → Video",
    helper: "Single hero shot to animated product.",
    assetMode: "single",
    durations: [8] as const,
    aspectRatios: ["16:9", "9:16", "1:1"] as const,
    provider: "fal",
  },
  veo31_fast_first_last: {
    value: "veo31_fast_first_last",
    label: "Veo 3.1 Fast — First & Last Frame",
    helper: "Define start & end beats for smooth motion.",
    assetMode: "first_last",
    durations: [8] as const,
    aspectRatios: ["16:9", "9:16", "1:1"] as const,
    provider: "fal",
  },
  veo31_reference: {
    value: "veo31_reference",
    label: "Veo 3.1 — Reference Gallery",
    helper: "Keep characters & products consistent.",
    assetMode: "references",
    durations: [8] as const,
    aspectRatios: [] as const,
    provider: "fal",
  },
  sora2: {
    value: "sora2",
    label: "Sora 2 — Image → Video",
    helper: "Balanced quality with fast turnaround.",
    assetMode: "single",
    durations: FAL_DURATION_OPTIONS as readonly number[],
    aspectRatios: ["16:9", "9:16"] as const,
    provider: "fal",
  },
};

const MODEL_ORDER: readonly ModelKey[] = [
  "veo31_fast_image",
  "veo31_fast_first_last",
  "sora2",
] as const;

const MODEL_OPTIONS = MODEL_ORDER.map((key) => MODEL_CONFIG[key]);
const DEFAULT_MODEL: ModelKey = MODEL_OPTIONS[0].value;
const DEFAULT_ASPECT_RATIO: AspectRatioOption =
  MODEL_CONFIG[DEFAULT_MODEL].aspectRatios?.[0] ?? "16:9";
type VideoAspectKind = "16:9" | "9:16" | "1:1";

const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 3;
const formatSizeKb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

const deriveAspectFromDimensions = (width: number, height: number): VideoAspectKind | null => {
  if (!width || !height) {
    return null;
  }
  const tolerance = Math.min(width, height) * 0.05;
  if (Math.abs(width - height) <= tolerance) {
    return "1:1";
  }
  return width >= height ? "16:9" : "9:16";
};

type CanonicalStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "user_cancelled"
  | "other";

const STATUS_CANONICAL_MAP: Record<string, CanonicalStatus> = {
  queued: "queued",
  queueing: "queued",
  processing: "processing",
  pending: "processing",
  submitted: "processing",
  in_progress: "processing",
  started: "processing",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  cancelled_user: "user_cancelled",
  policy_blocked: "failed",
};

const STATUS_DISPLAY_LABELS: Record<CanonicalStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  user_cancelled: "User Cancelled",
  other: "Other",
};

const FINAL_JOB_STATUSES = new Set<CanonicalStatus>([
  "completed",
  "failed",
  "cancelled",
  "user_cancelled",
]);

const ACTIVE_JOB_STATUSES = new Set<CanonicalStatus>([
  "processing",
  "queued",
]);

const normalizeStatus = (status: string): CanonicalStatus => {
  const normalized = status.toLowerCase();
  return STATUS_CANONICAL_MAP[normalized] ?? "other";
};
const isFinalStatus = (status: string) => FINAL_JOB_STATUSES.has(normalizeStatus(status));
const isActiveStatus = (status: string) => ACTIVE_JOB_STATUSES.has(normalizeStatus(status));
const isTrayStatus = (status: string) =>
  isActiveStatus(status) || isFinalStatus(status);

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
  const status = job?.provider_status?.toUpperCase() ?? null;
  const checked = formatRelativeTime(job?.provider_last_checked ?? null);
  const providerError =
    typeof job?.provider_error === "string" && job.provider_error.trim().length > 0
      ? job.provider_error.trim()
      : null;

  if (!status) return null;

  switch (status) {
    case "IN_QUEUE":
      return "In queue";
    case "IN_PROGRESS":
      return checked === "just now" ? "Rendering" : `Rendering (checked ${checked})`;
    case "COMPLETED":
      return checked === "just now" ? "Completed" : `Completed (checked ${checked})`;
    case "FAILED":
      return providerError
        ? `Failed: ${providerError}`
        : "Failed";
    case "CANCELLATION_REQUESTED":
      return "Cancellation requested";
    default:
      return job?.provider_status ?? null;
  }
};

export default function Dashboard() {
  const { supabase, session, loading, profile, profileLoading, isAdmin } = useSupabase();
  const router = useRouter();

  const [balance, setBalance] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assetUploads, setAssetUploads] = useState<AssetUploads>({
    references: [],
  });
  const [assetUploadKey, setAssetUploadKey] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ModelKey>(DEFAULT_MODEL);
  const [aspectRatio, setAspectRatio] =
    useState<AspectRatioOption>(DEFAULT_ASPECT_RATIO);
  const [duration, setDuration] = useState<number>(
    MODEL_CONFIG[DEFAULT_MODEL].durations[0],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [isFetching, setIsFetching] = useState(false);
  const [productPreviewUrl, setProductPreviewUrl] = useState<string | null>(null);
  const [cancellingJobIds, setCancellingJobIds] = useState<Record<string, boolean>>({});
  const [downloadingJobIds, setDownloadingJobIds] = useState<Record<string, boolean>>({});
  const [focusedJobId, setFocusedJobId] = useState<string | null | undefined>(
    undefined,
  );
  const [jobAspectRatios, setJobAspectRatios] = useState<Record<string, VideoAspectKind>>({});
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hideCompletedBefore, setHideCompletedBefore] = useState<string | null>(null);
  const [dismissedJobsHydrated, setDismissedJobsHydrated] = useState(false);
  const resetFormState = useCallback(() => {
    console.log("[dashboard] resetFormState invoked");
    setPrompt("");
    setAssetUploads({ references: [] });
    setAssetUploadKey((key) => key + 1);
    setProductPreviewUrl(null);
    const defaultModelConfig = MODEL_CONFIG[DEFAULT_MODEL];
    setModel(DEFAULT_MODEL);
    setDuration(defaultModelConfig.durations[0]);
    setAspectRatio(
      defaultModelConfig.aspectRatios?.[0] ?? DEFAULT_ASPECT_RATIO,
    );
    setMessage(null);
    setMessageTone("neutral");
    setIsSubmitting(false);
    setCancellingJobIds({});
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

  const modelConfig = MODEL_CONFIG[model];
  const { durations, aspectRatios: modelAspectRatios, provider: modelProvider, assetMode } = modelConfig;
  const aspectRatioOptions = modelAspectRatios ?? [];
  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const firstFrameInputRef = useRef<HTMLInputElement | null>(null);
  const lastFrameInputRef = useRef<HTMLInputElement | null>(null);
  const referencesInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModelLabel = useMemo(() => {
    const match = MODEL_OPTIONS.find((item) => item.value === model);
    return match?.label ?? "Sora";
  }, [model]);

  useEffect(() => {
    const allowedDurations = durations;
    if (!allowedDurations.includes(duration)) {
      setDuration(allowedDurations[0]);
    }
  }, [durations, duration]);

  useEffect(() => {
    const allowed = modelAspectRatios;
    if (!allowed || allowed.length === 0) {
      return;
    }
    if (!allowed.includes(aspectRatio)) {
      setAspectRatio(allowed[0]);
    }
  }, [modelAspectRatios, aspectRatio]);

  useEffect(() => {
    setAssetUploads({ references: [] });
    setAssetUploadKey((key) => key + 1);
    if (primaryInputRef.current) primaryInputRef.current.value = "";
    if (firstFrameInputRef.current) firstFrameInputRef.current.value = "";
    if (lastFrameInputRef.current) lastFrameInputRef.current.value = "";
    if (referencesInputRef.current) referencesInputRef.current.value = "";

    setMessage(null);
    setMessageTone("neutral");

    if (durations.length > 0) {
      setDuration(durations[0]);
    }
    if (modelAspectRatios && modelAspectRatios.length > 0) {
      setAspectRatio(modelAspectRatios[0]);
    }
  }, [assetMode, durations, modelAspectRatios, modelConfig.value]);

  useEffect(() => {
    if (dismissedJobsHydrated) return;
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(DISMISSED_JOBS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const ids = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
          if (ids.length > 0) {
            setDismissedJobIds(new Set(ids));
          }
        }
      }

      const hideBeforeValue = window.localStorage.getItem(
        HIDE_COMPLETED_BEFORE_STORAGE_KEY,
      );
      if (hideBeforeValue && typeof hideBeforeValue === "string") {
        setHideCompletedBefore(hideBeforeValue);
      }
    } catch (error) {
      console.warn("[dashboard] failed to load dismissed job ids", error);
    } finally {
      setDismissedJobsHydrated(true);
    }
  }, [dismissedJobsHydrated]);

  useEffect(() => {
    if (!dismissedJobsHydrated) return;
    if (typeof window === "undefined") return;

    if (dismissedJobIds.size === 0) {
      window.localStorage.removeItem(DISMISSED_JOBS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        DISMISSED_JOBS_STORAGE_KEY,
        JSON.stringify(Array.from(dismissedJobIds)),
      );
    }

    if (hideCompletedBefore) {
      window.localStorage.setItem(
        HIDE_COMPLETED_BEFORE_STORAGE_KEY,
        hideCompletedBefore,
      );
    } else {
      window.localStorage.removeItem(HIDE_COMPLETED_BEFORE_STORAGE_KEY);
    }
  }, [dismissedJobIds, dismissedJobsHydrated, hideCompletedBefore]);

  useEffect(() => {
    if (!dismissedJobsHydrated) return;
    const clearedAt = profile?.job_tray_cleared_before ?? null;
    if (!clearedAt) return;
    if (!hideCompletedBefore) {
      setHideCompletedBefore(clearedAt);
      return;
    }
    const current = Date.parse(hideCompletedBefore);
    const profileValue = Date.parse(clearedAt);
    if (Number.isNaN(profileValue)) return;
    if (Number.isNaN(current) || profileValue > current) {
      setHideCompletedBefore(clearedAt);
    }
  }, [dismissedJobsHydrated, hideCompletedBefore, profile?.job_tray_cleared_before]);

  useEffect(() => {
    if (!dismissedJobsHydrated) return;
    if (dismissedJobIds.size === 0) return;
    if (jobs.length === 0) return;

    let mutated = false;
    const next = new Set(dismissedJobIds);

    for (const id of dismissedJobIds) {
      const job = jobs.find((item) => item.id === id);
      if (!job) {
        next.delete(id);
        mutated = true;
      }
    }

    if (mutated) {
      setDismissedJobIds(next);
    }
  }, [jobs, dismissedJobIds, dismissedJobsHydrated]);

  const previewSource = useMemo(() => {
    if (assetUploads.primary) return assetUploads.primary;
    if (assetUploads.firstFrame) return assetUploads.firstFrame;
    if (assetUploads.references.length > 0) {
      return assetUploads.references[0];
    }
    if (assetUploads.lastFrame) return assetUploads.lastFrame;
    return null;
  }, [
    assetUploads.primary,
    assetUploads.firstFrame,
    assetUploads.lastFrame,
    assetUploads.references,
  ]);

  useEffect(() => {
    if (!previewSource) {
      setProductPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(previewSource);
    setProductPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [previewSource]);

  const previewMeta = useMemo(() => {
    if (!previewSource) return null;
    return {
      name: previewSource.name,
      sizeLabel: formatSizeKb(previewSource.size),
    };
  }, [previewSource]);

  const uploadPlaceholder = useMemo(() => {
    switch (assetMode) {
      case "single":
        return "Drop a product mockup to get started.";
      case "first_last":
        return "Provide opening and closing frames.";
      case "references":
        return "Add reference stills for consistent looks.";
      default:
        return "Upload assets to get started.";
    }
  }, [assetMode]);

  const isJobDismissed = useCallback(
    (job: Job): boolean => {
      if (dismissedJobIds.has(job.id)) {
        return true;
      }
      if (
        isFinalStatus(job.status) &&
        hideCompletedBefore &&
        (() => {
          const jobTimestamp = Date.parse(job.updated_at ?? job.created_at ?? "");
          const hideTimestamp = Date.parse(hideCompletedBefore);
          if (Number.isNaN(hideTimestamp)) return false;
          if (Number.isNaN(jobTimestamp)) return false;
          return jobTimestamp <= hideTimestamp;
        })()
      ) {
        return true;
      }
      return false;
    },
    [dismissedJobIds, hideCompletedBefore],
  );

  const trayJobs = useMemo(
    () => jobs.filter((job) => isTrayStatus(job.status) && !isJobDismissed(job)),
    [jobs, isJobDismissed],
  );

  useEffect(() => {
    if (focusedJobId && !jobs.some((job) => job.id === focusedJobId)) {
      setFocusedJobId(undefined);
    }
  }, [focusedJobId, jobs]);

  useEffect(() => {
    if (focusedJobId !== undefined) return;
    const nextJob = trayJobs[0] ?? null;
    setFocusedJobId(nextJob ? nextJob.id : null);
  }, [focusedJobId, trayJobs]);

  const featuredJob = useMemo(() => {
    if (!focusedJobId) return null;
    return jobs.find((job) => job.id === focusedJobId) ?? null;
  }, [focusedJobId, jobs]);

  const jobTrayItems = useMemo(() => {
    const prioritized = [...trayJobs];
    const seen = new Set<string>();
    const result: Job[] = [];
    for (const job of prioritized) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      result.push(job);
      if (result.length >= 6) break;
    }
    return result;
  }, [trayJobs]);

  const handleClearAllJobs = useCallback(() => {
    if (trayJobs.length === 0) return;

    const finalJobs = trayJobs.filter((job) => isFinalStatus(job.status));
    const nowIso = new Date().toISOString();
    setHideCompletedBefore(nowIso);

    const removableIds = finalJobs.map((job) => job.id);

    if (removableIds.length === 0) {
      return;
    }

    const removableSet = new Set(removableIds);

    setDismissedJobIds((prev) => {
      const next = new Set(prev);
      removableSet.forEach((id) => next.add(id));
      return next;
    });

    setFocusedJobId((current) => {
      if (!current) return current;
      return removableSet.has(current) ? null : current;
    });

    if (supabase && session?.user?.id) {
      const client = supabase as SupabaseClient;
      const updatePromise = client
        .from("profiles")
        .update({ job_tray_cleared_before: nowIso })
        .eq("id", session.user.id);

      updatePromise.then(
        (result) => {
          if (result.error) {
            console.warn("dashboard: failed to persist job tray clear", result.error);
          }
        },
        (error) => {
          console.warn("dashboard: persist clear threw", error);
        },
      );
    }
  }, [trayJobs, supabase, session?.user?.id]);

  const featuredVideoUrl = featuredJob?.video_url ?? null;
  const featuredJobAspect = featuredJob ? jobAspectRatios[featuredJob.id] ?? null : null;
  const featuredCanonicalStatus = featuredJob
    ? normalizeStatus(featuredJob.status)
    : null;
  const previewAspectClass = featuredVideoUrl && featuredJobAspect
    ? featuredJobAspect === "9:16"
      ? "aspect-[9/16] max-w-sm sm:max-w-md"
      : featuredJobAspect === "1:1"
        ? "aspect-square max-w-sm sm:max-w-md"
        : "aspect-video max-w-5xl"
    : aspectRatio === "9:16"
      ? "aspect-[9/16] max-w-sm sm:max-w-md"
      : aspectRatio === "1:1"
        ? "aspect-square max-w-sm sm:max-w-md"
        : "aspect-video max-w-5xl";
  const isFeaturedFinal = featuredJob ? isFinalStatus(featuredJob.status) : false;
  const featuredVideoStatus = featuredCanonicalStatus
    ? isFeaturedFinal && featuredCanonicalStatus !== "completed"
      ? null
      : STATUS_DISPLAY_LABELS[featuredCanonicalStatus]
    : null;
  const isFeaturedCancellable = featuredJob ? !isFinalStatus(featuredJob.status) : false;
  const isFeaturedCancelling = featuredJob
    ? Boolean(cancellingJobIds[featuredJob.id])
    : false;
  const featuredProviderSummary = describeProviderState(featuredJob);

  useEffect(() => {
    setJobAspectRatios((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      const activeJobIds = new Set(jobs.map((job) => job.id));
      let mutated = false;
      const next: Record<string, VideoAspectKind> = {};
      for (const [jobId, ratio] of Object.entries(previous)) {
        if (activeJobIds.has(jobId)) {
          next[jobId] = ratio;
        } else {
          mutated = true;
        }
      }
      if (!mutated && Object.keys(next).length === Object.keys(previous).length) {
        return previous;
      }
      return next;
    });
  }, [jobs]);

  const handleVideoMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      if (!featuredJob) return;
      const { videoWidth, videoHeight } = event.currentTarget;
      if (!videoWidth || !videoHeight) return;
      const detectedAspect = deriveAspectFromDimensions(videoWidth, videoHeight);
      if (!detectedAspect) return;
      setJobAspectRatios((previous) => {
        const current = previous[featuredJob.id];
        if (current === detectedAspect) {
          return previous;
        }
        return {
          ...previous,
          [featuredJob.id]: detectedAspect,
        };
      });
    },
    [featuredJob],
  );

  useEffect(() => {
    if (!featuredJob || !featuredVideoUrl) return;
    if (jobAspectRatios[featuredJob.id]) return;

    let isCancelled = false;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.src = featuredVideoUrl;

    const handleMetadata = () => {
      if (isCancelled) return;
      const detectedAspect = deriveAspectFromDimensions(
        probe.videoWidth,
        probe.videoHeight,
      );
      if (!detectedAspect) return;
      setJobAspectRatios((previous) => {
        const current = previous[featuredJob.id];
        if (current === detectedAspect) {
          return previous;
        }
        return {
          ...previous,
          [featuredJob.id]: detectedAspect,
        };
      });
    };

    probe.addEventListener("loadedmetadata", handleMetadata);
    probe.load();

    return () => {
      isCancelled = true;
      probe.removeEventListener("loadedmetadata", handleMetadata);
      // Prevent extra network usage
      probe.src = "";
    };
  }, [featuredJob, featuredVideoUrl, jobAspectRatios]);

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
      updated_at:
        typeof job.updated_at === "string"
          ? job.updated_at
          : typeof job.created_at === "string"
            ? job.created_at
            : new Date().toISOString(),
      credit_cost:
        typeof job.credit_cost === "number"
          ? job.credit_cost
          : Number(job.credit_cost ?? creditCostPerRun),
      provider:
        typeof job.provider === "string"
          ? job.provider
          : null,
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
    const sanitizedJobs = upgraded.map((job) => ({
      ...job,
      updated_at: job.updated_at ?? job.created_at,
    }));
    setJobs(sanitizedJobs);
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
          const sanitizedJob = {
            ...parsed.data,
            updated_at: parsed.data.updated_at ?? parsed.data.created_at,
          };
          setJobs((prev) =>
            prev.map((job) => (job.id === jobId ? sanitizedJob : job)),
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


        if (focusedJobId === jobId) {
          setFocusedJobId(undefined);
        }
        setDismissedJobIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });

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
    [authFetch, focusedJobId, refreshBalance, refreshJobs],
  );

  const handleDownloadJob = useCallback(async (job: Job) => {
    if (!job.video_url) return;
    let shouldSkip = false;
    setDownloadingJobIds((prev) => {
      if (prev[job.id]) {
        shouldSkip = true;
        return prev;
      }
      return { ...prev, [job.id]: true };
    });
    if (shouldSkip) return;
    setMessage(null);
    setMessageTone("neutral");
    try {
      const response = await fetch(job.video_url, {
        mode: "cors",
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      const contentType = response.headers.get("content-type") ?? "";
      const extension = contentType.includes("webm")
        ? "webm"
        : contentType.includes("quicktime")
          ? "mov"
          : contentType.includes("mpeg")
            ? "mpg"
            : contentType.includes("mp4")
              ? "mp4"
              : "mp4";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `sora-job-${job.id}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("[dashboard] download failed", { jobId: job.id, error });
      setMessageTone("error");
      setMessage("Could not download video. Try again in a minute.");
    } finally {
      setDownloadingJobIds((prev) => {
        const next = { ...prev };
        delete next[job.id];
        return next;
      });
    }
  }, []);

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

  const setValidationError = useCallback((message: string) => {
    setMessageTone("error");
    setMessage(message);
  }, []);

  const validateImageFile = useCallback((candidate: File): string | null => {
    if (!candidate.type.startsWith("image/")) {
      return "Only image files are supported for now.";
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      return "Image must be 10MB or less.";
    }
    return null;
  }, []);

  const handleSingleAssetChange = useCallback(
    (key: "primary" | "firstFrame" | "lastFrame") =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const candidate = event.target.files?.[0];
        if (!candidate) return;
        const validationError = validateImageFile(candidate);
        if (validationError) {
          setValidationError(validationError);
          event.target.value = "";
          return;
        }
        setAssetUploads((prev) => ({
          ...prev,
          [key]: candidate,
        }));
        setMessage(null);
        setMessageTone("neutral");
        event.target.value = "";
      },
    [validateImageFile, setValidationError],
  );

  const handleReferencesChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const candidates = Array.from(event.target.files ?? []);
      if (candidates.length === 0) return;

      const validated: File[] = [];
      for (const candidate of candidates) {
        const validationError = validateImageFile(candidate);
        if (validationError) {
          setValidationError(validationError);
          event.target.value = "";
          return;
        }
        validated.push(candidate);
      }

      setAssetUploads((prev) => {
        const combined = [...prev.references, ...validated];
        if (combined.length > MAX_REFERENCE_IMAGES) {
          setValidationError(
            `You can attach up to ${MAX_REFERENCE_IMAGES} reference images.`,
          );
        }
        return {
          ...prev,
          references: combined.slice(0, MAX_REFERENCE_IMAGES),
        };
      });
      setMessage(null);
      setMessageTone("neutral");
      event.target.value = "";
    },
    [validateImageFile, setValidationError],
  );

  const clearAsset = useCallback(
    (key: "primary" | "firstFrame" | "lastFrame") => {
      setAssetUploads((prev) => ({
        ...prev,
        [key]: undefined,
      }));
      const refMap = {
        primary: primaryInputRef,
        firstFrame: firstFrameInputRef,
        lastFrame: lastFrameInputRef,
      } as const;
      const ref = refMap[key];
      if (ref.current) {
        ref.current.value = "";
      }
      setMessage(null);
      setMessageTone("neutral");
    },
    [primaryInputRef, firstFrameInputRef, lastFrameInputRef],
  );

  const removeReferenceAt = useCallback((index: number) => {
    setAssetUploads((prev) => ({
      ...prev,
      references: prev.references.filter((_, idx) => idx !== index),
    }));
    setMessage(null);
    setMessageTone("neutral");
  }, []);

  const renderFrameUpload = (
    key: "firstFrame" | "lastFrame",
    label: string,
    file: File | undefined,
    ref: React.MutableRefObject<HTMLInputElement | null>,
  ) => (
    <div className="rounded-3xl border border-border/60 bg-secondary/20 p-4">
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">{label}</p>
        <p>
          {file
            ? `${file.name} · ${formatSizeKb(file.size)}`
            : `Select the ${label.toLowerCase()} still.`}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
          Upload {label.toLowerCase()}
          <input
            ref={ref}
            key={`${key}-${assetUploadKey}`}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={handleSingleAssetChange(key)}
          />
        </label>
        {file ? (
          <button
            type="button"
            onClick={() => clearAsset(key)}
            aria-label={`Remove ${label.toLowerCase()} image`}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    if (!prompt.trim()) {
      setMessageTone("error");
      setMessage("Add a short prompt so Sora knows the style.");
      return;
    }

    const assetRequirements: Array<{
      key: "primary" | "firstFrame" | "lastFrame" | "references";
      files: File[];
    }> = [];

    switch (assetMode) {
      case "single":
        if (!assetUploads.primary) {
          setValidationError("Upload a product shot first.");
          return;
        }
        assetRequirements.push({
          key: "primary",
          files: [assetUploads.primary],
        });
        break;
      case "first_last":
        if (!assetUploads.firstFrame || !assetUploads.lastFrame) {
          setValidationError(
            "Provide both a first frame and a last frame image.",
          );
          return;
        }
        assetRequirements.push({
          key: "firstFrame",
          files: [assetUploads.firstFrame],
        });
        assetRequirements.push({
          key: "lastFrame",
          files: [assetUploads.lastFrame],
        });
        break;
      case "references":
        if (assetUploads.references.length === 0) {
          setValidationError("Add at least one reference image.");
          return;
        }
        assetRequirements.push({
          key: "references",
          files: assetUploads.references,
        });
        break;
      case "none":
        break;
    }

    setIsSubmitting(true);
    setMessage(null);

    if (!supabase) {
      setMessageTone("error");
      setMessage("Supabase client not ready. Refresh and try again.");
      setIsSubmitting(false);
      return;
    }

    const uploadedPaths: UploadedAssetPaths = { references: [] };

    try {
      for (const requirement of assetRequirements) {
        for (const [index, candidate] of requirement.files.entries()) {
          const uniqueSuffix =
            typeof globalThis.crypto !== "undefined" &&
            typeof globalThis.crypto.randomUUID === "function"
              ? globalThis.crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const path = `${session.user.id}/${uniqueSuffix}-${requirement.key}-${index}-${candidate.name}`;
          const { error: uploadError } = await supabase.storage
            .from("product-uploads")
            .upload(path, candidate);

          if (uploadError) {
            throw new Error(uploadError.message);
          }

          if (requirement.key === "references") {
            uploadedPaths.references.push(path);
          } else {
            uploadedPaths[requirement.key] = path;
          }
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to upload assets. Try again.";
      setValidationError(message);
      setIsSubmitting(false);
      return;
    }

    const payload: Record<string, unknown> = {
      prompt,
      durationSeconds: duration,
      model,
    };

    const assetsPayload: Record<string, unknown> = {};
    if (uploadedPaths.primary) {
      assetsPayload.primary = uploadedPaths.primary;
    }
    if (uploadedPaths.firstFrame) {
      assetsPayload.firstFrame = uploadedPaths.firstFrame;
    }
    if (uploadedPaths.lastFrame) {
      assetsPayload.lastFrame = uploadedPaths.lastFrame;
    }
    if (uploadedPaths.references.length > 0) {
      assetsPayload.references = uploadedPaths.references;
    }
    if (Object.keys(assetsPayload).length > 0) {
      payload.assets = assetsPayload;
      const legacyPath =
        uploadedPaths.primary ??
        uploadedPaths.firstFrame ??
        uploadedPaths.references[0] ??
        uploadedPaths.lastFrame;
      if (legacyPath) {
        payload.assetPath = legacyPath;
      }
    }

    if (modelConfig.aspectRatios && modelConfig.aspectRatios.length > 0) {
      payload.aspectRatio = aspectRatio;
    }
    payload.provider = modelProvider;

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

    const { jobId } = soraResponseSchema.parse(await response.json());

    setMessageTone("neutral");
    setMessage(null);
    setFocusedJobId(jobId);
    resetFormState();
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
            {isAdmin ? (
              <button
                type="button"
                onClick={() => router.push("/admin/jobs")}
                className="rounded-full border border-primary/50 px-4 py-2 text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/10 hover:text-white"
              >
                Admin jobs
              </button>
            ) : null}
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
                    Sora pipeline
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
                    className={`relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-[32px] border border-border/60 bg-secondary/40 shadow-lg shadow-primary/20 ${previewAspectClass}`}
                  >
                    {featuredVideoUrl ? (
                      <video
                        key={featuredVideoUrl}
                        src={featuredVideoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        crossOrigin="anonymous"
                        onLoadedMetadata={handleVideoMetadata}
                        className="h-full w-full object-contain"
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
                      {featuredVideoStatus}
                    </div>
                  ) : null}
                </div>
              </div>

              {featuredJob ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                      Background job
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Move this run to the tray while you set up the next generation.
                    </span>
                    {isFeaturedCancellable ? (
                      <span className="text-[0.65rem] text-muted-foreground">
                        Cancelling now keeps credits for this run.
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFocusedJobId(null)}
                      className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                    >
                      Send to tray
                    </button>
                    {isFeaturedCancellable ? (
                      <button
                        type="button"
                        onClick={() => featuredJob && handleCancelJob(featuredJob.id)}
                        disabled={isFeaturedCancelling}
                        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isFeaturedCancelling ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Cancelling…
                          </>
                        ) : (
                          "Cancel run"
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {jobTrayItems.length > 0 ? (
                <div className="mt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                      Job tray
                    </p>
                    <button
                      type="button"
                      onClick={handleClearAllJobs}
                      className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:border-border hover:text-foreground"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {jobTrayItems.map((job) => {
                      const isFocused = featuredJob?.id === job.id && focusedJobId !== null;
                      const canonicalStatus = normalizeStatus(job.status);
                      const isCompleted = canonicalStatus === "completed";
                      const jobFinal = isFinalStatus(job.status);
                      const jobCancelling = Boolean(cancellingJobIds[job.id]);
                      const jobDownloading = Boolean(downloadingJobIds[job.id]);
                      const jobProviderSummary = describeProviderState(job);
                      const statusLabel =
                        STATUS_DISPLAY_LABELS[canonicalStatus] ??
                        job.status.replace(/_/g, " ");
                      const cardWidthClass = "sm:w-72";
                      const cardBorderClass = isFocused
                        ? "border-primary/60 shadow-primary/20"
                        : "border-border/70";
                      const cardBgClass = "bg-secondary/40 hover:bg-secondary/50 transition";

                      const handlePreview = () => {
                        setFocusedJobId(job.id);
                      };

                      const handleClearJob = () => {
                        setDismissedJobIds((prev) => {
                          const next = new Set(prev);
                          next.add(job.id);
                          return next;
                        });
                        if (focusedJobId === job.id) {
                          setFocusedJobId(null);
                        }
                      };

                      return (
                        <div
                          key={job.id}
                          onClick={() => setFocusedJobId(job.id)}
                          className={`flex w-full cursor-pointer flex-col gap-3 rounded-2xl border ${cardBgClass} ${cardBorderClass} ${cardWidthClass} p-4 text-left shadow-sm`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            {(() => {
                              const variant: "success" | "processing" | "error" | "muted" =
                                canonicalStatus === "completed"
                                  ? "success"
                                  : canonicalStatus === "processing" || canonicalStatus === "queued"
                                    ? "processing"
                                    : canonicalStatus === "failed"
                                      ? "error"
                                      : "muted";
                              const variantStyles: Record<
                                "success" | "processing" | "error" | "muted",
                                { bg: string; text: string; icon: ElementType }
                              > = {
                                success: {
                                  bg: "bg-emerald-500/20",
                                  text: "text-emerald-300",
                                  icon: CheckCircle2,
                                },
                                processing: {
                                  bg: "bg-amber-500/20",
                                  text: "text-amber-300",
                                  icon: Loader2,
                                },
                                error: {
                                  bg: "bg-rose-500/20",
                                  text: "text-rose-200",
                                  icon: XCircle,
                                },
                                muted: {
                                  bg: "bg-border/40",
                                  text: "text-muted-foreground",
                                  icon: MinusCircle,
                                },
                              };
                              const styles = variantStyles[variant];
                              const StatusIcon = styles.icon;
                              return (
                                <span
                                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.2em] ${styles.bg} ${styles.text}`}
                                >
                                  <StatusIcon
                                    className={`h-3 w-3 ${variant === "processing" ? "animate-spin" : ""}`}
                                  />
                                  {statusLabel}
                                </span>
                              );
                            })()}
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(job.created_at)}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground line-clamp-2">
                              {job.prompt}
                            </p>
                            {jobProviderSummary ? (
                              <p className="text-[0.65rem] text-muted-foreground">{jobProviderSummary}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                            {isCompleted && job.video_url ? (
                              <>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handlePreview();
                                  }}
                                  className={`inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium transition hover:border-border hover:text-foreground ${
                                    isFocused ? "text-primary" : "text-muted-foreground"
                                  }`}
                                >
                                  <Eye className="h-4 w-4" />
                                  {isFocused ? "Viewing" : "Preview"}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDownloadJob(job);
                                  }}
                                  disabled={jobDownloading}
                                  aria-label="Download video"
                                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {jobDownloading ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Downloading…
                                    </>
                                  ) : (
                                    <>
                                      <Download className="h-4 w-4" />
                                      Download
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleClearJob();
                                  }}
                                  aria-label="Dismiss job"
                                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Dismiss
                                </button>
                              </>
                            ) : null}
                            {jobFinal && !isCompleted ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleClearJob();
                                }}
                                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
                              >
                                <Trash2 className="h-4 w-4" />
                                Dismiss
                              </button>
                            ) : null}
                            {!jobFinal ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCancelJob(job.id);
                                }}
                                disabled={jobCancelling}
                                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {jobCancelling ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Cancelling
                                  </>
                                ) : (
                                  <>
                                    <X className="h-4 w-4" />
                                    Cancel
                                  </>
                                )}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

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
                          alt="Selected asset preview"
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
                      <p>{previewMeta ? previewMeta.name : "No asset selected"}</p>
                      <p>{previewMeta ? previewMeta.sizeLabel : uploadPlaceholder}</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    {assetMode === "single" && (
                      <div className="flex flex-wrap gap-3">
                        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                          Upload image
                          <input
                            ref={primaryInputRef}
                            key={`primary-${assetUploadKey}`}
                            className="hidden"
                            type="file"
                            accept="image/*"
                            onChange={handleSingleAssetChange("primary")}
                          />
                        </label>
                        {assetUploads.primary ? (
                          <button
                            type="button"
                            onClick={() => clearAsset("primary")}
                            aria-label="Remove product image"
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </button>
                        ) : null}
                      </div>
                    )}

                    {assetMode === "first_last" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {renderFrameUpload(
                          "firstFrame",
                          "First frame",
                          assetUploads.firstFrame,
                          firstFrameInputRef,
                        )}
                        {renderFrameUpload(
                          "lastFrame",
                          "Last frame",
                          assetUploads.lastFrame,
                          lastFrameInputRef,
                        )}
                      </div>
                    )}

                    {assetMode === "references" && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3">
                          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                            Add references
                            <input
                              ref={referencesInputRef}
                              key={`references-${assetUploadKey}`}
                              className="hidden"
                              type="file"
                              multiple
                              accept="image/*"
                              onChange={handleReferencesChange}
                            />
                          </label>
                        </div>
                        {assetUploads.references.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {assetUploads.references.map((reference, index) => (
                              <li
                                key={`${reference.name}-${index}`}
                                className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-foreground"
                              >
                                <span className="max-w-[140px] truncate">
                                  {reference.name}
                                </span>
                                <span className="text-muted-foreground">
                                  · {formatSizeKb(reference.size)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeReferenceAt(index)}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/50 text-muted-foreground transition hover:border-border hover:text-foreground"
                                  aria-label={`Remove reference ${index + 1}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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
                      Model
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {MODEL_OPTIONS.map((option) => {
                          const isActive = model === option.value;
                          return (
                            <button
                              type="button"
                              key={option.value}
                              onClick={() => setModel(option.value)}
                              aria-pressed={isActive}
                              className={`flex flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                isActive
                                  ? "border-primary/70 bg-primary/15 text-primary"
                                  : "border border-border/70 bg-secondary/50 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              <span>{option.label}</span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {option.helper}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Each run consumes {creditCostPerRun} credits.
                      </p>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                          Duration
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {modelConfig.durations.map((option) => {
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

                      {aspectRatioOptions.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                            Aspect ratio
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {aspectRatioOptions.map((option) => {
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
                      )}
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

        
      </main>
    </div>
  );

}
