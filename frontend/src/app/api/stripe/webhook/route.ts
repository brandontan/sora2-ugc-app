import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { getServiceClient } from "@/lib/supabase/service-client";
import { getCreditsForPrice } from "@/lib/pricing";

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

  const supabase = getServiceClient();

  const eventInsert = await supabase
    .from("stripe_events")
    .insert({
      event_id: event.id,
      event_type: event.type,
      session_id:
        (event.data.object as { id?: string } | undefined)?.id ?? null,
    })
    .select("id")
    .single();

  if (eventInsert.error) {
    const message = String(eventInsert.error.message ?? eventInsert.error);
    if (message.includes("duplicate key") || message.includes("23505")) {
      return NextResponse.json({ received: true });
    }
    console.error("stripe-webhook: failed to record event", eventInsert.error);
    return NextResponse.json(
      { error: { message: "Could not record event." } },
      { status: 500 },
    );
  }

  const eventRowId = eventInsert.data.id as string;

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        throw new Error(
          `Skipping credits because payment_status=${session.payment_status}`,
        );
      }

      const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items"],
      });

      const lineItems = expandedSession.line_items?.data ?? [];
      let totalCredits = 0;
      for (const item of lineItems) {
        const priceId = item.price?.id ?? null;
        const creditsPerUnit = getCreditsForPrice(priceId);
        if (!creditsPerUnit) {
          console.warn("stripe-webhook: unknown price id", priceId);
          continue;
        }
        const quantity = item.quantity ?? 1;
        totalCredits += creditsPerUnit * quantity;
      }

      if (totalCredits <= 0) {
        throw new Error("No recognized Stripe price mapping for checkout session");
      }

      const userId = expandedSession.client_reference_id ?? session.metadata?.user_id ?? null;
      if (!userId) {
        throw new Error("Missing user id for checkout session");
      }

      await supabase.from("credit_ledger").insert({
        user_id: userId,
        delta: totalCredits,
        reason: "stripe_checkout",
      });

      await supabase
        .from("stripe_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("id", eventRowId);
    } else {
      await supabase
        .from("stripe_events")
        .update({ status: "ignored", processed_at: new Date().toISOString() })
        .eq("id", eventRowId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("stripe-webhook", message);
    await supabase
      .from("stripe_events")
      .update({ status: "errored", error_message: message, processed_at: new Date().toISOString() })
      .eq("id", eventRowId);
    return NextResponse.json(
      { error: { message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
