import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getJobById, upsertJob, pushLedger } from "@/lib/mock-store";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid job id."),
});

export const runtime = "nodejs";

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  video_url: string | null;
  provider_job_id: string | null;
  credit_cost: number;
  provider_status?: string | null;
  provider_queue_position?: number | null;
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
  logs?: unknown;
};

type FalResultResponse = {
  status?: string;
  response?: Record<string, unknown>;
  output?: Record<string, unknown>;
  data?: unknown;
  download_url?: string;
  video_url?: string;
  logs?: unknown;
};

async function refreshFromSora(job: JobRow) {
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

  const baseUrl = `https://queue.fal.run/${modelPath}/requests/${job.provider_job_id}`;

  const statusRes = await fetch(`${baseUrl}/status`, {
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
  const baseUpdate: Partial<JobRow> = {
    provider_status: providerStatus,
    provider_queue_position: queuePosition,
    provider_last_checked: new Date().toISOString(),
  };

  if (!done) {
    console.log("[sora-job:get] still processing", {
      jobId: job.id,
      status: statusValue,
    });
    const derivedStatus =
      statusValue === "in_queue"
        ? job.status === "processing"
          ? "processing"
          : "queued"
        : "processing";
    return {
      ...job,
      status: derivedStatus,
      ...baseUpdate,
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
    };
  }

  const responseRes = await fetch(baseUrl, {
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  if (!responseRes.ok) {
    console.warn("[sora-job:get] response fetch failed", {
      status: responseRes.status,
      jobId: job.id,
    });
    return {
      ...job,
      ...baseUpdate,
    };
  }

  const payload = (await responseRes
    .json()
    .catch(() => ({}))) as FalResultResponse;

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

  if (payload.status === "completed") {
    console.log("[sora-job:get] completed", {
      jobId: job.id,
    });
    const findVideoUrl = (
      candidate: Record<string, unknown> | undefined,
    ): string | null => {
      if (!candidate) return null;
      const directCandidates = [
        candidate.video_url,
        candidate.videoUrl,
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

    return {
      ...job,
      status: "completed",
      video_url: asset ?? job.video_url,
      provider_status: payload.status ?? providerStatus,
      provider_queue_position: queuePosition,
      provider_last_checked: new Date().toISOString(),
      provider_logs: extractLogs(payload.logs),
    };
  }

  if (payload.status === "failed") {
    return {
      ...job,
      status: "failed",
      provider_status: payload.status ?? providerStatus,
      provider_queue_position: queuePosition,
      provider_last_checked: new Date().toISOString(),
      provider_logs: extractLogs(payload.logs),
    };
  }

  return {
    ...job,
    ...baseUpdate,
  };
}

type RouteParams = Promise<{ id: string }>;

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
    job = await refreshFromSora(job);
    console.log("[sora-job:get] after refresh", job);

    if (job.status === "completed" && job.video_url) {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          video_url: job.video_url,
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
        .update({ status: job.status })
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
        provider_queue_position: job.provider_queue_position,
        provider_last_checked: job.provider_last_checked,
        provider_logs: job.provider_logs,
      };
    }
  }

  return NextResponse.json({ job });
}

async function cancelSoraJob(job: JobRow) {
  const falKey = process.env.FAL_KEY;
  if (!falKey || !job?.provider_job_id) return;

  const modelPath = (process.env.FAL_SORA_MODEL_ID ??
    "fal-ai/sora-2/image-to-video")
    .replace(/^https?:\/\//, "")
    .replace(/^queue\.fal\.run\//, "");

  const baseUrl = `https://queue.fal.run/${modelPath}/requests/${job.provider_job_id}`;

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
