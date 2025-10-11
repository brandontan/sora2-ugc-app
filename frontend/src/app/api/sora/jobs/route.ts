import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { pushLedger, upsertJob, sumLedgerForUser } from "@/lib/mock-store";

const ModelSchema = z.enum(["sora2", "sora2-pro"]);
const AspectRatioSchema = z.enum(["16:9", "9:16"]);

const requestSchema = z.object({
  prompt: z.string().min(8, "Prompt is too short."),
  assetPath: z.string().min(4, "Upload path missing."),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(60)
    .optional(),
  aspectRatio: AspectRatioSchema.optional(),
  model: ModelSchema.optional(),
});

const CREDIT_COST = Number(process.env.SORA_CREDIT_COST ?? 5);
const FAL_MODEL =
  process.env.FAL_SORA_MODEL_ID ?? "fal-ai/sora-2/image-to-video";
const FAL_MODEL_PRO =
  process.env.FAL_SORA_PRO_MODEL_ID ?? "fal-ai/sora-2-pro/image-to-video";
type ModelValue = z.infer<typeof ModelSchema>;
const MODEL_TO_ID: Record<ModelValue, string> = {
  sora2: FAL_MODEL,
  "sora2-pro": FAL_MODEL_PRO,
};
const FAL_DURATION_SECONDS = Number(
  process.env.FAL_VIDEO_DURATION_SECONDS ?? 20,
);

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
  } = body.data;
  const modelKey: ModelValue = requestedModel ?? "sora2";
  const selectedModelId = MODEL_TO_ID[modelKey] ?? MODEL_TO_ID["sora2"];
  const aspectRatio = requestedAspectRatio ?? "16:9";
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

    if (currentBalance < CREDIT_COST) {
      return NextResponse.json(
        {
          error: {
            message:
              `Balance is too low. Each video costs ${CREDIT_COST} credits. Add more credits before launching another job.`,
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
      delta: -CREDIT_COST,
      reason: "sora_generation_mock",
      created_at: createdAt,
    });

    upsertJob({
      id: jobId,
      user_id: userId,
      prompt: `${prompt} (duration ${selectedDuration}s)`,
      status: "processing",
      video_url: null,
      credit_cost: CREDIT_COST,
      provider_job_id: providerId,
      created_at: createdAt,
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
      delta: -CREDIT_COST,
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
      credit_cost: CREDIT_COST,
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

  if (!currentBalance || currentBalance < CREDIT_COST) {
    return NextResponse.json(
      {
        error: {
          message:
            `Balance is too low. Each video costs ${CREDIT_COST} credits. Add more credits before launching another job.`,
        },
      },
      { status: 402 },
    );
  }

  const { data, error } = await supabase.rpc("start_sora_job", {
    p_user_id: user.id,
    p_prompt: prompt,
    p_asset_path: assetPath,
    p_credit_cost: CREDIT_COST,
  });

  if (error) {
    return NextResponse.json(
      { error: { message: "Could not reserve credits." } },
      { status: 500 },
    );
  }

  const jobId = data?.job_id ?? data?.id ?? data;

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

  const falKey = process.env.FAL_KEY;

  if (!falKey) {
    await supabase.from("jobs").update({ status: "queued" }).eq("id", jobId);
    return NextResponse.json({
      jobId,
      status: "queued",
      note: "FAL_KEY missing; job queued until key is provided.",
    });
  }

  try {
    const signedUrl = await ensureSignedUrl(supabase, assetPath);

    const selectedDuration =
      typeof durationSeconds === "number"
        ? durationSeconds
        : FAL_DURATION_SECONDS;

    const payload = {
      prompt,
      image_url: signedUrl,
      reference_image_url: signedUrl,
      duration: selectedDuration,
      aspect_ratio: aspectRatio,
      model: modelKey,
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

    const json = await falResponse.json().catch(() => ({}));

    if (!falResponse.ok) {
      const detail =
        typeof json?.detail === "string"
          ? json.detail
          : "FAL image-to-video request failed.";
      throw new Error(detail);
    }

    const requestId =
      json?.request_id ?? json?.requestId ?? json?.id ?? null;

    await supabase
      .from("jobs")
      .update({
        status: "processing",
        provider_job_id: requestId,
      })
      .eq("id", jobId);

    return NextResponse.json({
      jobId,
      status: requestId ? "processing" : "queued",
      durationSeconds: selectedDuration,
      requestId,
    });
  } catch (error_) {
    const message =
      error_ instanceof Error ? error_.message : "Video generation failed.";
    await supabase
      .from("credit_ledger")
      .insert({
        user_id: user.id,
        delta: CREDIT_COST,
        reason: "refund_failed_start",
      });
    await supabase
      .from("jobs")
      .update({ status: "failed" })
      .eq("id", jobId);
    return NextResponse.json(
      { error: { message } },
      { status: 502 },
    );
  }
}
