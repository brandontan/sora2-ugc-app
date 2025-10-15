import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getJobById, upsertJob, pushLedger } from "@/lib/mock-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid job id."),
});

const rawWaveSpeedKey = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_KEY = rawWaveSpeedKey
  ? rawWaveSpeedKey.replace(/^"|"$/g, "")
  : rawWaveSpeedKey;

export const runtime = "nodejs";

export type JobRow = {
  id: string;
  user_id: string;
  status: string;
  video_url: string | null;
  provider_job_id: string | null;
  credit_cost: number;
  provider?: string | null;
  provider_status?: string | null;
  queue_position?: number | null;
  provider_error?: string | null;
  provider_last_checked?: string | null;
  provider_logs?: string[] | null;
};

type SoraDownload = {
  format?: string;
  url?: string;
  download_url?: string;
};

type FalStatusResponse = {
  status?: string;
  state?: string;
  phase?: string;
  done?: boolean;
  queue_position?: number;
  error?: unknown;
  message?: unknown;
  logs?: unknown;
};

type FalResultResponse = {
  status?: string;
  response?: Record<string, unknown>;
  output?: Record<string, unknown>;
  data?: unknown;
  download_url?: string;
  video_url?: string;
  queue_position?: number;
  error?: unknown;
  message?: unknown;
  logs?: unknown;
};

export async function refreshJobFromProvider(job: JobRow): Promise<JobRow> {
  const provider = (job.provider ?? "fal").toLowerCase();
  if (provider === "fal") {
    return refreshFalJob(job);
  }
  if (provider === "wavespeed") {
    return refreshWaveSpeedJob(job);
  }
  return job;
}

async function refreshFalJob(job: JobRow) {
  const falKey = process.env.FAL_KEY;
  if (!falKey || !job?.provider_job_id) {
    console.log("[sora-job:get] skip refresh", {
      hasFalKey: Boolean(falKey),
      providerJobId: job?.provider_job_id,
    });
    return job;
  }

  const modelPath = (process.env.FAL_SORA_MODEL_ID ??
    "fal-ai/sora-2/image-to-video")
    .replace(/^https?:\/\//, "")
    .replace(/^queue\.fal\.run\//, "");
  const requestPath = modelPath
    .split("/")
    .slice(0, 2)
    .join("/") || modelPath;

  const baseUrl = `https://queue.fal.run/${requestPath}/requests/${job.provider_job_id}`;

  const statusRes = await fetch(`${baseUrl}/status`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  if (!statusRes.ok) {
    console.warn("[sora-job:get] status fetch failed", {
      status: statusRes.status,
      jobId: job.id,
    });
    return {
      ...job,
      provider_last_checked: new Date().toISOString(),
    };
  }

  const statusJson = (await statusRes
    .json()
    .catch(() => ({}))) as FalStatusResponse;
  const normalize = (value: unknown) =>
    typeof value === "string" ? value.toLowerCase() : "";
  const statusValue = normalize(
    statusJson?.status ?? statusJson?.state ?? statusJson?.phase,
  );
  const done =
    statusJson?.done === true ||
    ["completed", "failed", "cancelled", "canceled"].includes(statusValue);

  const queuePosition =
    typeof statusJson?.queue_position === "number"
      ? statusJson.queue_position
      : null;
  const providerStatus =
    typeof statusJson?.status === "string"
      ? statusJson.status
      : typeof statusJson?.state === "string"
        ? statusJson.state
        : typeof statusJson?.phase === "string"
          ? statusJson.phase
          : null;
  const statusError =
    typeof statusJson?.message === "string"
      ? statusJson.message
      : typeof statusJson?.error === "string"
        ? statusJson.error
        : null;
  const baseUpdate: Partial<JobRow> = {
    provider_status: providerStatus ?? job.provider_status ?? null,
    queue_position: queuePosition ?? null,
    provider_last_checked: new Date().toISOString(),
  };

  let derivedStatus: JobRow["status"] | null = null;
  if (!done) {
    console.log("[sora-job:get] still processing", {
      jobId: job.id,
      status: statusValue,
    });
    derivedStatus =
      statusValue === "in_queue"
        ? job.status === "processing"
          ? "processing"
          : "queued"
        : "processing";
  }
  const responseRes = await fetch(baseUrl, {
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  let payload: FalResultResponse = {};
  if (responseRes.ok) {
    payload = (await responseRes.json().catch(() => ({}))) as FalResultResponse;
  } else {
    console.warn("[sora-job:get] response fetch failed", {
      status: responseRes.status,
      jobId: job.id,
    });
  }

  const extractLogs = (candidate: unknown): string[] | null => {
    if (!Array.isArray(candidate)) return null;
    const messages = candidate
      .map((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          "message" in entry &&
          typeof (entry as { message?: unknown }).message === "string"
        ) {
          return (entry as { message: string }).message;
        }
        try {
          return JSON.stringify(entry);
        } catch {
          return null;
        }
      })
      .filter((msg): msg is string => Boolean(msg));
    return messages.length > 0 ? messages : null;
  };
  const logs = extractLogs(payload.logs);
  const providerErrorFromPayload = (() => {
    const candidates: unknown[] = [
      payload.message,
      payload.error,
    ];
    if (payload.response && typeof payload.response === "object") {
      const response = payload.response as Record<string, unknown>;
      candidates.push(response.error, response.message, response.detail);
    }
    if (payload.output && typeof payload.output === "object") {
      const output = payload.output as Record<string, unknown>;
      candidates.push(output.error, output.message, output.detail);
    }
    if (Array.isArray(logs) && logs.length > 0) {
      candidates.push(...logs);
    }
    for (const value of candidates) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  })();
  const findVideoUrl = (
    candidate: Record<string, unknown> | undefined,
  ): string | null => {
    if (!candidate) return null;
    const directCandidates = [
      candidate.video_url,
      candidate.videoUrl,
      (candidate.video as Record<string, unknown> | undefined)?.url,
      candidate.url,
      candidate.download_url,
      candidate.downloadUrl,
    ];
    for (const value of directCandidates) {
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
    }
    if (Array.isArray(candidate.videos) && candidate.videos.length > 0) {
      const nested = findVideoUrl(
        candidate.videos[0] as Record<string, unknown>,
      );
      if (nested) return nested;
    }
    if (candidate.video && typeof candidate.video === "object") {
      const nested = findVideoUrl(candidate.video as Record<string, unknown>);
      if (nested) return nested;
    }
    if (
      Array.isArray(candidate.download_urls) &&
      candidate.download_urls.length > 0
    ) {
      const mp4Entry = (candidate.download_urls as SoraDownload[]).find(
        (item) => item.format === "mp4",
      );
      if (mp4Entry?.url) return mp4Entry.url;
    }
    if (
      Array.isArray(candidate.outputs) &&
      candidate.outputs.length > 0
    ) {
      const nested = findVideoUrl(
        candidate.outputs[0] as Record<string, unknown>,
      );
      if (nested) return nested;
    }
    return null;
  };

  const possibleSources = [
    payload,
    (payload.response as Record<string, unknown>) ?? undefined,
    (payload.output as Record<string, unknown>) ?? undefined,
    (payload.data as Record<string, unknown>) ?? undefined,
    Array.isArray(payload.data)
      ? (payload.data[0] as Record<string, unknown>)
      : undefined,
  ];

  const asset =
    possibleSources.reduce<string | null>((acc, source) => {
      if (acc) return acc;
      return findVideoUrl(source);
    }, null) ?? null;

  const normalizedPayloadStatus =
    typeof payload.status === "string"
      ? payload.status.toLowerCase()
      : null;

  if (!payload.status && asset) {
    payload.status = "completed";
  }

  if (asset && normalizedPayloadStatus !== "failed") {
    console.log("[sora-job:get] completed", {
      jobId: job.id,
    });
    return {
      ...job,
      status: "completed",
      video_url: asset,
      provider_status: payload.status ?? providerStatus ?? "completed",
      queue_position: queuePosition,
      provider_last_checked: new Date().toISOString(),
      provider_logs: logs,
      provider_error: null,
    };
  }

  if (normalizedPayloadStatus === "failed") {
    return {
      ...job,
      status: "failed",
      provider_status: payload.status ?? providerStatus ?? "failed",
      queue_position: queuePosition,
      provider_last_checked: new Date().toISOString(),
      provider_logs: logs,
      provider_error: providerErrorFromPayload ?? job.provider_error ?? null,
    };
  }

  if (["failed", "cancelled", "canceled"].includes(statusValue)) {
    const nextStatus = statusValue.startsWith("cancel") ? "cancelled" : "failed";
    console.log("[sora-job:get] terminal status", {
      jobId: job.id,
      status: nextStatus,
    });
    return {
      ...job,
      status: nextStatus,
      ...baseUpdate,
      provider_error: statusError ?? job.provider_error ?? null,
    };
  }

  return {
    ...job,
    status: derivedStatus ?? job.status,
    ...baseUpdate,
    provider_error: providerErrorFromPayload ?? job.provider_error ?? null,
  };
}

type RouteParams = Promise<{ id: string }>;

type WaveSpeedResult = {
  code?: number;
  message?: string;
  data?: Record<string, unknown>;
};

async function refreshWaveSpeedJob(job: JobRow): Promise<JobRow> {
  if (!job.provider_job_id) {
    return job;
  }

  if (!WAVESPEED_API_KEY) {
    console.warn("[sora-job:get] wavespeed key missing; cannot refresh job", {
      jobId: job.id,
    });
    return {
      ...job,
      provider_last_checked: new Date().toISOString(),
      provider_error:
        job.provider_error ??
        "WaveSpeed API key missing on backend. Unable to refresh status.",
    };
  }

  const statusUrl = `https://api.wavespeed.ai/api/v3/predictions/${job.provider_job_id}/result`;
  const response = await fetch(statusUrl, {
    headers: {
      Authorization: `Bearer ${WAVESPEED_API_KEY}`,
    },
  });

  if (!response.ok) {
    console.warn("[sora-job:get] wavespeed status fetch failed", {
      jobId: job.id,
      status: response.status,
    });
    return {
      ...job,
      provider_last_checked: new Date().toISOString(),
      provider_error: job.provider_error ?? null,
    };
  }

  const json = (await response.json().catch(() => ({}))) as WaveSpeedResult;
  const data = (json?.data ?? {}) as Record<string, unknown>;
  const providerStatus = extractProviderStatus(data?.status);
  const normalizedStatus = normalizeProviderStatus(providerStatus);
  const queuePosition = parseQueuePosition(
    data?.queue_position ??
      (data?.queue as Record<string, unknown> | undefined)?.position,
  );

  const outputs =
    data?.outputs ??
    data?.output ??
    (Array.isArray(data) ? data : undefined);
  const downloadUrl =
    typeof data?.download_url === "string" ? data.download_url : null;
  const videoUrl =
    normalizedStatus === "completed"
      ? extractWaveSpeedVideoUrl(outputs) ?? downloadUrl ?? job.video_url
      : job.video_url;

  const providerError =
    normalizedStatus === "failed" && typeof data?.error === "string"
      ? data.error
      : normalizedStatus === "failed"
        ? job.provider_error ?? "WaveSpeed reported failure."
        : null;
  const logs = coerceLogMessages(data?.logs);

  return {
    ...job,
    status: normalizedStatus,
    provider_status: providerStatus ?? job.provider_status ?? null,
    queue_position: queuePosition ?? job.queue_position ?? null,
    provider_error:
      normalizedStatus === "failed" ? providerError : null,
    provider_last_checked: new Date().toISOString(),
    provider_logs: logs ?? job.provider_logs ?? null,
    video_url: videoUrl ?? null,
  };
}

function extractWaveSpeedVideoUrl(outputs: unknown): string | null {
  if (!Array.isArray(outputs)) return null;
  for (const entry of outputs) {
    if (typeof entry === "string" && entry.startsWith("http")) {
      return entry;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const candidates = [
        record.url,
        record.download_url,
        record.video_url,
        record.href,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.startsWith("http")) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function extractProviderStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function normalizeProviderStatus(
  providerStatus: string | null,
): "queued" | "processing" | "completed" | "failed" {
  const normalized = providerStatus?.toLowerCase() ?? "";
  if (
    normalized === "queued" ||
    normalized === "queue" ||
    normalized === "created" ||
    normalized === "pending"
  ) {
    return "queued";
  }
  if (
    normalized === "processing" ||
    normalized === "running" ||
    normalized === "in_progress" ||
    normalized === "in-progress"
  ) {
    return "processing";
  }
  if (
    normalized === "completed" ||
    normalized === "succeeded" ||
    normalized === "finished" ||
    normalized === "success"
  ) {
    return "completed";
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  ) {
    return "failed";
  }
  return "processing";
}

function parseQueuePosition(candidate: unknown): number | null {
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const intValue = Number.parseInt(candidate, 10);
    return Number.isFinite(intValue) ? intValue : null;
  }
  return null;
}

function coerceLogMessages(logs: unknown): string[] | null {
  if (!Array.isArray(logs)) return null;
  const messages = logs
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        try {
          return JSON.stringify(entry);
        } catch {
          return null;
        }
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return messages.length > 0 ? messages : null;
}

export async function GET(
  _request: NextRequest,
  context: { params: RouteParams },
) {
  console.log("[sora-job:get] incoming", context);
  if (process.env.MOCK_API === "true") {
    const { id } = paramsSchema.parse(await context.params);
    const job = getJobById(id);

    if (!job) {
      return NextResponse.json(
        { error: { message: "Job not found." } },
        { status: 404 },
      );
    }

    if (job.status === "processing") {
      const updated = {
        ...job,
        status: "completed",
        video_url: job.video_url ?? "https://example.com/mock-video.mp4",
      };
      upsertJob(updated);
      return NextResponse.json({ job: updated });
    }

    return NextResponse.json({ job });
  }

  const supabase = getServiceClient();
  const { id } = paramsSchema.parse(await context.params);

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: { message: "Job not found." } },
      { status: 404 },
    );
  }

  let job: JobRow = data as JobRow;
  console.log("[sora-job:get] current job", job);

  if (["processing", "queued", "queueing"].includes(job.status)) {
    job = await refreshJobFromProvider(job);
    console.log("[sora-job:get] after refresh", job);

    const metadataUpdate = {
      provider_status: job.provider_status ?? null,
      queue_position:
        typeof job.queue_position === "number" ? job.queue_position : null,
      provider_error: job.provider_error ?? null,
    };

    if (job.status === "completed" && job.video_url) {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          video_url: job.video_url,
          ...metadataUpdate,
        })
        .eq("id", id);

      try {
        await supabase.from("assets").insert({
          user_id: job.user_id,
          storage_path: job.video_url,
          kind: "video",
        });
      } catch {
        /* ignore duplicate errors */
      }
    } else if (job.status === "failed" || job.status === "cancelled") {
      try {
        console.log("[sora-job:get] issuing refund", {
          userId: job.user_id,
          jobId: job.id,
          creditCost: job.credit_cost,
          status: job.status,
        });
        await supabase.from("credit_ledger").insert({
          user_id: job.user_id,
          delta: job.credit_cost,
          reason:
            job.status === "cancelled"
              ? "refund_cancelled_generation"
              : "refund_failed_generation",
        });
      } catch (error) {
        console.error("[sora-job:get] refund insert failed", error);
      }

      await supabase
        .from("jobs")
        .update({
          status: job.status,
          ...metadataUpdate,
        })
        .eq("id", id);
    } else {
      await supabase
        .from("jobs")
        .update({
          status: job.status,
          ...metadataUpdate,
        })
        .eq("id", id);
    }

    const refreshed = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (refreshed.data) {
      const persisted = refreshed.data as JobRow;
      job = {
        ...persisted,
        provider_status: job.provider_status,
        queue_position: job.queue_position,
        provider_error: job.provider_error,
        provider_last_checked: job.provider_last_checked,
        provider_logs: job.provider_logs,
      };
    }
  }

  return NextResponse.json({ job });
}

async function cancelSoraJob(job: JobRow) {
  if ((job.provider ?? "fal").toLowerCase() !== "fal") return;
  const falKey = process.env.FAL_KEY;
  if (!falKey || !job?.provider_job_id) return;

  const modelPath = (process.env.FAL_SORA_MODEL_ID ??
    "fal-ai/sora-2/image-to-video")
    .replace(/^https?:\/\//, "")
    .replace(/^queue\.fal\.run\//, "");
  const requestPath = modelPath
    .split("/")
    .slice(0, 2)
    .join("/") || modelPath;

  const baseUrl = `https://queue.fal.run/${requestPath}/requests/${job.provider_job_id}`;

  try {
    await fetch(`${baseUrl}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
      },
    });
  } catch {
    /* best effort only */
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: RouteParams },
) {
  if (process.env.MOCK_API === "true") {
    const { id } = paramsSchema.parse(await context.params);
    const job = getJobById(id);
    if (!job) {
      return NextResponse.json(
        { error: { message: "Job not found." } },
        { status: 404 },
      );
    }
    if (job.status === "completed") {
      return NextResponse.json(
        { error: { message: "Completed jobs cannot be cancelled." } },
        { status: 400 },
      );
    }
    if (job.status !== "cancelled") {
      upsertJob({
        ...job,
        status: "cancelled",
      });
      pushLedger({
        id: crypto.randomUUID(),
        user_id: job.user_id,
        delta: job.credit_cost,
        reason: "refund_cancelled_mock",
        created_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({
      job: {
        ...job,
        status: "cancelled",
      },
    });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const token = authHeader.slice("Bearer ".length);
  const supabase = getServiceClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const { id } = paramsSchema.parse(await context.params);

  const { data: jobData, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (jobError || !jobData) {
    return NextResponse.json(
      { error: { message: "Job not found." } },
      { status: 404 },
    );
  }

  const job = jobData as JobRow;

  if (job.user_id !== user.id) {
    return NextResponse.json(
      { error: { message: "Forbidden" } },
      { status: 403 },
    );
  }

  if (job.status === "completed") {
    return NextResponse.json(
      { error: { message: "Completed jobs cannot be cancelled." } },
      { status: 400 },
    );
  }

  if (job.status === "cancelled") {
    return NextResponse.json({ job });
  }

  await cancelSoraJob(job);

  await supabase
    .from("jobs")
    .update({ status: "cancelled_user" })
    .eq("id", id);

  const { data: refreshedJob } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    job: (refreshedJob as JobRow | null) ?? {
      ...job,
      status: "cancelled_user",
    },
  });
}
