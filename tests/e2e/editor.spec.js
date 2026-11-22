import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('editor clears numeric fields, crops artwork, preserves portrait proportions, and links home', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await page.goto('/dashboard/events/new');
  const config = await (await page.request.get('/api/config')).json();
  await expect(page.getByRole('link', { name: 'Back to homepage' })).toHaveAttribute(
    'href',
    config.publicOrigin,
  );
  for (const field of ['#ticket-price-0', '#ticket-capacity-0']) {
    await page.locator(field).fill('');
    await expect(page.locator(field)).toHaveValue('');
    await page.locator(field).fill('500');
    await expect(page.locator(field)).toHaveValue('500');
  }
  const buffer = await sharp({
    create: { width: 400, height: 800, channels: 3, background: '#c65d32' },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Use full picture' }).click();
  await page.getByRole('button', { name: 'Save picture', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const preview = page.locator('img.preview-image');
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((img) => img.naturalWidth / img.naturalHeight))
    .toBe(0.5);
  const bounds = await preview.boundingBox();
  expect(bounds.height / bounds.width).toBeCloseTo(2, 1);
  expect(bounds.width).toBeLessThanOrEqual(240);
  const card = await page.locator('.preview-surface').boundingBox();
  expect(card.width - bounds.width).toBeCloseTo(2, 0);
  await expect(preview).toHaveCSS('object-fit', 'contain');
  await page.getByRole('button', { name: 'Crop picture', exact: true }).click();
  const crop = page.locator('.ReactCrop__crop-selection');
  await expect(crop).toBeVisible();
  const handle = page.locator('.ReactCrop__drag-handle.ord-se');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y - 80, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save picture', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByPlaceholder('Something people will remember').fill('Portrait party');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Event preview' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Portrait party' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Back to form' })).toBeFocused();
  await expect.poll(async () => Math.round((await panel.boundingBox()).x)).toBe(0);
  const panelBounds = await panel.boundingBox();
  expect(panelBounds.width).toBe(390);
  expect(panelBounds.height).toBe(844);
  await panel.getByRole('button', { name: 'Back to form' }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByPlaceholder('Something people will remember')).toHaveValue(
    'Portrait party',
  );
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
});
