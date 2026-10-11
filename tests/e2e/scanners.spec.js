import { test, expect } from '@playwright/test';

test('organizer invites gate staff; scanner has a limited workspace and revocation applies immediately', async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
  const input = {
    name: `Golden Gate ${Date.now()}`,
    description: 'A music night with an independent gate crew.',
    starts_at: '2027-03-20T17:00:00Z',
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Music',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3',
    status: 'published',
    tickets: [{ name: 'Regular', price: 1000, capacity: 4 }],
  };
  const response = await page.request.post('/api/organizer/events', {
    headers: { Origin: 'http://localhost:5181' },
    data: input,
  });
  expect(response.status()).toBe(201);
  const { event } = await response.json();
  await page.goto(`/dashboard/team?event=${event.id}`);
  await expect(page.getByRole('heading', { name: 'Gate team', exact: true })).toBeVisible();
  await expect(page.getByLabel('Team event')).toHaveValue(event.id);
  await page.getByLabel('Name', { exact: true }).fill('Asha Gate');
  const email = `gate-${Date.now()}@example.com`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByText('Invitation ready', { exact: true })).toBeVisible();
  const link = await page.locator('.gate-created-link a').getAttribute('href');
  const token = link.split('/').pop();
  await page.screenshot({ path: 'test-results/gate-team-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/gate-team-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const scanner = await ctx.newPage();
  scanner.on('pageerror', (e) => errors.push(e.message));
  // Stay on localhost so the isolated test session uses the same host-only cookie.
  await scanner.goto(`/scanner-invite/${token}`);
  await expect(scanner.getByRole('heading', { name: event.name })).toBeVisible();
  await expect(scanner.getByLabel('Create your password')).toBeVisible();
  await scanner.screenshot({ path: 'test-results/scanner-invite-mobile.png', fullPage: true });
  expect(await scanner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  const accepted = await scanner.request.post(`/api/scanner-invites/${token}/accept`, {
    headers: { Origin: 'http://localhost:5181' },
    data: { password: 'TestOnlyScanner123!' },
  });
  expect(accepted.status()).toBe(200);
  await scanner.goto('/dashboard/scan');
  await expect(scanner.getByLabel('Event to scan')).toHaveValue(event.id);
  await scanner.getByRole('button', { name: 'Open navigation' }).click();
  await expect(scanner.getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0);
  await expect(scanner.getByRole('link', { name: 'Gate team', exact: true })).toHaveCount(0);
  await expect(scanner.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await scanner.getByRole('button', { name: 'Close navigation' }).click();
  await scanner.screenshot({ path: 'test-results/scanner-workspace-mobile.png', fullPage: true });
  await scanner.goto('/dashboard/orders');
  await expect(scanner).toHaveURL(/\/dashboard\/scan$/);
  await scanner.goto('/dashboard/settings');
  await expect(scanner.getByRole('heading', { name: 'Password', exact: true })).toBeVisible();
  await expect(scanner.getByRole('heading', { name: 'Connections', exact: true })).toHaveCount(0);
  const orderResponse = await scanner.request.post('/api/orders', {
    headers: { Origin: 'http://localhost:5181' },
    data: {
      event_id: event.id,
      ticket_type_id: event.tickets[0].id,
      quantity: 1,
      phone: '0712345678',
      email: '',
      whatsapp: false,
      idempotency_key: crypto.randomUUID(),
    },
  });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();
  await scanner.request.post(`/api/orders/${order.token}/demo`, {
    headers: { Origin: 'http://localhost:5181' },
    data: { action: 'approve' },
  });
  const paid = await (await scanner.request.get(`/api/orders/${order.token}`)).json();
  await scanner.goto('/dashboard/scan');
  await scanner.getByLabel('Ticket code or ticket link').fill(paid.tickets[0].code);
  await scanner.getByRole('button', { name: 'Admit guest' }).click();
  await expect(scanner.getByRole('heading', { name: 'You’re in.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Revoke access for Asha Gate' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke access for Asha Gate' }).click();
  await expect(page.getByRole('heading', { name: 'No scanners assigned' })).toBeVisible();
  await scanner.getByLabel('Ticket code or ticket link').fill(paid.tickets[0].code);
  await scanner.getByRole('button', { name: 'Admit guest' }).click();
  await expect(scanner.getByText('No scanner access to this event.')).toBeVisible();
  await scanner.reload();
  await expect(scanner.getByRole('option', { name: 'No events available' })).toHaveCount(1);
  await page.goto('/dashboard/guests');
  await page.getByLabel('Search guests').fill(paid.tickets[0].code);
  await expect(page.locator('tbody')).toContainText('By Asha Gate');
  expect(errors).toEqual([]);
  await ctx.close();
});
