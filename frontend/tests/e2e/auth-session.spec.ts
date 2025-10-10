import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  applySupabaseSession,
  clearSupabaseState,
  createSupabaseSession,
  type SupabaseSessionSeed,
} from './helpers/supabase-session';

const SITE_URL = process.env.SITE_URL ?? 'https://genvidsfast.com';

const ensureDashboard = async (page: Page, dashboardUrl: string) => {
  if (page.url().includes('/dashboard')) return;

  const launchCta = page.getByRole('button', {
    name: /launch workspace|open dashboard|start creating|start now/i,
  });

  if (await launchCta.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await launchCta.click();
    await page.waitForURL('**/dashboard**', { timeout: 60_000 });
    return;
  }

  const emailCta = page.getByRole('button', { name: /email me access|email me a link/i }).first();
  if (await emailCta.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await emailCta.click();
  }

  await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
  await page.waitForURL('**/dashboard**', { timeout: 60_000 });
};

test.describe('Supabase auth session', () => {
  test.beforeEach(async ({ page }) => {
    await clearSupabaseState(page);
  });

  test.afterEach(async ({ page }) => {
    await clearSupabaseState(page);
  });

  test('seeds session and reaches dashboard', async ({ page, context }) => {
    const email = process.env.LIVE_TEST_EMAIL ?? 'qa+seed@genvidsfast.com';
    const password = process.env.LIVE_TEST_PASSWORD ?? 'Playwright1!';

    const numberFromEnv = (value?: string) => {
      if (!value) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const sessionResult = await createSupabaseSession({
      email,
      password,
      maxAttempts: numberFromEnv(process.env.LIVE_TEST_LOGIN_ATTEMPTS),
      retryDelayMs: numberFromEnv(process.env.LIVE_TEST_LOGIN_DELAY_MS),
      retryJitterMs: numberFromEnv(process.env.LIVE_TEST_LOGIN_JITTER_MS),
    });

    if (sessionResult.status === 'skipped') {
      test.skip(true, sessionResult.reason);
    }

    const sessionSeed: SupabaseSessionSeed = sessionResult.seed;

    const dashboardUrl = SITE_URL.endsWith('/') ? `${SITE_URL}dashboard` : `${SITE_URL}/dashboard`;

    if (sessionSeed.magicLink) {
      await page.goto(sessionSeed.magicLink, { waitUntil: 'networkidle' });
      await page.waitForURL('**/dashboard**', { timeout: 60_000 });
    } else {
      await applySupabaseSession({
        page,
        context,
        seed: sessionSeed,
        dashboardUrl,
      });
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
    }

    await ensureDashboard(page, dashboardUrl);

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('balance-value')).toBeVisible({ timeout: 30_000 });
  });
});
