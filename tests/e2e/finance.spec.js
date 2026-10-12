import { test, expect } from '@playwright/test';

test('HTML gateway errors show a safe payout message and quote retries preserve their key', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  const keys = [];
  await page.route('**/api/organizer/payouts/quote', (route) => {
    keys.push(route.request().postDataJSON().idempotency_key);
    return route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html>Private gateway error</html>',
    });
  });
  await page.goto('/dashboard/revenue');
  await page.getByRole('button', { name: 'Request payout', exact: true }).click();
  await page.getByLabel('Amount to recipient (TZS)').fill('1000');
  await page.getByLabel('Mobile-money number').fill('0712345678');
  await page.getByLabel('Your account password').fill('GoldenDemo2026!');
  const button = page.getByRole('button', { name: 'Continue', exact: true });
  await button.click();
  await expect(page.getByRole('dialog')).toContainText(
    'The withdrawal service is temporarily unavailable.',
  );
  await expect(page.getByRole('dialog')).not.toContainText('Unexpected token');
  await expect(page.getByRole('dialog')).not.toContainText('Private gateway error');
  await button.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});

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
          account_name_source: 'merchant',
          destination_verification_required: false,
          account_last4: '5678',
          channel: 'MPESA',
          expires_at: Date.now() + 300000,
          demo: false,
        },
      },
    }),
  );
  await page.route('**/api/organizer/payouts/code', (route) =>
    route.fulfill({
      json: {
        challenge_id: 'allowance-challenge',
        mode: 'nextsms',
        expires_at: Date.now() + 300000,
        verification_phone: '+255 *** *** 5678',
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
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
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

test('withdrawal proceeds directly to fresh OTP with entered recipient, fees and final confirmation on desktop/mobile', async ({
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
  const codeResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/organizer/payouts/code') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const challenge = await (await codeResponse).json();
  await expect(page.getByRole('heading', { name: 'Confirm your payout' })).toBeVisible();
  await expect(page.getByText('Finance Organizer', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate payout', exact: true })).toBeDisabled();
  await expect(page.locator('.payout-confirmation')).toContainText('10,100');
  await page.screenshot({ path: 'test-results/payout-quote-desktop.png', fullPage: true });
  await page.screenshot({ path: 'test-results/payout-quote-preview.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/payout-quote-mobile.png', fullPage: true });
  await page.getByRole('checkbox', { name: /I confirm the recipient/ }).check();
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

test('alternate mobile number verification precedes fresh organizer authorization without a name lookup screen', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  const calls = [];
  await page.route('**/api/organizer/payouts/quote', (route) =>
    route.fulfill({
      json: {
        quote: {
          id: 'destination-quote',
          amount: 1000,
          fee: 100,
          total: 1100,
          account_name: 'Friend',
          account_name_source: 'merchant',
          account_last4: '5678',
          channel: 'MPESA',
          destination_type: 'mobile_money',
          expires_at: Date.now() + 300000,
          destination_verification_required: true,
          demo: false,
        },
      },
    }),
  );
  await page.route('**/api/organizer/payouts/destination/code', (route) => {
    calls.push('destination-code');
    return route.fulfill({
      json: {
        challenge_id: 'destination-challenge',
        phone: '+255 *** *** 5678',
        expires_at: Date.now() + 300000,
      },
    });
  });
  await page.route('**/api/organizer/payouts/destination/verify', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      quote_id: 'destination-quote',
      challenge_id: 'destination-challenge',
      code: '123456',
    });
    calls.push('destination-verified');
    return route.fulfill({ json: { verified: true } });
  });
  await page.route('**/api/organizer/payouts/code', (route) => {
    calls.push('organizer-code');
    return route.fulfill({
      json: {
        challenge_id: 'organizer-challenge',
        verification_phone: '+255 *** *** 1701',
        expires_at: Date.now() + 300000,
        mode: 'nextsms',
      },
    });
  });
  await page.goto('/dashboard/revenue');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Request payout', exact: true }).click();
  await page.getByLabel('Amount to recipient (TZS)').fill('1000');
  await page.getByLabel('Mobile-money number').fill('0712345678');
  await page.getByLabel('Recipient account name').fill('Friend');
  await page.getByLabel('Your account password').fill('GoldenDemo2026!');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify payout number' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Recipient name you entered');
  await expect(page.getByRole('dialog')).not.toContainText('Verified by Ecofy');
  expect(calls).toEqual(['destination-code']);
  await page.screenshot({ path: 'test-results/payout-destination-otp-mobile.png' });
  await page.getByLabel('Payout number verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify number', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your payout' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('+255 *** *** 1701');
  expect(calls).toEqual(['destination-code', 'destination-verified', 'organizer-code']);
  await page.screenshot({ path: 'test-results/payout-primary-otp-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('bank withdrawals preserve leading zeros and require a fresh code after restarting', async ({
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
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/CRDB Bank · account ending 5678/)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/bank-payout-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect(page.getByLabel('Bank account number')).toHaveValue('0012345678');
  await expect(page.getByRole('checkbox', { name: /I confirm the recipient/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const finance = await (await page.request.get('/api/organizer/finance', { headers })).json();
  expect(finance.payout_mode).toBe('demo');
});
