import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!signature || !secret) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const stripe = getStripeClient();
  const rawBody = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : "Could not verify webhook.",
        },
      },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const delta = Number(session.metadata?.credit_delta ?? 0);

    if (userId && Number.isFinite(delta) && delta > 0) {
      const supabase = getServiceClient();
      await supabase.from("credit_ledger").insert({
        user_id: userId,
        delta,
        reason: "stripe_checkout",
      });
    }
  }

  return NextResponse.json({ received: true });
}
