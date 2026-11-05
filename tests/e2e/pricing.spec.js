import { test, expect } from '@playwright/test';

test('pricing navigation, configured fee, calculator, FAQ and mobile layout', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, platformFeeBps: 500 } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Pricing' })
    .click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'Your moment. More possibility.' })).toBeVisible();
  await expect(page.locator('.pricing-net strong')).toHaveText('TZS 1,900,000');
  await page.getByLabel('Ticket price (TZS)').fill('10000');
  await page.getByLabel('Tickets sold').fill('10');
  await expect(page.locator('.pricing-net strong')).toHaveText('TZS 95,000');
  await page.getByLabel('Ticket price (TZS)').fill('');
  await expect(page.locator('.pricing-net strong')).toHaveText('—');
  await page.getByLabel('Ticket price (TZS)').fill('20000');
  await page.getByText('Are payment provider charges included?', { exact: true }).click();
  await expect(
    page
      .getByText('Provider charges are separate from the Golden Events fee.', { exact: false })
      .last(),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/pricing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'Pricing' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pricing-mobile.png', fullPage: true });
});
