import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getJobById, upsertJob, pushLedger } from "@/lib/mock-store";
import {
  refreshJobFromProvider,
  type JobRow,
} from "@/app/api/sora/jobs/provider-refresh";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid job id."),
});

export const runtime = "nodejs";

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
    .update({
      status: "cancelled_user",
      provider_status: "cancelled",
      queue_position: null,
      provider_last_checked: new Date().toISOString(),
    })
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
