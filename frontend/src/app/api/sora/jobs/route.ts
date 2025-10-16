import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { pushLedger, upsertJob, sumLedgerForUser } from "@/lib/mock-store";
import {
  extractProviderStatus,
  normalizeProviderStatus,
  parseQueuePosition,
} from "@/app/api/sora/jobs/provider-refresh";

const MODEL_KEYS = [
  "sora2",
  "veo31_fast_image",
  "veo31_fast_first_last",
  "veo31_hq_image",
  "veo31_reference",
] as const;
const ModelSchema = z.enum(MODEL_KEYS);
const ProviderSchema = z.enum(["fal", "openai"]);
type ProviderValue = z.infer<typeof ProviderSchema>;
const AspectRatioSchema = z.enum(["16:9", "9:16"]);

const requestSchema = z.object({
  prompt: z.string().min(8, "Prompt is too short."),
  assetPath: z.string().min(4, "Upload path missing.").optional(),
  durationSeconds: z
    .number()
    .int()
    .min(4)
    .max(60)
    .optional(),
  aspectRatio: AspectRatioSchema.optional(),
  model: ModelSchema.optional(),
  provider: ProviderSchema.optional(),
  assets: z
    .object({
      primary: z.string().min(4).optional(),
      firstFrame: z.string().min(4).optional(),
      lastFrame: z.string().min(4).optional(),
      references: z.array(z.string().min(4)).optional(),
    })
    .optional(),
});

const parseCreditCost = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const CREDIT_COST_STANDARD = parseCreditCost(
  process.env.SORA_CREDIT_COST,
  5,
);
const CREDIT_COST_VEO31_FAST = parseCreditCost(
  process.env.SORA_VEO31_FAST_CREDIT_COST,
  CREDIT_COST_STANDARD,
);
const CREDIT_COST_VEO31_HQ = parseCreditCost(
  process.env.SORA_VEO31_HQ_CREDIT_COST,
  8,
);
type ModelValue = typeof MODEL_KEYS[number];

type ModelAssetMode = "single" | "first_last" | "references" | "none";
type DurationFormat = "seconds" | "string_seconds";

type ModelConfig = {
  endpoint: string;
  assetMode: ModelAssetMode;
  durationFormat: DurationFormat;
  supportsAspect: boolean;
  defaultDurationSeconds: number;
  creditCost: number;
};

const DEFAULT_DURATION_SECONDS = Number(
  process.env.FAL_VIDEO_DURATION_SECONDS ?? 8,
);

const MODEL_CONFIG: Record<ModelValue, ModelConfig> = {
  sora2: {
    endpoint:
      process.env.FAL_SORA_MODEL_ID ?? "fal-ai/sora-2/image-to-video",
    assetMode: "single",
    durationFormat: "seconds",
    supportsAspect: true,
    defaultDurationSeconds:
      [4, 8, 12].includes(DEFAULT_DURATION_SECONDS) ?
        DEFAULT_DURATION_SECONDS :
        8,
    creditCost: CREDIT_COST_STANDARD,
  },
  veo31_fast_image: {
    endpoint:
      process.env.FAL_VEO31_FAST_IMAGE_MODEL_ID ??
      "fal-ai/veo3.1/fast/image-to-video",
    assetMode: "single",
    durationFormat: "string_seconds",
    supportsAspect: true,
    defaultDurationSeconds: 8,
    creditCost: CREDIT_COST_VEO31_FAST,
  },
  veo31_fast_first_last: {
    endpoint:
      process.env.FAL_VEO31_FAST_FIRST_LAST_MODEL_ID ??
      "fal-ai/veo3.1/fast/first-last-frame-to-video",
    assetMode: "first_last",
    durationFormat: "string_seconds",
    supportsAspect: true,
    defaultDurationSeconds: 8,
    creditCost: CREDIT_COST_VEO31_FAST,
  },
  veo31_hq_image: {
    endpoint:
      process.env.FAL_VEO31_HQ_IMAGE_MODEL_ID ??
      "fal-ai/veo3.1/image-to-video",
    assetMode: "single",
    durationFormat: "string_seconds",
    supportsAspect: true,
    defaultDurationSeconds: 8,
    creditCost: CREDIT_COST_VEO31_HQ,
  },
  veo31_reference: {
    endpoint:
      process.env.FAL_VEO31_REFERENCE_MODEL_ID ??
      "fal-ai/veo3.1/reference-to-video",
    assetMode: "references",
    durationFormat: "string_seconds",
    supportsAspect: false,
    defaultDurationSeconds: 8,
    creditCost: CREDIT_COST_VEO31_FAST,
  },
};

const MODEL_KEY_SET = new Set<string>(MODEL_KEYS as readonly string[]);

function normalizeModelKey(value: string | null | undefined): ModelValue {
  return value && MODEL_KEY_SET.has(value) ?
      (value as ModelValue) :
      "sora2";
}

type AssetPaths = {
  primary?: string;
  firstFrame?: string;
  lastFrame?: string;
  references?: string[];
};

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
    assets: providedAssets,
  } = body.data;
  const provider: ProviderValue = requestedProvider ?? "fal";
  if (provider === "openai") {
    return NextResponse.json(
      { error: { message: "OpenAI provider is not yet supported." } },
      { status: 400 },
    );
  }

  const rawDefaultModel = process.env.DEFAULT_VIDEO_MODEL;
  const defaultModel = normalizeModelKey(rawDefaultModel);
  const modelKey: ModelValue = requestedModel ?? defaultModel;
  const selectedModelConfig = MODEL_CONFIG[modelKey] ?? MODEL_CONFIG.sora2;
  const aspectRatio = selectedModelConfig.supportsAspect ?
    (requestedAspectRatio ?? "16:9") :
    undefined;
  let normalizedAssets: AssetPaths;
  try {
    normalizedAssets = normalizeAssetsForModel(
      selectedModelConfig,
      providedAssets,
      assetPath,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid assets provided.";
    return NextResponse.json({ error: { message } }, { status: 400 });
  }
  const canonicalAssetPath = getCanonicalAssetPath(normalizedAssets);

  const creditCost = selectedModelConfig.creditCost ?? CREDIT_COST_STANDARD;
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
        : selectedModelConfig.defaultDurationSeconds;
    const jobAssetIdentifier =
      canonicalAssetPath ??
      normalizedAssets.firstFrame ??
      normalizedAssets.references?.[0] ??
      normalizedAssets.lastFrame ??
      "text-only";

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
      assetPath: jobAssetIdentifier,
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
      canonicalAssetPath ??
      normalizedAssets.firstFrame ??
      normalizedAssets.references?.[0] ??
      assetPath ??
      `${user.id}/automation-${Date.now()}.png`;
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
    p_asset_path:
      canonicalAssetPath ??
      normalizedAssets.firstFrame ??
      normalizedAssets.references?.[0] ??
      null,
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

  const assetPathsToRecord = collectAssetPaths(normalizedAssets);
  if (assetPathsToRecord.length > 0) {
    await supabase
      .from("assets")
      .insert(
        assetPathsToRecord.map((path) => ({
          user_id: user.id,
          storage_path: path,
          kind: "product",
        })),
      );
  }

  await supabase.from("jobs").update({ provider }).eq("id", jobId);

  const selectedDuration =
    typeof durationSeconds === "number"
      ? durationSeconds
      : selectedModelConfig.defaultDurationSeconds;

  if (provider === "fal") {
    return await launchFalJob({
      supabase,
      jobId,
      userId: user.id,
      prompt,
      aspectRatio,
      selectedDuration,
      modelKey,
      modelConfig: selectedModelConfig,
      assets: normalizedAssets,
      provider,
      creditCost,
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
  aspectRatio?: string;
  selectedDuration: number;
  modelKey: ModelValue;
  modelConfig: ModelConfig;
  assets: AssetPaths;
  provider: ProviderValue;
  creditCost: number;
};

async function launchFalJob({
  supabase,
  jobId,
  userId,
  prompt,
  aspectRatio,
  selectedDuration,
  modelKey,
  modelConfig,
  assets,
  provider,
  creditCost,
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
    const signedAssets = await signAssetsForModel(supabase, assets);

    const webhookUrl =
      process.env.FAL_WEBHOOK_URL?.trim() ??
      `${(
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.SITE_URL ??
        "https://genvidsfast.com"
      ).replace(/\/$/, "")}/api/provider/fal/webhook`;

    const payload: Record<string, unknown> = {
      prompt,
      model: modelKey,
      webhook_url: webhookUrl,
      duration: formatDurationForModel(
        selectedDuration,
        modelConfig.durationFormat,
      ),
    };

    if (modelConfig.supportsAspect && aspectRatio) {
      payload.aspect_ratio = aspectRatio;
    }

    switch (modelConfig.assetMode) {
      case "single":
        if (!signedAssets.primary) {
          throw new Error("Primary asset missing for single-image model.");
        }
        payload.image_url = signedAssets.primary;
        payload.reference_image_url = signedAssets.primary;
        break;
      case "first_last":
        if (!signedAssets.firstFrame || !signedAssets.lastFrame) {
          throw new Error(
            "First and last frame assets are required for this model.",
          );
        }
        payload.first_frame_url = signedAssets.firstFrame;
        payload.last_frame_url = signedAssets.lastFrame;
        break;
      case "references":
        if (!signedAssets.references || signedAssets.references.length === 0) {
          throw new Error(
            "At least one reference image is required for this model.",
          );
        }
        payload.image_urls = signedAssets.references;
        break;
      case "none":
        break;
    }

    const endpoint = modelConfig.endpoint;
    const modelPath = endpoint.replace(/^https?:\/\//, "").replace(
      /^queue\.fal\.run\//,
      "",
    );

    const queueUrl = new URL(`https://queue.fal.run/${modelPath}`);
    queueUrl.searchParams.set("fal_webhook", webhookUrl);

    const falResponse = await fetch(queueUrl, {
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







function normalizeAssetsForModel(
  modelConfig: ModelConfig,
  assets: AssetPaths | undefined,
  legacyAssetPath?: string,
): AssetPaths {
  const normalized: AssetPaths = {};

  if (assets?.primary) {
    normalized.primary = assets.primary;
  } else if (legacyAssetPath) {
    normalized.primary = legacyAssetPath;
  }

  if (assets?.firstFrame) {
    normalized.firstFrame = assets.firstFrame;
  }

  if (assets?.lastFrame) {
    normalized.lastFrame = assets.lastFrame;
  }

  if (assets?.references?.length) {
    normalized.references = assets.references.filter((value) => Boolean(value));
  }

  switch (modelConfig.assetMode) {
    case "single":
      if (!normalized.primary) {
        throw new Error("Upload at least one product image for this model.");
      }
      break;
    case "first_last":
      if (!normalized.firstFrame || !normalized.lastFrame) {
        throw new Error("First and last frame images are required.");
      }
      break;
    case "references":
      if (!normalized.references || normalized.references.length === 0) {
        throw new Error("Provide at least one reference image.");
      }
      break;
    case "none":
      break;
  }

  return normalized;
}

function getCanonicalAssetPath(assets: AssetPaths): string | undefined {
  if (assets.primary) return assets.primary;
  if (assets.firstFrame) return assets.firstFrame;
  if (assets.references && assets.references.length > 0) {
    return assets.references[0];
  }
  if (assets.lastFrame) return assets.lastFrame;
  return undefined;
}

function collectAssetPaths(assets: AssetPaths): string[] {
  const collected: string[] = [];
  if (assets.primary) collected.push(assets.primary);
  if (assets.firstFrame) collected.push(assets.firstFrame);
  if (assets.lastFrame) collected.push(assets.lastFrame);
  if (assets.references?.length) {
    collected.push(...assets.references);
  }
  return Array.from(new Set(collected));
}

async function signAssetsForModel(
  supabase: ReturnType<typeof getServiceClient>,
  assets: AssetPaths,
): Promise<AssetPaths> {
  const signed: AssetPaths = {};
  if (assets.primary) {
    signed.primary = await ensureSignedUrl(supabase, assets.primary);
  }
  if (assets.firstFrame) {
    signed.firstFrame = await ensureSignedUrl(supabase, assets.firstFrame);
  }
  if (assets.lastFrame) {
    signed.lastFrame = await ensureSignedUrl(supabase, assets.lastFrame);
  }
  if (assets.references?.length) {
    signed.references = await Promise.all(
      assets.references.map((path) => ensureSignedUrl(supabase, path)),
    );
  }
  return signed;
}

function formatDurationForModel(
  durationSeconds: number,
  format: DurationFormat,
): number | string {
  if (format === "string_seconds") {
    const safe = Math.max(1, Math.round(durationSeconds));
    return `${safe}s`;
  }
  return Math.round(durationSeconds);
}
