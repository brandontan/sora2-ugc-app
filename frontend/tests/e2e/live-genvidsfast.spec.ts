import path from 'path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const productImage = path.join(__dirname, 'fixtures', 'product.png');

const SITE_URL = process.env.SITE_URL ?? 'https://genvidsfast.com';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

test.describe.configure({ mode: 'serial' });

test('live genvidsfast flow', async ({ page, context, request }) => {
  test.slow();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    test.skip(true, 'Supabase admin credentials missing');
  }

  const projectRef = new URL(SUPABASE_URL).host.split('.')[0];
  const email =
    process.env.LIVE_TEST_EMAIL ?? 'qa+1759982107@genvidsfast.com';
  const password = process.env.LIVE_TEST_PASSWORD ?? 'Playwright1!';

  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data: tokenJson, error: tokenError } =
    await supabaseClient.auth.signInWithPassword({ email, password });

  if (tokenError) {
    console.log('Password login failed:', tokenError.message);
  }
  expect(tokenError).toBeNull();

  const session = tokenJson.session;
  expect(session).toBeTruthy();
  const expiresIn = session?.expires_in ?? 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const sessionPayload = {
    access_token: session?.access_token,
    refresh_token: session?.refresh_token,
    expires_in: expiresIn,
    token_type: session?.token_type ?? 'bearer',
    user: session?.user ?? adminUser.user,
  };

  const storageKey = `sb-${projectRef}-auth-token`;
  const storageValue = JSON.stringify({
    currentSession: sessionPayload,
    currentUser: sessionPayload.user,
    expiresAt,
  });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
  }, [storageKey, storageValue]);

  await page.goto(`${SITE_URL}/`, { waitUntil: 'networkidle' });
  const balanceDisplay = page.getByTestId('balance-value');
  if ((await balanceDisplay.count()) === 0) {
    console.log('Dashboard URL:', await page.url());
    const bodyText = await page.textContent('body');
    console.log('Body text snippet:', bodyText?.slice(0, 200) ?? '');
    await page.screenshot({ path: 'playwright-live-dashboard.png', fullPage: true });
  }
  await expect(balanceDisplay).toBeVisible({ timeout: 30_000 });

  // Check if already credited; otherwise purchase.
  let balanceText = await balanceDisplay.textContent();
  if (!balanceText || !/\d+/.test(balanceText)) {
    balanceText = '0';
  }

  if (!/15/.test(balanceText)) {
    // Purchase credits via Stripe checkout.
    const [checkoutPagePromise] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: /Buy .*credits/i }).click(),
    ]);
    const checkoutPage = await checkoutPagePromise;
    await checkoutPage.waitForLoadState('domcontentloaded');

    // Fill Stripe test card.
    await checkoutPage.getByPlaceholder('Email').fill(email);

    const fillInFrames = async (
      selector: string,
      value: string,
    ): Promise<boolean> => {
      for (const frame of checkoutPage.frames()) {
        const locator = frame.locator(selector);
        if ((await locator.count()) > 0) {
          await locator.fill(value);
          return true;
        }
      }
      return false;
    };

    await checkoutPage.waitForTimeout(1000);
    await fillInFrames('input[name="cardnumber"], input[placeholder="Card number"]', '4242424242424242');
    await fillInFrames('input[name="exp-date"], input[placeholder="MM / YY"]', '1230');
    await fillInFrames('input[name="cvc"], input[placeholder="CVC"]', '123');
    await fillInFrames('input[name="postal"], input[placeholder="ZIP"]', '10001');

    const nameField = checkoutPage.getByPlaceholder('Name on card');
    if ((await nameField.count()) > 0) {
      await nameField.fill('Playwright Live Test');
    }

    await checkoutPage.getByRole('button', { name: /Pay|Subscribe|Complete/i }).click();

    await checkoutPage.waitForURL('**/dashboard?checkout=success', {
      timeout: 30_000,
    });

    await page.waitForURL('**/dashboard?checkout=success', {
      timeout: 30_000,
    });

    await expect(balanceDisplay).toHaveText(/15/, { timeout: 60_000 });
  }

  // Upload product image and select duration.
  await page.setInputFiles('input#product-file', productImage);
  await page.fill(
    'textarea',
    'TikTok creator shows energetic product demo with bold captions and CTA.',
  );

  const durationSelect = page.locator('select');
  if ((await durationSelect.count()) > 0) {
    await durationSelect.first().selectOption('10');
  }

  await page
    .getByRole('button', { name: /Generate with Sora2/i })
    .click();

  await expect(
    page.getByText(/Job .* queued/, { useInnerText: true }),
  ).toBeVisible();

  // Wait for download link (fal.ai job). Allow up to 7 minutes.
  const downloadLink = page.getByRole('link', { name: /Download/i });
  await expect(downloadLink).toBeVisible({ timeout: 420_000 });

  const href = await downloadLink.getAttribute('href');
  expect(href).toBeTruthy();
});
