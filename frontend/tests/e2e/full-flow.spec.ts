import { expect, test } from '@playwright/test';
import path from 'path';

const productImage = path.join(__dirname, 'fixtures', 'product.png');

async function waitForDownloadLink(page) {
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 15000 });
}

test('user can sign in, buy credits, generate video, and download', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toHaveText(/Product photo\s+→\s+Sora video/i);

  const emailInput = page.getByPlaceholder('you@brand.com');
  await emailInput.fill('mock-user@example.com');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  await page.getByRole('button', { name: 'Buy credits' }).click();
  await page.waitForURL('**/dashboard?checkout=mock-success', { timeout: 10000 });
  await expect(page.getByTestId('balance-value')).toHaveText(/15/);

  await page.setInputFiles('input#product-file', productImage);
  await page.fill('textarea', 'TikTok creator shows energetic product demo with bold captions.');
  await page.getByRole('button', { name: 'Generate with Sora2' }).click();

  await expect(page.getByText(/Job .* queued/)).toBeVisible();

  await waitForDownloadLink(page);
});
