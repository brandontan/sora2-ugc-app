import { defineConfig, devices } from '@playwright/test';

const shouldUseMock =
  process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK !== 'false' &&
  process.env.MOCK_API !== 'false';

if (shouldUseMock) {
  process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK ??= 'true';
  process.env.MOCK_API ??= 'true';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://mock.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'mock-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'mock-service-role';
  process.env.SITE_URL ??= 'http://127.0.0.1:3000';
  process.env.SORA_CREDIT_COST ??= '5';
process.env.SORA_CREDIT_PACK_SIZE ??= '75';
}

const PORT = 3000;
const defaultSiteUrl = `http://127.0.0.1:${PORT}`;

if (!process.env.SITE_URL) {
  process.env.SITE_URL = defaultSiteUrl;
}

const normalizedSiteUrl = process.env.SITE_URL.endsWith('/')
  ? process.env.SITE_URL.slice(0, -1)
  : process.env.SITE_URL;

process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URL ??= `${normalizedSiteUrl}/dashboard`;
process.env.SORA_CREDIT_COST ??= process.env.NEXT_PUBLIC_SORA_CREDIT_COST ?? process.env.SORA_CREDIT_COST ?? '5';
process.env.SORA_CREDIT_PACK_SIZE ??=
  process.env.NEXT_PUBLIC_SORA_CREDIT_PACK_SIZE ?? process.env.SORA_CREDIT_PACK_SIZE ?? '75';
process.env.FAL_SORA_MODEL_ID ??= process.env.NEXT_PUBLIC_FAL_SORA_MODEL_ID ?? 'fal-ai/sora-2/image-to-video';
process.env.FAL_VIDEO_DURATION_SECONDS ??=
  process.env.NEXT_PUBLIC_FAL_VIDEO_DURATION_SECONDS ?? '20';
process.env.FAL_KEY ??= process.env.NEXT_PUBLIC_FAL_KEY ?? 'mock-fal-key';
process.env.STRIPE_PRICE_ID_15_CREDITS ??=
  process.env.STRIPE_PRICE_ID_15_CREDITS ?? 'price_1SG9IJC1d7IGO0WVBfGShmD4';
process.env.STRIPE_WEBHOOK_SECRET ??=
  process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_gElUyDPbvdNMs1koSLyxo2xBxYupnk9n';
process.env.STRIPE_SECRET_KEY ??=
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_mock';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port ' + PORT,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://mock.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'mock-anon-key',
      NEXT_PUBLIC_SUPABASE_REDIRECT_URL: process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URL ?? `${defaultSiteUrl}/dashboard`,
      NEXT_PUBLIC_SUPABASE_USE_MOCK: process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK ?? 'true',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'mock-service-role',
      MOCK_API: process.env.MOCK_API ?? 'true',
      SITE_URL: process.env.SITE_URL ?? defaultSiteUrl,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? 'sk_test_mock',
      STRIPE_PRICE_ID_15_CREDITS:
        process.env.STRIPE_PRICE_ID_15_CREDITS ?? 'price_1SG9IJC1d7IGO0WVBfGShmD4',
      STRIPE_WEBHOOK_SECRET:
        process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_gElUyDPbvdNMs1koSLyxo2xBxYupnk9n',
      SORA_CREDIT_COST: process.env.SORA_CREDIT_COST ?? '5',
      SORA_CREDIT_PACK_SIZE: process.env.SORA_CREDIT_PACK_SIZE ?? '75',
      FAL_KEY: process.env.FAL_KEY ?? 'mock-fal-key',
      FAL_SORA_MODEL_ID: process.env.FAL_SORA_MODEL_ID ?? 'fal-ai/sora-2/image-to-video',
      FAL_VIDEO_DURATION_SECONDS: process.env.FAL_VIDEO_DURATION_SECONDS ?? '20',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
