import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('organizer publishes, buyer pays, gate admits once, and mobile layout fits', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Create event', exact: true }).click();
  const name = `Launch Night ${Date.now()}`;
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await expect(page.locator('.slug-preview')).toContainText(
    name.toLowerCase().replaceAll(' ', '-'),
  );
  await page
    .getByLabel('About the event')
    .fill('A night of live music and good company in Dar es Salaam.');
  await page.getByLabel('Date & time').fill('2027-01-23T20:00');
  await page.getByLabel('Venue', { exact: true }).fill('Warehouse 7');
  await page.locator('input[type="file"]').setInputFiles('public/assets/niffer-party.jpg');
  await expect(page.getByAltText('Event cover', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Publish event', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your event is live.' })).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Open event', exact: true })
    .getAttribute('href');
  expect(href).toContain('.goldencreation.localhost');
  const context = await browser.newContext();
  const buyer = await context.newPage();
  await buyer.goto(href);
  await expect(buyer.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(buyer.getByRole('radio')).toHaveCount(0);
  await expect(buyer.getByRole('link', { name: 'All events', exact: true })).toHaveAttribute(
    'href',
    /goldencreation.localhost:5181/,
  );
  await buyer.getByLabel('Mobile money number', { exact: true }).fill('0712345678');
  await buyer.screenshot({ path: 'test-results/checkout-desktop.png', fullPage: true });
  await buyer.getByRole('button', { name: 'Pay TZS 20,000', exact: true }).click();
  await expect(buyer).toHaveURL(/\?order=[a-f0-9]+/);
  await buyer.reload();
  await expect(buyer.getByRole('heading', { name: 'Check your phone.' })).toBeVisible();
  await buyer.getByRole('button', { name: 'Approve demo payment' }).click();
  await expect(buyer.getByRole('heading', { name: 'You’re going.' })).toBeVisible();
  await expect(buyer.getByAltText(/QR ticket GE-/)).toBeVisible();
  const ticketDownload = buyer.waitForEvent('download');
  await buyer.getByRole('button', { name: 'Save ticket', exact: true }).click();
  const savedTicket = await ticketDownload;
  expect(savedTicket.suggestedFilename()).toMatch(/^GE-[A-F0-9]+-ticket\.png$/);
  await savedTicket.saveAs('test-results/saved-ticket.png');
  const qrSource = await buyer.getByAltText(/QR ticket GE-/).getAttribute('src');
  const savedSource = `data:image/png;base64,${(await readFile('test-results/saved-ticket.png')).toString('base64')}`;
  const qrPreserved = await buyer.evaluate(
    async ({ qrSource, savedSource }) => {
      const load = (source) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.src = source;
        });
      const [qr, saved] = await Promise.all([load(qrSource), load(savedSource)]);
      const original = document.createElement('canvas');
      original.width = 360;
      original.height = 360;
      const originalCtx = original.getContext('2d');
      originalCtx.drawImage(qr, 0, 0);
      const output = document.createElement('canvas');
      output.width = 800;
      output.height = 1280;
      const outputCtx = output.getContext('2d');
      outputCtx.drawImage(saved, 0, 0);
      const a = originalCtx.getImageData(0, 0, 360, 360).data,
        b = outputCtx.getImageData(220, 720, 360, 360).data;
      return a.every((value, index) => value === b[index]);
    },
    { qrSource, savedSource },
  );
  expect(qrPreserved).toBe(true);
  await buyer.screenshot({ path: 'test-results/ticket-desktop.png', fullPage: true });
  const code = await buyer.locator('.ticket-qr .mono').textContent();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Scan tickets' }).click();
  await page.getByLabel('Ticket code or ticket link').fill(code);
  await page.getByRole('button', { name: 'Admit guest' }).click();
  await expect(page.getByRole('heading', { name: 'You’re in.' })).toBeVisible();
  await page.getByLabel('Ticket code or ticket link').fill(code);
  await page.getByRole('button', { name: 'Admit guest' }).click();
  await expect(page.getByText(/Already admitted at/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  await page.getByLabel('Search orders').fill('no-such-reference');
  await expect(page.getByRole('heading', { name: 'No orders yet' })).toBeVisible();
  await page.getByLabel('Search orders').fill('');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('golden-orders.csv');
  await page.goto('/dashboard/events/new');
  await expect(page.getByLabel('Event name', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  await buyer.setViewportSize({ width: 390, height: 844 });
  await buyer.goto(href);
  await expect(buyer.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(
    await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await buyer.screenshot({ path: 'test-results/checkout-mobile.png', fullPage: true });
  const payButton = await buyer
    .getByRole('button', { name: 'Pay TZS 20,000', exact: true })
    .boundingBox();
  expect(payButton.y + payButton.height).toBeLessThanOrEqual(844);
  await context.close();
});

test('organizer workspace views render without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  for (const [path, title] of [
    ['events', 'Events'],
    ['orders', 'Orders'],
    ['guests', 'Guests'],
    ['revenue', 'Revenue'],
    ['delivery', 'Ticket delivery'],
    ['settings', 'Settings'],
    ['admin', 'Administration'],
  ]) {
    await page.goto(`/dashboard/${path}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('declined demo payments do not issue tickets and can be retried', async ({ page }) => {
  await page.goto('/e/niffer-party');
  await page.getByLabel('Mobile money number', { exact: true }).fill('0712345678');
  await page.getByRole('button', { name: 'Pay TZS 20,000', exact: true }).click();
  await page.getByRole('button', { name: 'Decline payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment declined' })).toBeVisible();
  await expect(page.getByAltText(/QR ticket/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pay TZS 20,000', exact: true })).toBeVisible();
});

test('ticket and quantity changes show the exact payable amount', async ({ page }) => {
  await page.goto('/e/niffer-party');
  await expect(page.getByRole('button', { name: 'Pay TZS 20,000', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add one ticket' }).click();
  await expect(page.getByRole('button', { name: 'Pay TZS 40,000', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /VIP/ }).check();
  await expect(page.getByRole('button', { name: 'Pay TZS 50,000', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Remove one ticket' })
    .isDisabled()
    .then((value) => expect(value).toBe(true));
});
