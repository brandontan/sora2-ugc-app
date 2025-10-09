import { defineConfig, devices } from '@playwright/test';

import path from 'path';

export default defineConfig({
  testDir: path.resolve(__dirname, '.'),
  timeout: 180_000,
  expect: {
    timeout: 45_000,
  },
  retries: 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://genvidsfast.com',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
