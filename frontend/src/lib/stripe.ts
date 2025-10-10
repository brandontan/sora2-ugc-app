import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripeClient() {
  if (client) return client;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }

  client = new Stripe(secretKey);

  return client;
}
