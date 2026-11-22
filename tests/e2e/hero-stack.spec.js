import { test, expect } from '@playwright/test';

test('hero cards overlap, scale back, reverse on scroll, and keep the ribbon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const cards = page.locator('.hero-stack-card');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.hero-stack-section')).toHaveCSS(
    'background-color',
    'rgb(255, 177, 132)',
  );
  await expect
    .poll(() =>
      page
        .locator('.hero-stack-photo img')
        .first()
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  const first = cards.nth(0);
  const initial = await first.evaluate((el) => Number(el.style.getPropertyValue('--stack-scale')));
  await page.screenshot({ path: 'test-results/hero-stack-desktop.png' });
  const markerTop = await page
    .locator('.scroll-stack__marker')
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => scrollTo(0, y - 250), markerTop);
  await expect
    .poll(() => first.evaluate((el) => Number(el.style.getPropertyValue('--stack-scale'))))
    .toBeLessThan(initial);
  const firstBox = await first.boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(firstBox.y).toBeLessThan(130);
  expect(secondBox.y).toBeLessThan(firstBox.y + firstBox.height);
  await page.screenshot({ path: 'test-results/hero-stack-overlap.png' });
  await page.evaluate(() => scrollTo(0, 0));
  await expect
    .poll(() => first.evaluate((el) => Number(el.style.getPropertyValue('--stack-scale'))))
    .toBe(initial);
  await first.getByRole('button', { name: 'Explore sports' }).click();
  await expect(
    page
      .getByRole('group', { name: 'Event category' })
      .getByRole('button', { name: 'Sports', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.text-loop-svg')).toHaveCount(1);
  const finalMarker = await page
    .locator('.scroll-stack__marker')
    .last()
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => scrollTo(0, y - 120 + 200), finalMarker);
  await expect.poll(async () => Math.round((await cards.last().boundingBox()).y)).toBe(120);
  const finalBox = await cards.last().boundingBox();
  expect(finalBox.y + finalBox.height).toBeLessThan(1000);
  await page.screenshot({ path: 'test-results/hero-stack-final.png' });
});

test('hero fits mobile and reduced motion leaves all cards in normal flow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('.hero-stack-card').first();
  await expect(card.getByRole('button', { name: 'Explore sports' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const contentFits = await card.evaluate((el) => {
    const copy = el.querySelector('.hero-stack-copy').getBoundingClientRect();
    const button = el.querySelector('button').getBoundingClientRect();
    return button.bottom <= copy.bottom;
  });
  expect(contentFits).toBe(true);
  await page.screenshot({ path: 'test-results/hero-stack-mobile.png' });
  const lastMarker = await page
    .locator('.scroll-stack__marker')
    .last()
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => scrollTo(0, y - 92 + 200), lastMarker);
  await expect
    .poll(async () => Math.round((await page.locator('.hero-stack-card').last().boundingBox()).y))
    .toBe(92);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('position', 'relative');
  await expect(card).toHaveCSS('transform', 'none');
});

test('the completed stack holds, releases, and recalculates after resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const stack = page.locator('.hero-stack');
  const last = page.locator('.hero-stack-card').last();
  await expect(last).toBeAttached();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    const pin = viewport.width > 700 ? 120 : 92;
    const position = await page
      .locator('.scroll-stack__marker')
      .last()
      .evaluate((el) => el.getBoundingClientRect().top + scrollY);
    await page.evaluate((y) => scrollTo(0, y), position - pin + 200);
    await expect.poll(async () => Math.round((await last.boundingBox()).y)).toBe(pin);
    const gap = await last.evaluate(
      (el) =>
        el.querySelector('.hero-stack-photo').getBoundingClientRect().top -
        el.querySelector('button').getBoundingClientRect().bottom,
    );
    if (viewport.width < 700) expect(gap).toBeLessThanOrEqual(20);
    const end = await stack.evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
    await page.evaluate((y) => scrollTo(0, y), end + 20);
    await expect
      .poll(async () => (await last.boundingBox()).y + (await last.boundingBox()).height)
      .toBeLessThan(0);
  }
});
