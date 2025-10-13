"use client";

import { useMemo, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { RefreshCcw, ChevronRight } from "lucide-react";

const Bar = dynamic(
  () => import("react-chartjs-2").then((mod) => mod.Bar),
  { ssr: false },
);
const Line = dynamic(
  () => import("react-chartjs-2").then((mod) => mod.Line),
  { ssr: false },
);

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

type AdminJob = {
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

type CanonicalStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "user_cancelled"
  | "other";

type EnrichedJob = AdminJob & {
  normalizedStatus: string;
  canonicalStatus: CanonicalStatus;
  providerKey: string;
  lastUpdateISO: string;
  minutesSinceUpdate: number;
  isActive: boolean;
  isStuck: boolean;
};

export type AdminJobsDashboardProps = {
  jobs: AdminJob[];
  generatedAt: string;
  limit: number;
};

const STATUS_ORDER: CanonicalStatus[] = [
  "completed",
  "processing",
  "queued",
  "failed",
  "cancelled",
  "user_cancelled",
  "other",
];

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

const ACTIVE_CANONICAL_STATUSES = new Set<CanonicalStatus>([
  "processing",
  "queued",
]);

const COMPLETED_CANONICAL_STATUSES = new Set<CanonicalStatus>([
  "completed",
]);

const PROVIDER_LABELS: Record<string, string> = {
  fal: "fal.ai",
  wavespeed: "WaveSpeed",
};

const STATUS_COLORS: Record<CanonicalStatus, string> = {
  completed: "#34d399",
  processing: "#60a5fa",
  queued: "#fbbf24",
  failed: "#f87171",
  cancelled: "#f97316",
  user_cancelled: "#fb7185",
  other: "#94a3b8",
};

const PROVIDER_COLORS: Record<string, string> = {
  fal: "#4ade80",
  wavespeed: "#38bdf8",
  unknown: "#a855f7",
};

const BUCKET_INTERVAL_MINUTES = 15;
const STUCK_THRESHOLD_MINUTES = 10;

const pluralize = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? "" : "s"}`;

const formatRelativeTime = (iso: string) => {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) return pluralize(diffSeconds, "second") + " ago";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return pluralize(diffMinutes, "minute") + " ago";
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return pluralize(diffHours, "hour") + " ago";
  const diffDays = Math.floor(diffHours / 24);
  return pluralize(diffDays, "day") + " ago";
};

const formatBucketLabel = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const providerLabel = (provider: string) =>
  PROVIDER_LABELS[provider] ?? provider.toUpperCase();

const STATUS_DISPLAY_LABELS: Record<CanonicalStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  user_cancelled: "User cancelled",
  other: "Other",
};

const statusLabel = (status: CanonicalStatus | string) => {
  const canonical =
    typeof status === "string"
      ? STATUS_CANONICAL_MAP[status] ?? (status as CanonicalStatus)
      : status;
  if (typeof canonical === "string" && STATUS_DISPLAY_LABELS[canonical as CanonicalStatus]) {
    return STATUS_DISPLAY_LABELS[canonical as CanonicalStatus];
  }
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getTimelineBucket = (iso: string) => {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;
  const bucketMs =
    Math.floor(timestamp / (BUCKET_INTERVAL_MINUTES * 60 * 1000)) *
    BUCKET_INTERVAL_MINUTES *
    60 *
    1000;
  return bucketMs;
};

const deriveLastUpdate = (job: AdminJob) =>
  job.updated_at ??
  job.provider_last_checked ??
  job.created_at;

const enrichJobs = (jobs: AdminJob[]): EnrichedJob[] =>
  jobs.map((job) => {
    const normalizedStatus = job.status.toLowerCase();
    const canonicalStatus =
      STATUS_CANONICAL_MAP[normalizedStatus] ?? "other";
    const providerKey = (job.provider ?? "unknown").toLowerCase();
    const lastUpdateISO = deriveLastUpdate(job);
    const lastUpdateTimestamp = Date.parse(lastUpdateISO);
    const minutesSinceUpdate = Number.isNaN(lastUpdateTimestamp)
      ? Number.POSITIVE_INFINITY
      : (Date.now() - lastUpdateTimestamp) / 1000 / 60;
    const isActive = ACTIVE_CANONICAL_STATUSES.has(canonicalStatus);
    const isStuck =
      isActive && minutesSinceUpdate >= STUCK_THRESHOLD_MINUTES;

    return {
      ...job,
      normalizedStatus,
      canonicalStatus,
      providerKey,
      lastUpdateISO,
      minutesSinceUpdate,
      isActive,
      isStuck,
    };
  });

export function AdminJobsDashboard({
  jobs,
  generatedAt,
  limit,
}: AdminJobsDashboardProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [selectedProviders, setSelectedProviders] = useState<string[] | null>(
    null,
  );
  const [selectedStatuses, setSelectedStatuses] = useState<CanonicalStatus[] | null>(
    null,
  );

  const enrichedJobs = useMemo(() => enrichJobs(jobs), [jobs]);

  const providerOptions = useMemo(() => {
    const unique = new Set(
      enrichedJobs.map((job) => job.providerKey || "unknown"),
    );
    return Array.from(unique);
  }, [enrichedJobs]);

  const statusOptions = useMemo(() => {
    const unique = new Set<CanonicalStatus>(
      enrichedJobs.map((job) => job.canonicalStatus),
    );
    return Array.from(unique).sort(
      (a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
    );
  }, [enrichedJobs]);

  const activeProviderFilters = selectedProviders ?? providerOptions;
  const activeStatusFilters = selectedStatuses ?? statusOptions;

  const filteredJobs = useMemo(
    () =>
      enrichedJobs.filter(
        (job) =>
          activeProviderFilters.includes(job.providerKey) &&
          activeStatusFilters.includes(job.canonicalStatus),
      ),
    [enrichedJobs, activeProviderFilters, activeStatusFilters],
  );

  const totalJobs = filteredJobs.length;
  const activeJobs = filteredJobs.filter((job) => job.isActive).length;
  const completedJobs = filteredJobs.filter((job) =>
    COMPLETED_CANONICAL_STATUSES.has(job.canonicalStatus),
  ).length;
  const stuckJobs = filteredJobs.filter((job) => job.isStuck);

  const statusDatasetOrder = useMemo(() => {
    const activeSet = new Set<CanonicalStatus>(
      activeStatusFilters as CanonicalStatus[],
    );
    const ordered = STATUS_ORDER.filter((status) => activeSet.has(status));
    const remaining = (activeStatusFilters as CanonicalStatus[]).filter(
      (status) => !STATUS_ORDER.includes(status),
    );
    return [...ordered, ...remaining];
  }, [activeStatusFilters]);

  const statusByProviderData = useMemo(() => {
    const providerCounts = new Map<string, Map<CanonicalStatus, number>>();

    filteredJobs.forEach((job) => {
      if (!providerCounts.has(job.providerKey)) {
        providerCounts.set(job.providerKey, new Map());
      }
      const statusMap = providerCounts.get(job.providerKey)!;
      const key = job.canonicalStatus;
      statusMap.set(key, (statusMap.get(key) ?? 0) + 1);
    });

    const labels = activeProviderFilters.map((provider) =>
      providerLabel(provider),
    );

    const datasets = statusDatasetOrder.map((status: CanonicalStatus) => {
      const background =
        STATUS_COLORS[status] ?? "rgba(148, 163, 184, 0.6)";
      return {
        label: statusLabel(status),
        backgroundColor: background,
        borderRadius: 12,
        data: activeProviderFilters.map((provider) => {
          const count =
            providerCounts.get(provider)?.get(status) ?? 0;
          return count;
        }),
        stack: "status",
      };
    });

    return { labels, datasets };
  }, [
    filteredJobs,
    activeProviderFilters,
    statusDatasetOrder,
  ]);

  const timelineData = useMemo(() => {
    const buckets = new Map<number, Map<string, number>>();
    filteredJobs.forEach((job) => {
      const bucket = getTimelineBucket(job.lastUpdateISO);
      if (!bucket) return;
      if (!buckets.has(bucket)) {
        buckets.set(bucket, new Map());
      }
      const providerMap = buckets.get(bucket)!;
      providerMap.set(
        job.providerKey,
        (providerMap.get(job.providerKey) ?? 0) + 1,
      );
    });

    const sortedBuckets = Array.from(buckets.keys()).sort((a, b) => a - b);

    const datasets = activeProviderFilters.map((provider) => {
      const color =
        PROVIDER_COLORS[provider] ?? "rgba(59, 130, 246, 0.8)";
      return {
        label: providerLabel(provider),
        borderColor: color,
        backgroundColor: color,
        tension: 0.25,
        fill: false,
        data: sortedBuckets.map(
          (bucket) => buckets.get(bucket)?.get(provider) ?? 0,
        ),
      };
    });

    return {
      labels: sortedBuckets.map((bucket) => formatBucketLabel(bucket)),
      datasets,
    };
  }, [filteredJobs, activeProviderFilters]);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const toggleProvider = (provider: string) => {
    setSelectedProviders((prev) => {
      const current = prev ?? providerOptions;
      if (current.includes(provider) && current.length === 1) {
        return current;
      }
      return current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider];
    });
  };

  const toggleStatus = (status: CanonicalStatus) => {
    setSelectedStatuses((prev) => {
      const current = prev ?? statusOptions;
      if (current.includes(status) && current.length === 1) {
        return current;
      }
      return current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status];
    });
  };

  const resetFilters = () => {
    setSelectedProviders(null);
    setSelectedStatuses(null);
  };

  const formatNumber = (value: number) =>
    new Intl.NumberFormat().format(value);

  return (
    <div className="px-6 py-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="glass-surface flex flex-col gap-6 rounded-3xl border border-border/30 p-8 shadow-2xl">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground/80">
                Operator Console
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                Sora Job Telemetry
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Live view of recent video generations across providers. Data
                refreshes on load. Up to {limit} recent jobs shown.
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-2 rounded-full border border-accent/50 bg-secondary px-5 py-2 text-sm font-medium text-accent-foreground transition hover:border-accent hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isRefreshing}
            >
              <RefreshCcw
                className={`h-4 w-4 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
              Refresh
            </button>
          </div>
          <div className="flex flex-col gap-4 text-sm text-muted-foreground/80 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent-foreground/90">
                Generated {formatRelativeTime(generatedAt)}
              </span>
              <span className="rounded-full bg-muted/60 px-3 py-1 text-xs font-medium uppercase tracking-wider">
                {filteredJobs.length} shown
              </span>
              <span className="rounded-full bg-muted/60 px-3 py-1 text-xs font-medium uppercase tracking-wider">
                {providerOptions.length} providers
              </span>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-accent-foreground transition hover:text-white"
            >
              Reset filters
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Jobs in view"
            value={formatNumber(totalJobs)}
            tone="primary"
            description="Filtered records"
          />
          <MetricCard
            title="Active"
            value={formatNumber(activeJobs)}
            tone="info"
            description="Currently processing or queued"
          />
          <MetricCard
            title="Completed"
            value={formatNumber(completedJobs)}
            tone="success"
            description="Marked as finished"
          />
          <MetricCard
            title="Stuck"
            value={formatNumber(stuckJobs.length)}
            tone={stuckJobs.length > 0 ? "alert" : "muted"}
            description="Active jobs > 10 minutes without update"
          />
        </section>

        <section className="glass-surface flex flex-col gap-6 rounded-3xl border border-border/30 p-6 shadow-2xl">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Filters
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Toggle providers or statuses to focus the telemetry.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <FilterGroup
              label="Providers"
              options={providerOptions}
              activeOptions={activeProviderFilters}
              onToggle={toggleProvider}
              formatter={providerLabel}
              baseColor="bg-secondary"
            />
            <FilterGroup
              label="Statuses"
              options={statusOptions}
              activeOptions={activeStatusFilters}
              onToggle={(value) => toggleStatus(value as CanonicalStatus)}
              formatter={statusLabel}
              baseColor="bg-secondary"
            />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Status mix by provider"
            description="Stacked counts of recent jobs, grouped by provider."
          >
            <Bar
              data={statusByProviderData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "bottom" as const,
                    labels: {
                      color: "#e5e7eb",
                      usePointStyle: true,
                    },
                  },
                },
                scales: {
                  x: {
                    stacked: true,
                    ticks: { color: "#cbd5f5" },
                    grid: { color: "rgba(148, 163, 184, 0.15)" },
                  },
                  y: {
                    stacked: true,
                    ticks: { color: "#cbd5f5" },
                    grid: { color: "rgba(148, 163, 184, 0.1)" },
                  },
                },
              }}
            />
          </ChartCard>
          <ChartCard
            title="Queue activity timeline"
            description="Active jobs per 15-minute buckets over recent history."
          >
            <Line
              data={timelineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "bottom" as const,
                    labels: {
                      color: "#e5e7eb",
                      usePointStyle: true,
                    },
                  },
                },
                scales: {
                  x: {
                    ticks: { color: "#cbd5f5" },
                    grid: { color: "rgba(148, 163, 184, 0.1)" },
                  },
                  y: {
                    ticks: { color: "#cbd5f5" },
                    grid: { color: "rgba(148, 163, 184, 0.1)" },
                    beginAtZero: true,
                    suggestedMax: Math.max(
                      3,
                      ...timelineData.datasets.flatMap((dataset) =>
                        dataset.data as number[],
                      ),
                    ),
                  },
                },
              }}
            />
          </ChartCard>
        </section>

        <section className="glass-surface rounded-3xl border border-border/30 p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Job Details
              </h2>
              <p className="text-sm text-muted-foreground">
                Sorted by newest first. IDs are truncated.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-800/70 text-sm">
              <thead>
                <tr className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left">Job ID</th>
                  <th className="px-4 py-3 text-left">Provider</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Queue Pos.</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-left">Provider Status</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Video</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900/70 text-sm">
                {filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`${job.isStuck ? "bg-rose-500/10" : "hover:bg-secondary/40"} transition`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground/90">
                      {job.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              PROVIDER_COLORS[job.providerKey] ??
                              "rgba(148, 163, 184, 0.8)",
                          }}
                        />
                        {providerLabel(job.providerKey)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                        style={{
                          backgroundColor: `${(
                            STATUS_COLORS[job.canonicalStatus] ??
                            "rgba(148, 163, 184, 0.2)"
                          )}33`,
                          color:
                            STATUS_COLORS[job.canonicalStatus] ??
                            "#f9fafb",
                        }}
                      >
                        {statusLabel(job.canonicalStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {typeof job.queue_position === "number"
                        ? `#${job.queue_position}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {formatRelativeTime(job.lastUpdateISO)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {job.provider_status ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {job.user_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      {job.video_url ? (
                        <a
                          href={job.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-accent-foreground hover:text-white"
                        >
                          View
                          <ChevronRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredJobs.length === 0 ? (
            <p className="mt-6 rounded-2xl bg-secondary/60 px-6 py-4 text-sm text-muted-foreground">
              No jobs match the current filters.
            </p>
          ) : null}
        </section>

        <section className="glass-surface rounded-3xl border border-border/30 p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-white">
            Stuck Jobs
          </h2>
          <p className="text-sm text-muted-foreground">
            Active jobs without updates for {STUCK_THRESHOLD_MINUTES}+
            minutes.
          </p>
          {stuckJobs.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-secondary/60 px-6 py-4 text-sm text-emerald-300/90">
              No stuck jobs detected in the current window.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {stuckJobs.map((job) => (
                <li
                  key={`stuck-${job.id}`}
                  className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100/90"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-rose-200/80">
                      {job.id.slice(0, 10)}
                    </span>
                    <span>•</span>
                    <span>{providerLabel(job.providerKey)}</span>
                    <span>•</span>
                    <span>{statusLabel(job.canonicalStatus)}</span>
                  </div>
                  <div className="mt-2 text-rose-100/70">
                    Last update {formatRelativeTime(job.lastUpdateISO)} |
                    Queue position{" "}
                    {typeof job.queue_position === "number"
                      ? `#${job.queue_position}`
                      : "unknown"}
                  </div>
                  {job.provider_error ? (
                    <div className="mt-2 rounded-xl bg-rose-500/20 px-3 py-2 text-xs text-rose-50/80">
                      {job.provider_error}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

type MetricCardProps = {
  title: string;
  value: string;
  description: string;
  tone: "primary" | "success" | "info" | "alert" | "muted";
};

const METRIC_BG: Record<MetricCardProps["tone"], string> = {
  primary: "from-indigo-500/20 via-cyan-400/20 to-sky-500/10",
  success: "from-emerald-500/20 via-green-400/20 to-lime-500/10",
  info: "from-sky-500/20 via-blue-400/20 to-indigo-500/10",
  alert: "from-rose-500/25 via-amber-400/20 to-orange-500/10",
  muted: "from-slate-500/15 via-slate-400/10 to-slate-500/5",
};

function MetricCard({
  title,
  value,
  description,
  tone,
}: MetricCardProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/20 p-6">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${METRIC_BG[tone]}`}
      />
      <div className="relative space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground/80">
          {title}
        </p>
        <p className="text-3xl font-semibold text-white">{value}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

type FilterGroupProps = {
  label: string;
  options: string[];
  activeOptions: string[];
  onToggle: (option: string) => void;
  formatter: (value: string) => string;
  baseColor?: string;
};

function FilterGroup({
  label,
  options,
  activeOptions,
  onToggle,
  formatter,
  baseColor = "bg-secondary/60",
}: FilterGroupProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </h3>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = activeOptions.includes(option);
          return (
            <button
              key={`${label}-${option}`}
              type="button"
              onClick={() => onToggle(option)}
              className={`group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${isActive ? "border-accent bg-accent/20 text-white shadow-lg" : `${baseColor} border-border/40 text-muted-foreground hover:border-accent/60 hover:text-white`}`}
            >
              <span>{formatter(option)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ChartCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

function ChartCard({ title, description, children }: ChartCardProps) {
  return (
    <div className="glass-surface h-[380px] rounded-3xl border border-border/30 p-6 shadow-2xl">
      <div className="mb-4 space-y-1">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="relative h-[280px]">{children}</div>
    </div>
  );
}
