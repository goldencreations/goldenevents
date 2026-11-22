import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/db.js';
import { makeConfig } from '../../server/config.js';

let server, db, directory, origin;
test.beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'golden-docs-browser-'));
  db = openDatabase(directory);
  const config = makeConfig({
    production: true,
    dataDir: directory,
    baseDomain: '127.0.0.1',
    publicOrigin: 'https://goldenevents.example',
    appOrigin: 'https://app.goldenevents.example',
    paymentDriver: 'disabled',
    payoutDriver: 'manual',
    seedDemo: false,
  });
  server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('Swagger renders under production CSP on desktop and mobile without live submit controls', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const blocked = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text()))
      blocked.push(message.text());
  });
  await page.goto(`${origin}/api/docs`);
  await expect(
    page.getByRole('heading', { name: 'Golden Events API', exact: false }),
  ).toBeVisible();
  await expect(page.locator('.opblock')).toHaveCount(69);
  const login = page.locator('#operations-Authentication-post_auth_token');
  await login.getByRole('button', { name: 'post /auth/token', exact: false }).first().click();
  await expect(login).toContainText('Sign in a native app');
  await expect(page.getByRole('button', { name: 'Try it out' })).toHaveCount(0);
  await expect(page.locator('.errors-wrapper')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/api-docs-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/api-docs-mobile.png' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
});
