import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

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
      NEXT_PUBLIC_SUPABASE_URL: 'https://mock.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
      NEXT_PUBLIC_SUPABASE_REDIRECT_URL: `http://127.0.0.1:${PORT}/dashboard`,
      NEXT_PUBLIC_SUPABASE_USE_MOCK: 'true',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role',
      MOCK_API: 'true',
      SITE_URL: `http://127.0.0.1:${PORT}`,
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_PRICE_ID_15_CREDITS: 'price_1SG9IJC1d7IGO0WVBfGShmD4',
      STRIPE_WEBHOOK_SECRET: 'whsec_gElUyDPbvdNMs1koSLyxo2xBxYupnk9n',
      SORA_CREDIT_COST: '15',
      FAL_KEY: 'mock-fal-key',
      FAL_SORA_MODEL_ID: 'fal-ai/sora-2/image-to-video',
      FAL_VIDEO_DURATION_SECONDS: '20',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
