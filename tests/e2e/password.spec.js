import { test, expect } from '@playwright/test';

test('password form submits autofilled values and permits signing in with the updated password', async ({
  page,
}) => {
  const email = `password-${Date.now()}@example.com`;
  const currentPassword = 'CurrentPassword123!';
  const newPassword = 'UpdatedPassword456!';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Password Test');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(currentPassword);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/dashboard/settings');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Update password', exact: true }) });
  await expect(form.getByText('Use 10–128 characters.')).toBeVisible();
  // Password managers can update DOM values without dispatching React change events.
  const autofill = async (current, next) =>
    form.evaluate(
      (element, values) => {
        element.elements.namedItem('currentPassword').value = values.current;
        element.elements.namedItem('newPassword').value = values.next;
      },
      { current, next },
    );
  await autofill('WrongPassword123!', newPassword);
  await form.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Your current password is incorrect. Enter the password you use to sign in.',
  );
  await autofill(currentPassword, newPassword);
  await form.getByRole('button', { name: 'Show current password', exact: true }).click();
  await expect(form.getByLabel('Current password', { exact: true })).toHaveValue(currentPassword);
  await expect(form.getByLabel('New password', { exact: true })).toHaveValue(newPassword);
  await form.getByRole('button', { name: 'Update password', exact: true }).click();
  await page.waitForURL('**/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\/settings)?$/);
  await expect
    .poll(async () => (await (await page.request.get('/api/auth/me')).json()).user?.email)
    .toBe(email);
});
