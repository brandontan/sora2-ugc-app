import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getJobById, upsertJob } from "@/lib/mock-store";

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
};

type FalResultResponse = {
  status?: string;
  response?: Record<string, unknown>;
  output?: Record<string, unknown>;
  data?: unknown;
  download_url?: string;
  video_url?: string;
};

async function refreshFromSora(job: JobRow) {
  const falKey = process.env.FAL_KEY;
  if (!falKey || !job?.provider_job_id) return job;

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

  if (!statusRes.ok) return job;
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

  if (!done) {
    return job;
  }

  if (["failed", "cancelled", "canceled"].includes(statusValue)) {
    return {
      ...job,
      status: "failed",
    };
  }

  const responseRes = await fetch(baseUrl, {
    headers: {
      Authorization: `Key ${falKey}`,
    },
  });

  if (!responseRes.ok) {
    return job;
  }

  const payload = (await responseRes
    .json()
    .catch(() => ({}))) as FalResultResponse;

  if (payload.status === "completed") {
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
    };
  }

  if (payload.status === "failed") {
    return {
      ...job,
      status: "failed",
    };
  }

  return job;
}

type RouteParams = Promise<{ id: string }>;

export async function GET(
  _request: NextRequest,
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

  if (job.status === "processing") {
    job = await refreshFromSora(job);

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
    } else if (job.status === "failed") {
      try {
        await supabase.from("credit_ledger").insert({
          user_id: job.user_id,
          delta: job.credit_cost,
          reason: "refund_failed_generation",
        });
      } catch {
        /* ignore duplicate errors */
      }

      await supabase.from("jobs").update({ status: "failed" }).eq("id", id);
    }

    const refreshed = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (refreshed.data) {
      job = refreshed.data as JobRow;
    }
  }

  return NextResponse.json({ job });
}
