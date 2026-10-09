import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('uncertain Ecofy payments keep checking and never encourage a second payment', async ({
  page,
}) => {
  const event = (await (await page.request.get('/api/events')).json()).events[0];
  let uncertain = true;
  await page.route('**/api/config', async (route) => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, paymentDriver: 'ecofy' } });
  });
  await page.route('**/api/orders/ecofy-uncertain-test', (route) =>
    route.fulfill({
      json: {
        order: {
          id: 'ecofy-uncertain-test',
          token: 'ecofy-uncertain-test',
          reference: 'GE-UNCERTAIN',
          event_id: event.id,
          quantity: 4,
          amount: 2000,
          phone: '+255712345678',
          email: '',
          status: 'expired',
          provider: 'ecofy',
          expires_at: 0,
          payment_uncertain: uncertain,
        },
        event,
        tickets: [],
      },
    }),
  );
  await page.goto('/order/ecofy-uncertain-test');
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible();
  await expect(page.getByText(/Do not pay again yet/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to event' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ecofy-checking-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/ecofy-checking-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  uncertain = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reservation expired' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to event' })).toBeVisible();
});

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

test('buy four, keep one, hand three to friends, and admit everyone independently', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
  const created = await page.request.post('/api/organizer/events', {
    headers: { Origin: 'http://localhost:5181' },
    data: {
      name: `Friends Night ${Date.now()}`,
      description: 'Four friends arrive separately for a night of live music.',
      starts_at: '2027-02-20T17:00:00Z',
      venue: 'Warehouse 7',
      city: 'Dar es Salaam',
      category: 'Nightlife',
      image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3',
      status: 'published',
      tickets: [{ name: 'Regular', price: 20000, capacity: 4 }],
    },
  });
  expect(created.status()).toBe(201);
  const { event } = await created.json();
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  buyer.on('pageerror', (error) => errors.push(error.message));
  await buyer.goto(event.url);
  for (let i = 0; i < 3; i++) await buyer.getByRole('button', { name: 'Add one ticket' }).click();
  await buyer.getByLabel('Mobile money number', { exact: true }).fill('0712345678');
  await buyer.getByRole('button', { name: 'Pay TZS 80,000', exact: true }).click();
  await buyer.getByRole('button', { name: 'Approve demo payment' }).click();
  await expect(buyer.getByTestId('booking-ticket')).toHaveCount(4);
  const bookingUrl = buyer.url();
  const orderToken = new URL(bookingUrl).searchParams.get('order');
  const original = await (await buyer.request.get(`/api/orders/${orderToken}`)).json();
  const names = ['Asha', 'Juma', 'Neema'];
  const phoneSuffix = String(Date.now() % 10000000).padStart(7, '0');
  const friendNumbers = names.map((_, i) => `07${phoneSuffix}${i}`);
  const friendCodes = [];
  await buyer.getByRole('button', { name: 'Send ticket 4 to a friend' }).click();
  await buyer.getByLabel("Friend's name").fill('Cancelled Invite');
  await buyer.getByLabel("Friend's mobile number").fill('0712345679');
  await buyer.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await buyer.getByRole('button', { name: 'Cancel invitation for ticket 4' }).click();
  await expect(buyer.getByRole('button', { name: 'Send ticket 4 to a friend' })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    const number = i + 2;
    await buyer.getByRole('button', { name: `Send ticket ${number} to a friend` }).click();
    await buyer.getByLabel("Friend's name").fill(names[i]);
    await buyer.getByLabel("Friend's mobile number").fill(friendNumbers[i]);
    if (i === 0) {
      await buyer.setViewportSize({ width: 390, height: 844 });
      await buyer.screenshot({ path: 'test-results/handover-mobile.png', fullPage: true });
      expect(
        await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await buyer.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const row = buyer.getByTestId('booking-ticket').nth(number - 1);
    await expect(row).toContainText(`Waiting for ${names[i]}`);
    const link = await row.getByRole('link', { name: 'Open invitation' }).getAttribute('href');
    const friendContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const friend = await friendContext.newPage();
    friend.on('pageerror', (error) => errors.push(error.message));
    await friend.goto(link);
    await expect(friend.getByText(names[i], { exact: true })).toBeVisible();
    await friend.getByRole('button', { name: 'Verify my number' }).click();
    const otp = await friend.getByTestId('demo-claim-code').textContent();
    await friend.getByLabel('Verification code').fill('000000');
    await friend.getByRole('button', { name: 'Claim my ticket' }).click();
    await expect(friend.getByText('That verification code is incorrect.')).toBeVisible();
    if (i === 0) await friend.screenshot({ path: 'test-results/claim-mobile.png', fullPage: true });
    await friend.getByLabel('Verification code').fill(otp);
    await friend.getByRole('button', { name: 'Claim my ticket' }).click();
    await expect(friend).toHaveURL(/\/ticket\/[a-f0-9]+/);
    await expect(friend.getByAltText(/QR ticket GE-/)).toHaveCount(1);
    await expect(friend.locator('.ticket-holder')).toContainText(names[i]);
    friendCodes.push(await friend.locator('.ticket-qr .mono').textContent());
    expect(
      await friend.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (i === 0)
      await friend.screenshot({ path: 'test-results/claimed-ticket-mobile.png', fullPage: true });
    await expect(row).toContainText('Claimed', { timeout: 10000 });
    await expect(row.getByRole('button', { name: /Send ticket/ })).toHaveCount(0);
    expect(
      (await buyer.request.get(`/api/tickets/${original.tickets[number - 1].token}`)).status(),
    ).toBe(404);
    await friendContext.close();
  }
  await buyer.reload();
  await expect(buyer.getByText('Claimed', { exact: true })).toHaveCount(3);
  await buyer.screenshot({ path: 'test-results/four-tickets-mobile.png', fullPage: true });
  await buyer.setViewportSize({ width: 1440, height: 1000 });
  await buyer.reload();
  await expect(buyer.getByText('Claimed', { exact: true })).toHaveCount(3);
  await expect(buyer.locator('.public-header')).toHaveCount(1);
  expect(
    await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await buyer.screenshot({ path: 'test-results/four-tickets-desktop.png', fullPage: true });
  await page.goto(`/dashboard/scan?event=${event.id}`);
  await page.getByLabel('Ticket code or ticket link').fill(original.tickets[1].code);
  await page.getByRole('button', { name: 'Admit guest' }).click();
  await expect(page.getByText('This ticket does not belong to this event.')).toBeVisible();
  for (const [code, name] of [
    [friendCodes[1], 'Juma'],
    [original.tickets[0].code, ''],
    [friendCodes[0], 'Asha'],
    [friendCodes[2], 'Neema'],
  ]) {
    await page.getByLabel('Ticket code or ticket link').fill(code);
    await page.getByRole('button', { name: 'Admit guest' }).click();
    await expect(page.getByRole('heading', { name: 'You’re in.' })).toBeVisible();
    if (name) await expect(page.locator('.scan-success')).toContainText(name);
  }
  await page.screenshot({ path: 'test-results/friends-admitted-desktop.png', fullPage: true });
  await page.getByLabel('Ticket code or ticket link').fill(friendCodes[0]);
  await page.getByRole('button', { name: 'Admit guest' }).click();
  await expect(page.getByText(/Already admitted at/)).toBeVisible();
  await page.goto('/dashboard/guests');
  await page.getByLabel('Search guests').fill('Asha');
  await expect(page.locator('tbody')).toContainText('Asha');
  await expect(page.locator('tbody')).toContainText(friendNumbers[0]);
  expect(errors).toEqual([]);
  await buyerContext.close();
});
