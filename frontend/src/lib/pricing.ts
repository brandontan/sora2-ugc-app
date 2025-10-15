const DEFAULT_PACK_PRICE_USD = 20;
const DEFAULT_CREDIT_PACK_SIZE = 75;
const DEFAULT_CREDIT_COST = 5;
const DEFAULT_PROVIDER_COST_USD = 0.4;
const DEFAULT_STRIPE_PERCENT = 2.9;
const DEFAULT_STRIPE_FIXED_USD = 0.3;

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type PricingSummary = {
  packPriceUsd: number;
  creditsPerPack: number;
  creditCostPerRun: number;
  runsPerPack: number;
  runPriceUsd: number;
  stripeFeePerPackUsd: number;
  stripeFeePerRunUsd: number;
  providerCostPerRunUsd: number;
  netPerRunUsd: number;
  grossMarginPercent: number;
};

export function getCreditPackSize(): number {
  const envValue =
    process.env.NEXT_PUBLIC_SORA_CREDIT_PACK_SIZE ?? process.env.SORA_CREDIT_PACK_SIZE;
  return parseNumber(envValue, DEFAULT_CREDIT_PACK_SIZE);
}

const stripePriceToCredits = () => {
  const mappings: Record<string, number> = {};
  const primaryPrice = process.env.STRIPE_PRICE_ID_15_CREDITS?.trim();
  if (primaryPrice) {
    mappings[primaryPrice] = getCreditPackSize();
  }
  const additional = process.env.STRIPE_PRICE_CREDIT_MAPPING;
  if (additional) {
    try {
      const parsed = JSON.parse(additional) as Record<string, number>;
      for (const [priceId, credits] of Object.entries(parsed)) {
        if (typeof priceId === "string" && Number.isFinite(credits)) {
          mappings[priceId] = Number(credits);
        }
      }
    } catch {
      // Ignore malformed mapping; safe fallback to primary price mapping only.
    }
  }
  return mappings;
};

export function getCreditsForPrice(priceId: string | null | undefined): number | null {
  if (!priceId) return null;
  const normalized = priceId.trim();
  if (!normalized) return null;
  const mappings = stripePriceToCredits();
  return normalized in mappings ? mappings[normalized] : null;
}

export function getPricingSummary(): PricingSummary {
  const packPriceUsd = parseNumber(
    process.env.NEXT_PUBLIC_SORA_PACK_PRICE_USD ?? process.env.SORA_PACK_PRICE_USD,
    DEFAULT_PACK_PRICE_USD,
  );
  const creditsPerPack = getCreditPackSize();
  const creditCostPerRun = parseNumber(
    process.env.NEXT_PUBLIC_SORA_CREDIT_COST ?? process.env.SORA_CREDIT_COST,
    DEFAULT_CREDIT_COST,
  );
  const providerCostPerRunUsd = parseNumber(
    process.env.NEXT_PUBLIC_SORA_PROVIDER_COST_USD ?? process.env.SORA_PROVIDER_COST_USD,
    DEFAULT_PROVIDER_COST_USD,
  );
  const stripePercent =
    parseNumber(
      process.env.NEXT_PUBLIC_STRIPE_PERCENT_FEE ?? process.env.STRIPE_PERCENT_FEE,
      DEFAULT_STRIPE_PERCENT,
    ) / 100;
  const stripeFixedPerChargeUsd = parseNumber(
    process.env.NEXT_PUBLIC_STRIPE_FIXED_FEE_USD ?? process.env.STRIPE_FIXED_FEE_USD,
    DEFAULT_STRIPE_FIXED_USD,
  );

  const runsPerPack = creditsPerPack / creditCostPerRun;
  const runPriceUsd = packPriceUsd / runsPerPack;

  const stripeFeePerPackUsd = packPriceUsd * stripePercent + stripeFixedPerChargeUsd;
  const stripeFeePerRunUsd = stripeFeePerPackUsd / runsPerPack;

  const netPerRunUsd = runPriceUsd - stripeFeePerRunUsd - providerCostPerRunUsd;
  const grossMarginPercent = (netPerRunUsd * runsPerPack) / packPriceUsd * 100;

  return {
    packPriceUsd,
    creditsPerPack,
    creditCostPerRun,
    runsPerPack,
    runPriceUsd,
    stripeFeePerPackUsd,
    stripeFeePerRunUsd,
    providerCostPerRunUsd,
    netPerRunUsd,
    grossMarginPercent,
  };
}
