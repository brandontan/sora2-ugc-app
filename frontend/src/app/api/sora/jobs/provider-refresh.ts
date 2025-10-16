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
    .catch(() => ({}))) as {
    status?: string;
    state?: string;
    phase?: string;
    done?: boolean;
    queue_position?: number;
    error?: unknown;
    message?: unknown;
    logs?: unknown;
  };
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
  const findVideoUrlDeep = (candidate: unknown, depth = 0): string | null => {
    if (depth > 6 || candidate == null) return null;
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value.startsWith("http") && value.match(/\.(mp4|mov)(\?|$)/i)) {
        return value;
      }
      return null;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const found = findVideoUrlDeep(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const urlCandidates = [
        record.url,
        record.download_url,
        record.downloadUrl,
        (record.video as Record<string, unknown> | undefined)?.url,
      ];
      for (const value of urlCandidates) {
        const found = findVideoUrlDeep(value, depth + 1);
        if (found) return found;
      }
      for (const value of Object.values(record)) {
        const found = findVideoUrlDeep(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  const possibleSources = [
    payload,
    payload.response,
    payload.output,
    payload.data,
  ];
  for (const source of possibleSources) {
    const videoUrl = findVideoUrlDeep(source);
    if (videoUrl) {
      payload.video_url = videoUrl;
      break;
    }
  }

  const downloadUrl =
    typeof payload.download_url === "string" ? payload.download_url : null;
  const videoUrl =
    payload.video_url && typeof payload.video_url === "string"
      ? payload.video_url
      : downloadUrl;

  const failureTokens = new Set(["failed", "error", "cancelled", "canceled"]);
  const providerStatusLower = providerStatus?.toLowerCase() ?? "";
  const payloadStatusLower = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  const isFailure =
    failureTokens.has(statusValue) ||
    failureTokens.has(providerStatusLower) ||
    failureTokens.has(payloadStatusLower);

  const candidateStatus =
    (typeof payload.status === "string" && payload.status) ||
    providerStatus ||
    statusJson?.status ||
    statusJson?.state ||
    statusJson?.phase ||
    null;

  let finalStatus = candidateStatus
    ? normalizeProviderStatus(candidateStatus)
    : done
      ? "completed"
      : "processing";

  if (done && !isFailure && finalStatus !== "completed") {
    finalStatus = videoUrl ? "completed" : "processing";
  }

  if (isFailure) {
    const nextStatus = providerStatusLower.startsWith("cancel") || statusValue.startsWith("cancel")
      ? "cancelled"
      : "failed";
    console.log("[sora-job:get] terminal status", {
      jobId: job.id,
      status: nextStatus,
    });
    return {
      ...job,
      status: nextStatus,
      ...baseUpdate,
      provider_error: statusError ?? providerErrorFromPayload ?? job.provider_error ?? null,
    };
  }

  const updated: JobRow = {
    ...job,
    status: finalStatus,
    ...baseUpdate,
    provider_error: providerErrorFromPayload ?? job.provider_error ?? null,
  };

  if (finalStatus === "completed") {
    updated.queue_position = null;
    if (videoUrl) {
      updated.video_url = videoUrl;
    } else if (!updated.video_url) {
      updated.video_url = job.video_url;
    }
  }

  return updated;
}

export function extractProviderStatus(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : null;
}

export function normalizeProviderStatus(
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

export function parseQueuePosition(candidate: unknown): number | null {
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const intValue = Number.parseInt(candidate, 10);
    return Number.isFinite(intValue) ? intValue : null;
  }
  return null;
}
