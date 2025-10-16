import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service-client";

type FalWebhookPayload = {
  request_id?: string;
  requestId?: string;
  id?: string;
  status?: string;
  state?: string;
  phase?: string;
  queue_position?: number;
  queue?: { position?: number };
  logs?: unknown;
  error?: unknown;
  message?: unknown;
  video?: Record<string, unknown> | null;
  video_url?: string;
  videoUrl?: string;
  download_url?: string;
  downloadUrl?: string;
  output?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  data?: unknown;
};

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  video_url: string | null;
  credit_cost: number;
  provider_error: string | null;
  provider?: string | null;
};

const parseQueuePosition = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

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
    const nested = findVideoUrl(candidate.videos[0] as Record<string, unknown>);
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
    const mp4Entry = (candidate.download_urls as Array<Record<string, unknown>>).find(
      (item) => item && typeof item === "object" && item.format === "mp4",
    );
    const url = mp4Entry && (mp4Entry.url as string | undefined);
    if (url && url.startsWith("http")) return url;
  }
  if (Array.isArray(candidate.outputs) && candidate.outputs.length > 0) {
    const nested = findVideoUrl(candidate.outputs[0] as Record<string, unknown>);
    if (nested) return nested;
  }
  return null;
};

const extractProviderError = (
  payload: FalWebhookPayload,
  logs: string[] | null,
): string | null => {
  const sources: unknown[] = [payload.message, payload.error];
  if (payload.response && typeof payload.response === "object") {
    const resp = payload.response as Record<string, unknown>;
    sources.push(resp.error, resp.message, resp.detail);
  }
  if (payload.output && typeof payload.output === "object") {
    const out = payload.output as Record<string, unknown>;
    sources.push(out.error, out.message, out.detail);
  }
  if (Array.isArray(logs)) {
    sources.push(...logs);
  }
  for (const value of sources) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const normalizeStatus = (value: string | null | undefined) =>
  (value ?? "").toLowerCase();

const mapToCanonicalStatus = (
  status: string | null | undefined,
): "completed" | "failed" | "cancelled" | "processing" | "queued" | "unknown" => {
  switch (normalizeStatus(status)) {
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "processing":
    case "running":
    case "in_progress":
      return "processing";
    case "queued":
    case "in_queue":
    case "pending":
      return "queued";
    default:
      return "unknown";
  }
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: FalWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as FalWebhookPayload;
  } catch (error) {
    console.error("[fal-webhook] invalid json", error);
    return NextResponse.json(
      { error: { message: "Invalid JSON payload" } },
      { status: 400 },
    );
  }

  const requestId =
    payload.request_id || payload.requestId || payload.id || null;

  if (!requestId) {
    return NextResponse.json(
      { error: { message: "Missing request_id" } },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, user_id, status, video_url, credit_cost, provider_error, provider")
    .eq("provider_job_id", requestId)
    .maybeSingle<JobRow>();

  if (jobError) {
    console.error("[fal-webhook] supabase lookup failed", jobError);
    return NextResponse.json({ received: true }, { status: 500 });
  }

  if (!job) {
    console.warn("[fal-webhook] no matching job", { requestId });
    return NextResponse.json({ received: true });
  }

  const queuePosition = parseQueuePosition(
    payload.queue_position ?? payload.queue?.position,
  );
  const logs = extractLogs(payload.logs);
  const providerStatus =
    payload.status ?? payload.state ?? payload.phase ?? null;
  const canonicalStatus = mapToCanonicalStatus(providerStatus);
  const asset = findVideoUrl(payload) ?? findVideoUrl(payload.output ?? undefined);
  const providerError = extractProviderError(payload, logs);
  console.log("[fal-webhook] received", {
    requestId,
    status: providerStatus,
    canonicalStatus,
    hasAsset: Boolean(asset),
  });
  try {
    await supabase.from("job_webhooks").insert({
      job_id: job?.id ?? null,
      provider_job_id: requestId,
      provider: job?.provider ?? "fal",
      status: providerStatus ?? null,
      payload: payload as Record<string, unknown>,
    });
  } catch (logError) {
    console.warn("[fal-webhook] failed to log webhook", logError);
  }
  const baseUpdate = {
    provider_status: providerStatus ?? null,
    queue_position: canonicalStatus === "processing" || canonicalStatus === "queued"
      ? queuePosition
      : null,
    provider_error: providerError ?? job.provider_error ?? null,
    provider_last_checked: new Date().toISOString(),
    provider_logs: logs,
  };

  try {
    if (canonicalStatus === "completed") {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          video_url: asset ?? job.video_url,
          ...baseUpdate,
        })
        .eq("id", job.id);

      if (asset && !job.video_url) {
        try {
          await supabase.from("assets").insert({
            user_id: job.user_id,
            storage_path: asset,
            kind: "video",
          });
        } catch (error) {
          console.warn("[fal-webhook] asset insert failed", error);
        }
      }
    } else if (canonicalStatus === "failed") {
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          video_url: asset ?? job.video_url,
          ...baseUpdate,
        })
        .eq("id", job.id);

      try {
        await supabase.from("credit_ledger").insert({
          user_id: job.user_id,
          delta: job.credit_cost,
          reason: "refund_failed_generation",
        });
      } catch (error) {
        console.error("[fal-webhook] refund failed", error);
      }
    } else if (canonicalStatus === "cancelled") {
      await supabase
        .from("jobs")
        .update({
          status: "cancelled",
          video_url: job.video_url,
          ...baseUpdate,
        })
        .eq("id", job.id);

      try {
        await supabase.from("credit_ledger").insert({
          user_id: job.user_id,
          delta: job.credit_cost,
          reason: "refund_cancelled_generation",
        });
      } catch (error) {
        console.error("[fal-webhook] refund failed", error);
      }
    } else {
      await supabase
        .from("jobs")
        .update({
          video_url: asset ?? job.video_url,
          ...baseUpdate,
        })
        .eq("id", job.id);
    }
  } catch (error) {
    console.error("[fal-webhook] supabase update failed", error);
    return NextResponse.json({ error: { message: "Update failed" } }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
