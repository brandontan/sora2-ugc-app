import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";
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
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  const creditDelta = Number(process.env.SORA_CREDIT_PACK_SIZE ?? 15);

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

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_15_CREDITS;

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
      metadata: {
        user_id: user.id,
        credit_delta: String(creditDelta),
      },
    });

    const validated = successSchema.parse({ url: session.url });

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
