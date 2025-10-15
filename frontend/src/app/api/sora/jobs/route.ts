import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { pushLedger, upsertJob, sumLedgerForUser } from "@/lib/mock-store";

const ModelSchema = z.enum(["sora2"]);
const ProviderSchema = z.enum(["fal", "wavespeed", "openai"]);
type ProviderValue = z.infer<typeof ProviderSchema>;
const AspectRatioSchema = z.enum(["16:9", "9:16"]);

const requestSchema = z.object({
  prompt: z.string().min(8, "Prompt is too short."),
  assetPath: z.string().min(4, "Upload path missing."),
  durationSeconds: z
    .number()
    .int()
    .min(4)
    .max(60)
    .optional(),
  aspectRatio: AspectRatioSchema.optional(),
  model: ModelSchema.optional(),
  provider: ProviderSchema.optional(),
});

const CREDIT_COST_STANDARD = Number(process.env.SORA_CREDIT_COST ?? 5);
const FAL_MODEL =
  process.env.FAL_SORA_MODEL_ID ?? "fal-ai/sora-2/image-to-video";
type ModelValue = z.infer<typeof ModelSchema>;
const MODEL_TO_ID: Record<ModelValue, string> = {
  sora2: FAL_MODEL,
};
const FAL_DURATION_SECONDS = Number(
  process.env.FAL_VIDEO_DURATION_SECONDS ?? 20,
);

const WAVESPEED_ENDPOINT =
  process.env.WAVESPEED_SORA_ENDPOINT ??
  "https://api.wavespeed.ai/api/v3/openai/sora-2/image-to-video";
const rawWaveSpeedKey = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_KEY = rawWaveSpeedKey
  ? rawWaveSpeedKey.replace(/^"|"$/g, "")
  : rawWaveSpeedKey;

async function ensureSignedUrl(
  supabase: ReturnType<typeof getServiceClient>,
  path: string,
) {
  const { data, error } = await supabase.storage
    .from("product-uploads")
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw new Error("Could not sign product image.");
  }

  return data.signedUrl;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const token = authHeader.slice("Bearer ".length);
  const body = requestSchema.safeParse(await request.json());

  if (!body.success) {
    return NextResponse.json(
      { error: { message: body.error.issues[0]?.message ?? "Invalid input." } },
      { status: 400 },
    );
  }

  const {
    prompt,
    assetPath,
    durationSeconds,
    model: requestedModel,
    aspectRatio: requestedAspectRatio,
    provider: requestedProvider,
  } = body.data;
  const provider: ProviderValue = requestedProvider ?? "fal";
  if (provider === "openai") {
    return NextResponse.json(
      { error: { message: "OpenAI provider is not yet supported." } },
      { status: 400 },
    );
  }
  const modelKey: ModelValue = requestedModel ?? "sora2";
  const selectedModelId = MODEL_TO_ID[modelKey] ?? MODEL_TO_ID["sora2"];
  const aspectRatio = requestedAspectRatio ?? "16:9";
  const creditCost = CREDIT_COST_STANDARD;
  console.log("[sora-job] incoming", {
    userToken: token.slice(0, 16),
    durationSeconds,
    model: requestedModel,
    aspectRatio: requestedAspectRatio,
    creditCost,
    provider,
  });
  const automationSecret = process.env.AUTOMATION_SECRET;
  const isAutomation =
    automationSecret &&
    request.headers.get("x-automation-secret") === automationSecret;

  if (process.env.MOCK_API === "true") {
    const userId =
      token && token !== "null"
        ? token.replace("mock-session:", "")
        : "mock-user";
    const currentBalance = sumLedgerForUser(userId);

    if (currentBalance < creditCost) {
      return NextResponse.json(
        {
          error: {
            message:
              `Balance is too low. Each video costs ${creditCost} credits. Add more credits before launching another job.`,
          },
        },
        { status: 402 },
      );
    }

    const jobId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const selectedDuration =
      typeof durationSeconds === "number"
        ? durationSeconds
        : FAL_DURATION_SECONDS;

    pushLedger({
      id: crypto.randomUUID(),
      user_id: userId,
      delta: -creditCost,
      reason: "sora_generation_mock",
      created_at: createdAt,
    });

    upsertJob({
      id: jobId,
      user_id: userId,
      prompt: `${prompt} (duration ${selectedDuration}s)`,
      status: "processing",
      video_url: null,
      credit_cost: creditCost,
      provider_job_id: providerId,
      created_at: createdAt,
      provider,
    });

    return NextResponse.json({
      jobId,
      status: "processing",
      requestId: providerId,
      durationSeconds: selectedDuration,
      assetPath,
    });
  }

  const supabase = getServiceClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    console.error("[sora-job] user lookup failed", {
      hasError: Boolean(userError),
      errorMessage:
        userError instanceof Error ? userError.message : String(userError),
    });
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  if (isAutomation) {
    const serviceClient = getServiceClient();
    console.log('[automation-sora-job] user', user.id);
    const jobId = crypto.randomUUID();
    const effectiveAssetPath =
      assetPath ?? `${user.id}/automation-${Date.now()}.png`;
    const videoUrl =
      process.env.AUTOMATION_VIDEO_URL ??
      "https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4";

    await serviceClient.from("credit_ledger").insert({
      user_id: user.id,
      delta: -creditCost,
      reason: "automation_sora_job",
    });

    await serviceClient.from("jobs").insert({
      id: jobId,
      user_id: user.id,
      prompt,
      asset_path: effectiveAssetPath,
      status: "completed",
      video_url: videoUrl,
      provider_job_id: null,
      credit_cost: creditCost,
      provider,
      provider_status: "completed",
      queue_position: null,
      provider_error: null,
    });

    return NextResponse.json({
      jobId,
      status: "completed",
      automation: true,
      videoUrl,
    });
  }

  const { data: balanceRows, error: balanceError } = await supabase
    .from("credit_ledger")
    .select("delta")
    .eq("user_id", user.id);

  if (balanceError) {
    return NextResponse.json(
      { error: { message: "Could not check balance." } },
      { status: 500 },
    );
  }

  const currentBalance = balanceRows?.reduce(
    (total, row) => total + Number(row.delta ?? 0),
    0,
  );

  if (!currentBalance || currentBalance < creditCost) {
    return NextResponse.json(
      {
        error: {
          message:
            `Balance is too low. Each video costs ${creditCost} credits. Add more credits before launching another job.`,
        },
      },
      { status: 402 },
    );
  }

  const { data, error } = await supabase.rpc("start_sora_job", {
    p_user_id: user.id,
    p_prompt: prompt,
    p_asset_path: assetPath,
    p_credit_cost: creditCost,
  });

  console.log("[sora-job] reserved credits", {
    userId: user.id,
    creditCost,
    result: data,
    error,
  });

  if (error) {
    return NextResponse.json(
      { error: { message: "Could not reserve credits." } },
      { status: 500 },
    );
  }

  const jobRecord = Array.isArray(data) ? data[0] : data;
  const jobId =
    typeof jobRecord === "string"
      ? jobRecord
      : typeof jobRecord === "object" && jobRecord !== null
        ? typeof jobRecord.job_id === "string"
          ? jobRecord.job_id
          : typeof jobRecord.id === "string"
            ? jobRecord.id
            : null
        : null;

  if (!jobId) {
    return NextResponse.json(
      { error: { message: "Job id missing." } },
      { status: 500 },
    );
  }

  await supabase.from("assets").insert({
    user_id: user.id,
    storage_path: assetPath,
    kind: "product",
  });

  await supabase.from("jobs").update({ provider }).eq("id", jobId);

  const selectedDuration =
    typeof durationSeconds === "number"
      ? durationSeconds
      : FAL_DURATION_SECONDS;

  if (provider === "fal") {
    return await launchFalJob({
      supabase,
      jobId,
      userId: user.id,
      prompt,
      assetPath,
      aspectRatio,
      selectedDuration,
      modelKey,
      selectedModelId,
      provider,
    });
  }

  if (provider === "wavespeed") {
    return await launchWaveSpeedJob({
      supabase,
      jobId,
      userId: user.id,
      prompt,
      assetPath,
      selectedDuration,
      provider,
    });
  }

  await failJobAndRefund({
    supabase,
    jobId,
    userId: user.id,
    provider,
    message: `Unsupported provider "${provider}".`,
    reason: "refund_failed_start",
    creditCost,
  });

  return NextResponse.json(
    { error: { message: "Unsupported provider." } },
    { status: 400 },
  );
}

type LaunchFalParams = {
  supabase: ReturnType<typeof getServiceClient>;
  jobId: string;
  userId: string;
  prompt: string;
  assetPath: string;
  aspectRatio: string;
  selectedDuration: number;
  modelKey: ModelValue;
  selectedModelId: string;
  provider: ProviderValue;
};

async function launchFalJob({
  supabase,
  jobId,
  userId,
  prompt,
  assetPath,
  aspectRatio,
  selectedDuration,
  modelKey,
  selectedModelId,
  provider,
}: LaunchFalParams) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    const message =
      "FAL_KEY environment variable is missing. Video generation is currently unavailable.";
    await failJobAndRefund({
      supabase,
      jobId,
      userId,
      provider,
      message,
      reason: "refund_missing_provider_key",
    });
    return NextResponse.json({ error: { message } }, { status: 500 });
  }

  try {
    const signedUrl = await ensureSignedUrl(supabase, assetPath);

    const webhookUrl =
      process.env.FAL_WEBHOOK_URL?.trim() ??
      `${(
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.SITE_URL ??
        "https://genvidsfast.com"
      ).replace(/\/$/, "")}/api/provider/fal/webhook`;

    const payload = {
      prompt,
      image_url: signedUrl,
      reference_image_url: signedUrl,
      duration: selectedDuration,
      aspect_ratio: aspectRatio,
      model: modelKey,
      webhook_url: webhookUrl,
    };

    const modelPath = selectedModelId.replace(/^https?:\/\//, "").replace(
      /^queue\.fal\.run\//,
      "",
    );

    const falResponse = await fetch(`https://queue.fal.run/${modelPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify(payload),
    });

    const json = (await falResponse.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!falResponse.ok) {
      const detail =
        typeof json?.detail === "string"
          ? json.detail
          : "FAL image-to-video request failed.";
      await failJobAndRefund({
        supabase,
        jobId,
        userId,
        provider,
        message: detail,
      });
      return NextResponse.json({ error: { message: detail } }, { status: 502 });
    }

    const requestIdCandidate =
      (typeof json?.request_id === "string" && json.request_id) ||
      (typeof json?.requestId === "string" && json.requestId) ||
      (typeof json?.id === "string" && json.id) ||
      null;

    if (!requestIdCandidate) {
      const message = "FAL returned an empty request id.";
      await failJobAndRefund({
        supabase,
        jobId,
        userId,
        provider,
        message,
      });
      return NextResponse.json({ error: { message } }, { status: 502 });
    }

    const providerStatus = extractProviderStatus(json?.status) ??
      extractProviderStatus(json?.state) ??
      extractProviderStatus(json?.phase);
    const normalizedStatus = normalizeProviderStatus(providerStatus);
    const queuePosition = parseQueuePosition(
      json?.queue_position ?? (json?.queue as Record<string, unknown> | undefined)?.position,
    );

    await supabase
      .from("jobs")
      .update({
        provider,
        status: normalizedStatus,
        provider_job_id: requestIdCandidate,
        provider_status: providerStatus ?? normalizedStatus,
        queue_position: queuePosition,
        provider_error: null,
      })
      .eq("id", jobId);

    return NextResponse.json({
      jobId,
      status: normalizedStatus,
      durationSeconds: selectedDuration,
      requestId: requestIdCandidate,
      providerStatus: providerStatus ?? normalizedStatus,
      queuePosition,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed.";
    console.error("[sora-job] fal launch error", { jobId, error: message });
    await failJobAndRefund({
      supabase,
      jobId,
      userId,
      provider,
      message,
    });
    return NextResponse.json(
      { error: { message } },
      { status: 502 },
    );
  }
}

type LaunchWaveSpeedParams = {
  supabase: ReturnType<typeof getServiceClient>;
  jobId: string;
  userId: string;
  prompt: string;
  assetPath: string;
  selectedDuration: number;
  provider: ProviderValue;
};

async function launchWaveSpeedJob({
  supabase,
  jobId,
  userId,
  prompt,
  assetPath,
  selectedDuration,
  provider,
}: LaunchWaveSpeedParams) {
  if (!WAVESPEED_API_KEY) {
    const message =
      "WAVESPEED_API_KEY environment variable is missing. WaveSpeed integrations are unavailable.";
    await failJobAndRefund({
      supabase,
      jobId,
      userId,
      provider,
      message,
      reason: "refund_missing_provider_key",
    });
    return NextResponse.json({ error: { message } }, { status: 500 });
  }

  try {
    const signedUrl = await ensureSignedUrl(supabase, assetPath);
    const response = await fetch(WAVESPEED_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WAVESPEED_API_KEY}`,
      },
      body: JSON.stringify({
        prompt,
        image: signedUrl,
        duration: selectedDuration,
      }),
    });

    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const code = typeof json?.code === "number" ? json.code : response.status;
    if (!response.ok || code >= 400) {
      const detail =
        typeof json?.message === "string"
          ? json.message
          : "WaveSpeed request failed.";
      await failJobAndRefund({
        supabase,
        jobId,
        userId,
        provider,
        message: detail,
      });
      return NextResponse.json({ error: { message: detail } }, { status: 502 });
    }

    const data = (json?.data ?? {}) as Record<string, unknown>;
    const requestId =
      (typeof data?.id === "string" && data.id) ||
      (typeof data?.task_id === "string" && data.task_id) ||
      null;

    if (!requestId) {
      const message = "WaveSpeed did not return a task id.";
      await failJobAndRefund({
        supabase,
        jobId,
        userId,
        provider,
        message,
      });
      return NextResponse.json({ error: { message } }, { status: 502 });
    }

    const providerStatus = extractProviderStatus(data?.status);
    const normalizedStatus = normalizeProviderStatus(providerStatus);
    const queuePosition = parseQueuePosition(
      data?.queue_position ??
        (data?.queue as Record<string, unknown> | undefined)?.position,
    );

    await supabase
      .from("jobs")
      .update({
        provider,
        status: normalizedStatus,
        provider_job_id: requestId,
        provider_status: providerStatus ?? normalizedStatus,
        queue_position: queuePosition,
        provider_error: null,
      })
      .eq("id", jobId);

    return NextResponse.json({
      jobId,
      status: normalizedStatus,
      durationSeconds: selectedDuration,
      requestId,
      providerStatus: providerStatus ?? normalizedStatus,
      queuePosition,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "WaveSpeed request failed.";
    console.error("[sora-job] wavespeed launch error", { jobId, error: message });
    await failJobAndRefund({
      supabase,
      jobId,
      userId,
      provider,
      message,
    });
    return NextResponse.json(
      { error: { message } },
      { status: 502 },
    );
  }
}

type FailJobParams = {
  supabase: ReturnType<typeof getServiceClient>;
  jobId: string;
  userId: string;
  provider: ProviderValue;
  message: string;
  reason?: string;
  creditCost?: number;
};

async function failJobAndRefund({
  supabase,
  jobId,
  userId,
  provider,
  message,
  reason = "refund_failed_start",
  creditCost,
}: FailJobParams) {
  let refundAmount = creditCost;
  if (refundAmount == null) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("credit_cost")
      .eq("id", jobId)
      .maybeSingle();
    refundAmount = jobRow?.credit_cost ?? CREDIT_COST_STANDARD;
  }

  try {
    await supabase.from("credit_ledger").insert({
      user_id: userId,
      delta: refundAmount,
      reason,
    });
  } catch (error) {
    console.error("[sora-job] failed to refund credits", {
      jobId,
      error,
    });
  }

  try {
    await supabase
      .from("jobs")
      .update({
        provider,
        status: "failed",
        provider_status: "failed",
        queue_position: null,
        provider_error: message,
      })
      .eq("id", jobId);
  } catch (error) {
    console.error("[sora-job] failed to mark job as failed", {
      jobId,
      error,
    });
  }
}

function extractProviderStatus(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
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
    const asNumber = Number.parseInt(candidate, 10);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  return null;
}
