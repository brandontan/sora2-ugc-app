const DEFAULT_PACK_PRICE_USD = 15;
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
