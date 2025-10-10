import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    secretPresent: Boolean(process.env.STRIPE_SECRET_KEY),
    priceId: process.env.STRIPE_PRICE_ID_15_CREDITS ?? null,
    webhookPresent: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    env: process.env.VERCEL_ENV ?? null,
  });
}
