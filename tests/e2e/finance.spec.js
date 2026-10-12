import { test, expect } from '@playwright/test';

test('quoted demo payout shows verified name, separate fees, OTP and final outcome on desktop/mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const headers = { Origin: 'http://localhost:5181' },
    password = 'FinanceTest123!';
  await page.goto('/register');
  const account = await page.request.post('/api/auth/register', {
    headers,
    data: { name: 'Finance Organizer', email: `finance-${Date.now()}@example.com`, password },
  });
  expect(account.status()).toBe(200);
  const created = await page.request.post('/api/organizer/events', {
    headers,
    data: {
      name: `Payout Demo ${Date.now()}`,
      description: 'A community event for payout verification.',
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      venue: 'Warehouse 7',
      city: 'Dar es Salaam',
      category: 'Music',
      image: '',
      status: 'published',
      tickets: [{ name: 'Regular', price: 20000, capacity: 4 }],
    },
  });
  const { event } = await created.json();
  const placed = await page.request.post('/api/orders', {
    headers,
    data: {
      event_id: event.id,
      ticket_type_id: event.tickets[0].id,
      quantity: 1,
      phone: '0712345678',
      idempotency_key: crypto.randomUUID(),
    },
  });
  const booking = await placed.json();
  await page.request.post(`/api/orders/${booking.token}/demo`, {
    headers,
    data: { action: 'approve' },
  });
  await page.goto('/dashboard/revenue');
  await expect(page.locator('.finance-available')).toContainText('19,000');
  await expect(page.locator('.finance-totals')).toContainText('1,000');
  await page.screenshot({ path: 'test-results/earnings-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Request payout', exact: true }).click();
  await page.getByLabel('Amount to recipient (TZS)').fill('10000');
  await page.getByLabel('Mobile-money number').fill('0712345678');
  await page.getByLabel('Your account password').fill(password);
  await page.getByRole('button', { name: 'Check recipient & fee' }).click();
  await expect(page.getByText('DEMO VERIFIED RECIPIENT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toBeDisabled();
  await expect(page.locator('.payout-confirmation')).toContainText('10,100');
  await page.screenshot({ path: 'test-results/payout-quote-desktop.png', fullPage: true });
  await page.screenshot({ path: 'test-results/payout-quote-preview.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/payout-quote-mobile.png', fullPage: true });
  await page.getByRole('checkbox', { name: /I recognize this account holder/ }).check();
  const codeResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/organizer/payouts/code') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  const challenge = await (await codeResponse).json();
  await expect(page.getByRole('heading', { name: 'Confirm your payout' })).toBeVisible();
  await page.getByLabel('Verification code').fill(challenge.demo_code);
  const submitBox = await page.getByRole('button', { name: 'Simulate payout' }).boundingBox();
  expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(812);
  await page.screenshot({ path: 'test-results/payout-verification-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const confirmation = page.waitForResponse((r) =>
    r.url().endsWith(`/api/organizer/payouts/${challenge.challenge_id}/confirm`),
  );
  await page.getByRole('button', { name: 'Simulate payout' }).click();
  const { payout } = await (await confirmation).json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.finance-available')).toContainText('8,900');
  await expect(page.getByRole('row').filter({ hasText: payout.reference })).toContainText(
    'Simulated paid',
  );
  await expect(page.getByRole('row').filter({ hasText: payout.reference })).toContainText(
    'total 10,100',
  );
  await page.screenshot({ path: 'test-results/earnings-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('bank quotes preserve the account and require a fresh verified name after restarting', async ({
  page,
}) => {
  const headers = { Origin: 'http://localhost:5181' };
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await page.goto('/dashboard/revenue');
  await page.getByRole('button', { name: 'Request payout', exact: true }).click();
  await page.getByLabel('Amount to recipient (TZS)').fill('10000');
  await page.getByRole('radio', { name: 'Bank account', exact: true }).check();
  await page.getByLabel('Bank', { exact: true }).selectOption('CRDB');
  await page.getByLabel('Bank account number').fill('0012345678');
  await page.getByLabel('Your account password').fill('GoldenDemo2026!');
  await page.getByRole('button', { name: 'Check recipient & fee' }).click();
  await expect(page.getByText(/CRDB Bank · account ending 5678/)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/bank-payout-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(page.getByLabel('Bank account number')).toHaveValue('0012345678');
  await expect(page.getByRole('checkbox', { name: /I recognize this account holder/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const finance = await (await page.request.get('/api/organizer/finance', { headers })).json();
  expect(finance.payout_mode).toBe('demo');
});
