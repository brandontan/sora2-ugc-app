import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import {
  refreshJobFromProvider,
  type JobRow,
} from "@/app/api/sora/jobs/provider-refresh";
import { getMockStore, upsertJob } from "@/lib/mock-store";

export const runtime = "nodejs";

const limitSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return 5;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return 5;
    return Math.min(parsed, 25);
  });

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "cancelled_user",
]);

function sanitizeEnv(value: string | undefined | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.replace(/^"|"$/g, "");
}

export async function GET(request: NextRequest) {
  const adminToken = sanitizeEnv(process.env.ADMIN_DASHBOARD_TOKEN);
  const cronSecret = sanitizeEnv(process.env.CRON_SECRET);
  const allowedTokens = [adminToken, cronSecret].filter(
    (value): value is string => Boolean(value),
  );

  if (allowedTokens.length === 0) {
    return NextResponse.json(
      { error: { message: "Admin token not configured." } },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!allowedTokens.includes(token)) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = limitSchema.parse(searchParams.get("limit"));

  if (process.env.MOCK_API === "true") {
    const mockStore = getMockStore();
    const pending = mockStore.jobs.filter(
      (job) => !terminalStatuses.has(job.status),
    );
    const slice = pending.slice(0, limit);
    slice.forEach((job) => {
      upsertJob({
        ...job,
        status: "completed",
        video_url:
          job.video_url ?? "https://storage.googleapis.com/mock-videos/demo.mp4",
        provider_status: "completed",
        provider_last_checked: new Date().toISOString(),
      });
    });
    return NextResponse.json({
      processed: slice.length,
      updated: slice.length,
      mode: "mock",
    });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .in("status", ["queued", "queueing", "processing"])
    .order("updated_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) {
    return NextResponse.json(
      { error: { message: "Could not load jobs." } },
      { status: 500 },
    );
  }

  const jobs = data as JobRow[];
  const updates: Array<{
    jobId: string;
    statusBefore: string;
    statusAfter: string;
    providerStatusBefore: string | null;
    providerStatusAfter: string | null;
    queueBefore: number | null;
    queueAfter: number | null;
    updated: boolean;
    error?: string;
  }> = [];

  for (const job of jobs) {
    const before = {
      status: job.status,
      provider_status: job.provider_status ?? null,
      queue_position:
        typeof job.queue_position === "number" ? job.queue_position : null,
      provider_error: job.provider_error ?? null,
    };

    try {
      const refreshed = await refreshJobFromProvider(job);

      const metadataUpdate = {
        provider_status: refreshed.provider_status ?? null,
        queue_position:
          typeof refreshed.queue_position === "number"
            ? refreshed.queue_position
            : null,
        provider_error: refreshed.provider_error ?? null,
      };

      const isFinalStatus =
        refreshed.status === "completed" ||
        refreshed.status === "failed" ||
        refreshed.status === "cancelled";

      if (isFinalStatus) {
        metadataUpdate.queue_position = null;
      }

      if (refreshed.status === "completed" && refreshed.video_url) {
        const { error: jobUpdateError } = await supabase
          .from("jobs")
          .update({
            status: "completed",
            video_url: refreshed.video_url,
            ...metadataUpdate,
          })
          .eq("id", job.id);

        if (jobUpdateError) {
          throw new Error(jobUpdateError.message ?? "Job update failed");
        }

        try {
          await supabase.from("assets").insert({
            user_id: refreshed.user_id,
            storage_path: refreshed.video_url,
            kind: "video",
          });
        } catch {
          /* idempotent */
        }
      } else if (
        refreshed.status === "failed" ||
        refreshed.status === "cancelled"
      ) {
        try {
          await supabase.from("credit_ledger").insert({
            user_id: refreshed.user_id,
            delta: refreshed.credit_cost,
            reason:
              refreshed.status === "cancelled"
                ? "refund_cancelled_generation"
                : "refund_failed_generation",
          });
        } catch (ledgerError) {
          console.error("[sora-poller] ledger insert failed", {
            jobId: job.id,
            error: ledgerError,
          });
        }

        const { error: jobUpdateError } = await supabase
          .from("jobs")
          .update({
            status: refreshed.status,
            ...metadataUpdate,
          })
          .eq("id", job.id);

        if (jobUpdateError) {
          throw new Error(jobUpdateError.message ?? "Job update failed");
        }
      } else {
        const { error: jobUpdateError } = await supabase
          .from("jobs")
          .update({
            status: refreshed.status,
            ...metadataUpdate,
          })
          .eq("id", job.id);

        if (jobUpdateError) {
          throw new Error(jobUpdateError.message ?? "Job update failed");
        }
      }

      updates.push({
        jobId: job.id,
        statusBefore: before.status,
        statusAfter: refreshed.status,
        providerStatusBefore: before.provider_status,
        providerStatusAfter: refreshed.provider_status ?? null,
        queueBefore: before.queue_position,
        queueAfter:
          typeof refreshed.queue_position === "number"
            ? refreshed.queue_position
            : null,
        updated:
          before.status !== refreshed.status ||
          before.provider_status !== (refreshed.provider_status ?? null) ||
          before.queue_position !==
            (typeof refreshed.queue_position === "number"
              ? refreshed.queue_position
              : null) ||
          before.provider_error !== (refreshed.provider_error ?? null),
      });
    } catch (refreshError) {
      console.error("[sora-poller] refresh failed", {
        jobId: job.id,
        error: refreshError,
      });
      updates.push({
        jobId: job.id,
        statusBefore: before.status,
        statusAfter: before.status,
        providerStatusBefore: before.provider_status,
        providerStatusAfter: before.provider_status,
        queueBefore: before.queue_position,
        queueAfter: before.queue_position,
        updated: false,
        error:
          refreshError instanceof Error
            ? refreshError.message
            : "Unknown error",
      });
    }
  }

  const changed = updates.filter((entry) => entry.updated).length;

  return NextResponse.json({
    processed: jobs.length,
    updated: changed,
    details: updates,
  });
}
