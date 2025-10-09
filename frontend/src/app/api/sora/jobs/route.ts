import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { pushLedger, upsertJob, sumLedgerForUser } from "@/lib/mock-store";

const requestSchema = z.object({
  prompt: z.string().min(8, "Prompt is too short."),
  assetPath: z.string().min(4, "Upload path missing."),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(60)
    .optional(),
});

const CREDIT_COST = Number(process.env.SORA_CREDIT_COST ?? 15);
const FAL_MODEL =
  process.env.FAL_SORA_MODEL_ID ?? "fal-ai/sora-2/image-to-video";
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

  const { prompt, assetPath, durationSeconds } = body.data;

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
              "Balance is too low. Add a 15-credit pack before launching another job.",
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
            "Balance is too low. Add a 15-credit pack before launching another job.",
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
      aspect_ratio: "16:9",
    };

    const modelPath = FAL_MODEL.replace(/^https?:\/\//, "").replace(
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
