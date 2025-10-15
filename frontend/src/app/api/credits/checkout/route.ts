import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getCreditPackSize } from "@/lib/pricing";
import { getStripeClient } from "@/lib/stripe";
import { pushLedger } from "@/lib/mock-store";

const successSchema = z.object({
  url: z.string().url(),
});

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const token = authHeader.slice("Bearer ".length);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://genvidsfast.com";
  const creditDelta = getCreditPackSize();

  if (process.env.MOCK_API === "true") {
    const userId =
      token && token !== "null" ? token.replace("mock-session:", "") : "mock-user";

    pushLedger({
      id: crypto.randomUUID(),
      user_id: userId,
      delta: creditDelta,
      reason: "stripe_checkout_mock",
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      url: `${siteUrl}/dashboard?checkout=mock-success`,
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

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID_15_CREDITS?.trim();

  if (!stripeSecret || !priceId) {
    return NextResponse.json(
      {
        error: {
          message:
            "Stripe configuration missing. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID_15_CREDITS.",
        },
      },
      { status: 500 },
    );
  }

  const { count: recentCount, error: rateError } = await supabase
    .from("stripe_checkout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte(
      "created_at",
      new Date(Date.now() - 60_000).toISOString(),
    );

  if (rateError) {
    console.error("stripe-checkout: rate limit query failed", rateError);
    return NextResponse.json(
      { error: { message: "Could not verify checkout eligibility." } },
      { status: 500 },
    );
  }

  if ((recentCount ?? 0) >= 3) {
    return NextResponse.json(
      {
        error: {
          message:
            "Too many checkout attempts in the last minute. Please wait a moment and try again.",
        },
      },
      { status: 429 },
    );
  }

  const stripe = getStripeClient();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email ?? undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/dashboard?checkout=success`,
      cancel_url: `${siteUrl}/dashboard?checkout=cancel`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        credit_delta: String(creditDelta),
      },
    });

    const validated = successSchema.parse({ url: session.url });

    const { error: logError } = await supabase
      .from("stripe_checkout_sessions")
      .insert({ user_id: user.id, session_id: session.id });

    if (logError) {
      console.error("stripe-checkout: failed to log session", logError);
    }

    return NextResponse.json(validated);
  } catch (error) {
    console.error("stripe-checkout", error);
    const message =
      error instanceof Error ? error.message : "Stripe checkout failed.";
    return NextResponse.json(
      { error: { message } },
      { status: 500 },
    );
  }
}
