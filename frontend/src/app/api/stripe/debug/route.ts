import { NextResponse } from "next/server";

const mask = (value?: string | null) => {
  if (!value) return null;
  if (value.length <= 8) return value;
  return `${value.slice(0,6)}…${value.slice(-4)}`;
};

export async function GET() {
  return NextResponse.json({
    secret: mask(process.env.STRIPE_SECRET_KEY),
    priceId: process.env.STRIPE_PRICE_ID_15_CREDITS ?? null,
    webhook: mask(process.env.STRIPE_WEBHOOK_SECRET),
    env: process.env.VERCEL_ENV ?? null,
  });
}
