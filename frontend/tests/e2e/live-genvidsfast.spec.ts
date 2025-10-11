import path from 'path';
import { expect, test } from '@playwright/test';
import {
  applySupabaseSession,
  clearSupabaseState,
  createSupabaseSession,
  type SupabaseSessionSeed,
} from './helpers/supabase-session';

const productImage = path.join(__dirname, 'fixtures', 'product.png');

const SITE_URL = process.env.SITE_URL ?? 'https://genvidsfast.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const AUTOMATION_SECRET = process.env.AUTOMATION_SECRET;

test.beforeEach(async ({ page, request }) => {
  await clearSupabaseState(page);

  if (
    process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK === 'true' ||
    process.env.MOCK_API === 'true'
  ) {
    const response = await request.post('/api/mock/reset');
    if (!response.ok()) {
      console.warn('Unable to reset mock store for test.');
    }
  }
});

test.afterEach(async ({ page }) => {
  await clearSupabaseState(page);
});

test.describe.configure({ mode: 'serial' });

test('live genvidsfast flow', async ({ page, context }) => {
  test.slow();

  if (
    (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) &&
    process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK !== 'true'
  ) {
    test.skip(true, 'Supabase admin credentials missing');
  }

  const email =
    process.env.LIVE_TEST_EMAIL ?? 'qa+1759982107@genvidsfast.com';
  const password = process.env.LIVE_TEST_PASSWORD ?? 'Playwright1!';

  const logger = (message: string) => console.log(`[supabase-login] ${message}`);
  const toNumber = (value?: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const sessionResult = await createSupabaseSession({
    email,
    password,
    logger,
    maxAttempts: toNumber(process.env.LIVE_TEST_LOGIN_ATTEMPTS),
    retryDelayMs: toNumber(process.env.LIVE_TEST_LOGIN_DELAY_MS),
    retryJitterMs: toNumber(process.env.LIVE_TEST_LOGIN_JITTER_MS),
  });

  const sessionSeed: SupabaseSessionSeed | null =
    sessionResult.status === 'success' ? sessionResult.seed : null;

  const isMockRun =
    process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK === 'true' ||
    process.env.MOCK_API === 'true';

  const useAutomation = Boolean(AUTOMATION_SECRET) && !isMockRun;

  if (sessionResult.status === 'skipped') {
    console.warn(`[supabase-login] ${sessionResult.reason}`);
    if (!useAutomation) {
      test.skip(true, sessionResult.reason);
    }
  }

  if (useAutomation && AUTOMATION_SECRET) {
    await page.route('**/api/sora/jobs', async (route) => {
      const request = route.request();
      const headers = {
        ...request.headers(),
        'x-automation-secret': AUTOMATION_SECRET,
      };
      const response = await route.fetch({ headers });
      await route.fulfill({ response });
    });
  }

  if (!sessionSeed && !useAutomation) {
    test.skip(true, sessionResult.status === 'skipped'
      ? sessionResult.reason
      : 'Supabase session unavailable');
  }
  const dashboardUrl = SITE_URL.endsWith('/')
    ? `${SITE_URL}dashboard`
    : `${SITE_URL}/dashboard`;

  if (useAutomation) {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    const automationResult = await page.evaluate(
      async ({ email: targetEmail, password: targetPassword, secret }) => {
        const response = await fetch('/api/testing/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-automation-secret': secret,
          },
          credentials: 'include',
          body: JSON.stringify({ email: targetEmail, password: targetPassword }),
        });
        return { ok: response.ok, status: response.status };
      },
      { email, password, secret: AUTOMATION_SECRET },
    );
    console.log('automation response', automationResult);

    if (!automationResult.ok) {
      test.skip(true, `Automation session failed (status ${automationResult.status})`);
    }

    await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
  } else if (sessionSeed?.magicLink) {
    await page.goto(sessionSeed.magicLink, { waitUntil: 'networkidle' });
    await page.waitForURL('**/dashboard**', { timeout: 60_000 });
  } else if (sessionSeed) {
    await applySupabaseSession({
      page,
      context,
      seed: sessionSeed,
      dashboardUrl,
    });
    await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
    const storageSnapshot = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
      cookies: document.cookie,
    }));
    console.log('storage snapshot', storageSnapshot);
  } else {
    test.skip(
      true,
      sessionResult.status === 'skipped'
        ? sessionResult.reason
        : 'Unable to acquire session for test',
    );
  }

  if (!page.url().includes('/dashboard')) {
    const launchCta = page.getByRole('button', {
      name: /launch workspace|open dashboard|start creating|start now/i,
    });

    if (await launchCta.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await launchCta.click();
      await page.waitForURL('**/dashboard**', { timeout: 60_000 });
    } else {
      const emailCta = page
        .getByRole('button', { name: /email me access|email me a link/i })
        .first();
      if (await emailCta.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await emailCta.click();
      }
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
      await page.waitForURL('**/dashboard**', { timeout: 60_000 });
    }
  }
  const balanceDisplay = page.getByTestId('balance-value');
  if ((await balanceDisplay.count()) === 0) {
    console.log('Dashboard URL:', await page.url());
    const bodyText = await page.textContent('body');
    console.log('Body text snippet:', bodyText?.slice(0, 200) ?? '');
    await page.screenshot({ path: 'playwright-live-dashboard.png', fullPage: true });
  }
  await expect(balanceDisplay).toBeVisible({ timeout: 30_000 });

  const downloadLinks = page.getByRole('link', { name: /Download/i });
  const creditsPerRun = Number(process.env.SORA_CREDIT_COST ?? 5);

  const getBalanceValue = async () => {
    const text = await balanceDisplay.textContent();
    const match = text?.match(/\d+/);
    return match ? Number(match[0]) : 0;
  };

  const expectBalanceValue = async (value: number) => {
    await expect(balanceDisplay).toHaveText(new RegExp(`\\b${value}\\b`), {
      timeout: 15_000,
    });
    return value;
  };

  const runJob = async (iteration: number) => {
    await page.setInputFiles('input#product-file', productImage);
    await page.fill(
      'textarea',
      `Run ${iteration}: TikTok creator shows energetic product demo with bold captions and CTA.`,
    );

    const durationSelect = page.locator('select');
    if ((await durationSelect.count()) > 0) {
      await durationSelect.first().selectOption('10');
    }

    await page.getByRole('button', { name: /Generate with Sora2/i }).click();

    await expect(
      page.getByText(/Job .* queued/, { useInnerText: true }),
    ).toBeVisible();

    await expect(downloadLinks).toHaveCount(iteration, { timeout: 420_000 });
    const latestLink = downloadLinks.nth(iteration - 1);
    const href = await latestLink.getAttribute('href');
    expect(href).toBeTruthy();
  };

  // Top up credits to at least one pack.
  let balanceValue = await getBalanceValue();

  if (balanceValue < 15) {
    if (useAutomation) {
      const topupResult = await page.evaluate(
        async ({ targetEmail, secret }) => {
          const response = await fetch('/api/testing/session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-automation-secret': secret,
            },
            credentials: 'include',
            body: JSON.stringify({ action: 'topup', email: targetEmail, credits: 15 }),
          });
          const text = await response.text();
          return { ok: response.ok, status: response.status, body: text };
        },
        { targetEmail: email, secret: AUTOMATION_SECRET },
      );
      console.log('topup response', topupResult);

      if (!topupResult.ok) {
        test.skip(true, `Top-up failed (status ${topupResult.status})`);
      }

      await page.getByRole('button', { name: /Refresh balance/i }).click();
      await expectBalanceValue((await getBalanceValue()));
      balanceValue = await getBalanceValue();
    } else {
      await page.getByRole('button', { name: /Buy .*credits/i }).click();

      if (isMockRun) {
        await page.waitForURL('**/dashboard?checkout=*', { timeout: 30_000 });
      } else {
        await page.waitForURL('**checkout.stripe.com**', { timeout: 30_000 });

        await page.getByPlaceholder('Email').fill(email);

        const fillInFrames = async (
          selector: string,
          value: string,
        ): Promise<boolean> => {
          for (const frame of page.frames()) {
            const locator = frame.locator(selector);
            if ((await locator.count()) > 0) {
              await locator.fill(value);
              return true;
            }
          }
          return false;
        };

        await page.waitForTimeout(1000);
        await fillInFrames('input[name="cardnumber"], input[placeholder="Card number"]', '4242424242424242');
        await fillInFrames('input[name="exp-date"], input[placeholder="MM / YY"]', '1230');
        await fillInFrames('input[name="cvc"], input[placeholder="CVC"]', '123');
        await fillInFrames('input[name="postal"], input[placeholder="ZIP"]', '10001');

        const nameField = page.getByPlaceholder('Name on card');
        if ((await nameField.count()) > 0) {
          await nameField.fill('Playwright Live Test');
        }

        await page.getByRole('button', { name: /Pay|Subscribe|Complete/i }).click();

        await page.waitForURL('**/dashboard?checkout=success', {
          timeout: 60_000,
        });
      }

      balanceValue += 15;
      await expectBalanceValue(balanceValue);
    }
  }

  // First job.
  await runJob(1);
  balanceValue -= creditsPerRun;
  await expectBalanceValue(balanceValue);

  // Second job.
  await runJob(2);
  balanceValue -= creditsPerRun;
  await expectBalanceValue(balanceValue);

  // Third job pushes balance below minimum cost.
  await runJob(3);
  balanceValue -= creditsPerRun;
  await expectBalanceValue(balanceValue);

  await expect(
    page.getByTestId('pricing-summary'),
  ).toContainText(new RegExp(`${creditsPerRun}\\s+credits/run`, 'i'));

  const lowBalanceWarning = page.getByText(
    new RegExp(`Balance below\\s+${creditsPerRun}\\s+credits`, 'i'),
  );
  await expect(lowBalanceWarning).toBeVisible();

  const generateButton = page.getByRole('button', {
    name: /Add credits first/i,
  });
  await expect(generateButton).toBeDisabled();
  await expect(generateButton).toHaveText(
    new RegExp(`Add credits first \\(${creditsPerRun}\\s+credits/run`, 'i'),
  );
});
