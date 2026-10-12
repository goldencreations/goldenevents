import { test, expect } from '@playwright/test';

test('security-phone enrollment handles wrong code, expiry, resend and verified state on desktop/mobile', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const password = 'OtpBrowserTest123!';
  await page.goto('/register');
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:5181' },
    data: { name: 'OTP Organizer', email: `otp-${Date.now()}@example.com`, password },
  });
  expect(response.status()).toBe(200);
  const { user } = await response.json();
  let verified = false,
    verifies = 0,
    requests = 0;
  const masked = '+255 *** *** 1701';
  await page.route('**/api/settings/phone', (route) =>
    route.fulfill({ json: { available: true, verified, phone: verified ? masked : null } }),
  );
  await page.route('**/api/settings/phone/code', (route) => {
    const input = route.request().postDataJSON();
    expect(input.phone).toBe('0748281701');
    expect(input.password).toBe(password);
    requests++;
    return route.fulfill({
      status: 202,
      json: {
        challenge_id: `phone-${requests}`,
        phone: masked,
        expires_at: Date.now() + 300000,
        resend_after: 60,
      },
    });
  });
  await page.route('**/api/settings/phone/*/resend', async (route) => {
    requests++;
    return route.fulfill({
      status: 202,
      json: {
        challenge_id: `phone-${requests}`,
        phone: masked,
        expires_at: await page.evaluate(() => Date.now() + 300000),
        resend_after: 60,
      },
    });
  });
  await page.route('**/api/settings/phone/*/verify', (route) => {
    verifies++;
    if (verifies === 1)
      return route.fulfill({ status: 400, json: { error: 'The verification code is incorrect.' } });
    verified = true;
    return route.fulfill({ json: { verified: true, user: { ...user, phone: '+255748281701' } } });
  });
  await page.goto('/dashboard/settings');
  const section = page
    .locator('.settings-section')
    .filter({ has: page.getByRole('heading', { name: 'Security phone', exact: true }) });
  await expect(section.getByLabel('Mobile number')).toBeVisible();
  await section.getByLabel('Mobile number').fill('0748281701');
  await section.getByLabel('Current password').fill(password);
  await page.screenshot({ path: 'test-results/security-phone-desktop.png', fullPage: true });
  await page.clock.install();
  await section.getByRole('button', { name: 'Send verification code' }).click();
  await expect(section.getByText(`SMS requested for ${masked}`)).toBeVisible();
  await expect(section.getByRole('button', { name: /Resend in/ })).toBeDisabled();
  await section.getByLabel('Verification code').fill('000000');
  await section.getByRole('button', { name: 'Verify phone', exact: true }).click();
  await expect(section).toContainText('The verification code is incorrect.');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.runFor(250);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'test-results/security-phone-code-mobile.png',
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.clock.fastForward(301000);
  await expect(section.getByText('Code expired.', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Verify phone', exact: true })).toBeDisabled();
  await section.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect(section.getByLabel('Verification code')).toHaveValue('');
  await section.getByLabel('Verification code').fill('482193');
  await section.getByRole('button', { name: 'Verify phone', exact: true }).click();
  await expect(section).toContainText(
    'Verified. Contact-number edits do not change this security number.',
  );
  await expect(section.getByLabel('Verification code')).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/security-phone-verified-mobile.png',
    fullPage: true,
  });
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});

test('unconfigured SMS does not offer enrollment or a fake code', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await page.goto('/dashboard/settings');
  await expect(page.getByText('SMS verification is not connected yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send verification code' })).toHaveCount(0);
});
