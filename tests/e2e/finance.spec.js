import { test, expect } from '@playwright/test';

test('fee allowance and quote coverage remain clear on desktop and mobile without double subtraction', async ({
  page,
}) => {
  await page.goto('/register');
  const password = 'AllowanceTest123!';
  const account = await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:5181' },
    data: { name: 'Allowance Organizer', email: `allowance-${Date.now()}@example.com`, password },
  });
  expect(account.status()).toBe(200);
  await page.route('**/api/organizer/finance', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        demo: false,
        automatic_disbursement: true,
        payout_mode: 'ecofy',
        gross: 2000,
        platform_fee: 100,
        provider_fees: 40,
        provider_fees_pending: 0,
        net_estimate: 1860,
        released: 1860,
        available: 1850,
        withdrawal_capacity: 1860,
        provider_fee_allowance_bps: 250,
        provider_fee_reserve: 10,
      },
    });
  });
  await page.route('**/api/organizer/payouts/quote', (route) =>
    route.fulfill({
      json: {
        quote: {
          id: 'allowance-quote',
          amount: 1850,
          fee: 10,
          total: 1860,
          account_name: 'TEST RECIPIENT',
          account_last4: '5678',
          channel: 'MPESA',
          expires_at: Date.now() + 300000,
          demo: false,
        },
      },
    }),
  );
  await page.goto('/dashboard/revenue');
  await expect(page.locator('.finance-available')).toContainText('1,850');
  await expect(page.locator('.finance-balances')).toContainText(
    'Remaining provider-fee allowance (2.5%)',
  );
  await page.screenshot({ path: 'test-results/fee-allowance-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/fee-allowance-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Request payout', exact: true }).click();
  await page.getByLabel('Amount to recipient (TZS)').fill('1850');
  await page.getByLabel('Mobile-money number').fill('0712345678');
  await page.getByLabel('Your account password').fill(password);
  await page.getByRole('button', { name: 'Check recipient & fee' }).click();
  await expect(page.getByText('TEST RECIPIENT', { exact: true })).toBeVisible();
  await expect(
    page.locator('.payout-confirmation > div').filter({ hasText: 'Remaining earnings' }),
  ).toContainText('TZS 0');
  await expect(
    page
      .locator('.payout-confirmation > div')
      .filter({ hasText: 'Withdrawal fee covered by allowance' }),
  ).toContainText('TZS 10');
  await page.screenshot({ path: 'test-results/fee-allowance-quote-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/fee-allowance-quote-desktop.png', fullPage: true });
});

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
