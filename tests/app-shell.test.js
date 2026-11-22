import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';

const account = {
  name: 'Shell Organizer',
  email: 'shell@example.com',
  password: 'StrongPassword123!',
};

async function startApp(t, overrides) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-shell-'));
  const db = openDatabase(dir);
  const config = makeConfig({ dataDir: dir, production: false, seedDemo: false, ...overrides });
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { origin: `http://127.0.0.1:${server.address().port}` };
}

test('app-shell origins pass CORS and the origin guard; other origins stay blocked', async (t) => {
  const { origin } = await startApp(t, {
    paymentDriver: 'demo',
    appShellOrigins: ['https://localhost', 'capacitor://localhost'],
  });

  const preflight = await fetch(`${origin}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://localhost',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(
    preflight.headers.get('access-control-allow-headers'),
    'Accept,Content-Type,Authorization',
  );

  const register = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
    body: JSON.stringify(account),
  });
  assert.equal(register.status, 200);
  assert.equal(register.headers.get('access-control-allow-origin'), 'https://localhost');
  const cookie = register.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ge_session='));

  const tokenResponse = await fetch(`${origin}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
    body: JSON.stringify(account),
  });
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get('set-cookie'), null);
  const { access_token: token } = await tokenResponse.json();
  const nativeWrite = await fetch(`${origin}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'capacitor://localhost',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'Shell Organizer', organization: 'Events', phone: '' }),
  });
  assert.equal(nativeWrite.status, 200);
  const untrustedTokenWrite = await fetch(`${origin}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'Shell Organizer', organization: 'Events', phone: '' }),
  });
  assert.equal(untrustedTokenWrite.status, 403);
  assert.equal(untrustedTokenWrite.headers.get('access-control-allow-origin'), null);

  const crossOriginWrite = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(crossOriginWrite.status, 403);
  assert.equal(crossOriginWrite.headers.get('access-control-allow-origin'), null);

  const missingOrigin = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingOrigin.status, 403);

  const iosRead = await fetch(`${origin}/api/config`, {
    headers: { Origin: 'capacitor://localhost' },
  });
  assert.equal(iosRead.status, 200);
  assert.equal(iosRead.headers.get('access-control-allow-origin'), 'capacitor://localhost');
});

test('an empty app-shell allowlist keeps the original same-host-only guard', async (t) => {
  const { origin } = await startApp(t, { paymentDriver: 'demo', appShellOrigins: [] });

  const blocked = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
    body: JSON.stringify({ ...account, email: 'other@example.com' }),
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const sameHost = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ ...account, email: 'same@example.com' }),
  });
  assert.equal(sameHost.status, 200);
});

test('production sessions issue SameSite=None cookies for the app shell', async (t) => {
  const { origin } = await startApp(t, {
    production: true,
    baseDomain: '127.0.0.1',
    publicOrigin: 'https://goldencreations.events',
    appOrigin: 'https://app.goldencreations.events',
    paymentDriver: 'disabled',
    appShellOrigins: ['https://localhost'],
  });

  const register = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost' },
    body: JSON.stringify(account),
  });
  assert.equal(register.status, 200);
  const cookie = register.headers.get('set-cookie');
  assert.ok(cookie?.includes('SameSite=None'), cookie);
  assert.ok(cookie?.includes('Secure'), cookie);
});
