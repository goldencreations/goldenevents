import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { tokenHash } from '../server/auth.js';

async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-mobile-'));
  const db = openDatabase(dir);
  const config = makeConfig({
    dataDir: dir,
    production: false,
    paymentDriver: 'demo',
    seedDemo: false,
  });
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (
    url,
    { method = 'GET', body, token, cookie, requestOrigin, headers = {} } = {},
  ) => {
    const res = await fetch(`${origin}/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      cookie: res.headers.get('set-cookie')?.split(';')[0],
      data: await res.json(),
    };
  };
  const credentials = { email: 'mobile@example.test', password: 'StrongPassword123!' };
  const registered = await request('/auth/register', {
    method: 'POST',
    body: { ...credentials, name: 'Mobile Owner' },
    requestOrigin: origin,
  });
  assert.equal(registered.status, 200);
  return { db, config, origin, request, credentials, registered };
}

test('native sign-in uses hashed expiring bearer tokens, preserves cookie CSRF, and isolates credential transports', async (t) => {
  const f = await fixture(t);
  const login = await f.request('/auth/token', { method: 'POST', body: f.credentials });
  assert.equal(login.status, 200);
  assert.equal(login.cookie, undefined);
  assert.equal(login.data.token_type, 'Bearer');
  assert.equal(login.data.expires_in, 604800);
  assert.equal(login.data.user.password, undefined);
  const token = login.data.access_token;
  assert.match(token, /^ge_mobile_[a-f0-9]{64}$/);
  assert.equal(f.db.prepare('SELECT token FROM sessions WHERE token=?').get(token), undefined);
  assert.ok(f.db.prepare('SELECT token FROM sessions WHERE token=?').get(tokenHash(token)));
  assert.equal((await f.request('/organizer/events', { token })).status, 200);
  const profile = { name: 'Mobile Updated', organization: 'Launch', phone: '' };
  assert.equal((await f.request('/settings', { method: 'PUT', body: profile, token })).status, 200);
  for (const requestOrigin of [undefined, 'https://evil.example', 'null', 'malformed']) {
    assert.equal(
      (
        await f.request('/settings', {
          method: 'PUT',
          body: profile,
          cookie: f.registered.cookie,
          requestOrigin,
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await f.request('/settings', {
        method: 'PUT',
        body: profile,
        token,
        requestOrigin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/auth/token', {
        method: 'POST',
        body: f.credentials,
        requestOrigin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/auth/token', {
        method: 'POST',
        body: f.credentials,
        cookie: f.registered.cookie,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/auth/token', {
        method: 'POST',
        body: f.credentials,
        headers: { 'Content-Type': 'text/plain' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/organizer/events', { cookie: `ge_session=${token}` })).status,
    401,
  );
  const webToken = f.registered.cookie.split('=')[1];
  assert.equal((await f.request('/organizer/events', { token: webToken })).status, 401);
  assert.equal(
    (await f.request('/organizer/events', { token: `ge_mobile_${webToken}` })).status,
    401,
  );
  assert.equal(
    (await f.request('/organizer/events', { token: 'invalid', cookie: f.registered.cookie }))
      .status,
    401,
  );
  assert.equal((await f.request(`/organizer/events?access_token=${token}`)).status, 401);
  assert.equal((await f.request('/admin', { token })).status, 403);
  const logout = await f.request('/auth/logout', { method: 'POST', body: {}, token });
  assert.equal(logout.status, 200);
  assert.equal((await f.request('/organizer/events', { token })).status, 401);
  assert.equal((await f.request('/organizer/events', { cookie: f.registered.cookie })).status, 200);
});

test('mobile login rejects wrong passwords, expiry works, and password changes revoke web and mobile sessions', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request('/auth/token', {
        method: 'POST',
        body: { ...f.credentials, password: 'wrong' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request('/auth/token', {
        method: 'POST',
        body: { email: 'missing@example.test', password: 'wrong' },
      })
    ).status,
    401,
  );
  const login = await f.request('/auth/token', { method: 'POST', body: f.credentials });
  const expired = await f.request('/auth/token', { method: 'POST', body: f.credentials });
  f.db
    .prepare('UPDATE sessions SET expires_at=? WHERE token=?')
    .run(Date.now() - 1, tokenHash(expired.data.access_token));
  assert.equal(
    (await f.request('/organizer/events', { token: expired.data.access_token })).status,
    401,
  );
  assert.equal(
    (
      await f.request('/settings/password', {
        method: 'PUT',
        token: login.data.access_token,
        body: { current: f.credentials.password, newPassword: 'NewStrongPassword123!' },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request('/organizer/events', { token: login.data.access_token })).status,
    401,
  );
  assert.equal((await f.request('/organizer/events', { cookie: f.registered.cookie })).status, 401);
});

test('mobile scanner accounts retain first-login lock, event assignment boundaries and immediate revocation', async (t) => {
  const f = await fixture(t);
  const input = {
    name: 'Mobile Scan Party',
    description: 'A mobile integration test event.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse',
    city: 'Dar es Salaam',
    category: 'Music',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 1000, capacity: 10 }],
  };
  const event = await f.request('/organizer/events', {
    method: 'POST',
    requestOrigin: f.origin,
    cookie: f.registered.cookie,
    body: input,
  });
  assert.equal(event.status, 201);
  const scanner = await f.request(`/gate/events/${event.data.event.id}/scanners`, {
    method: 'POST',
    requestOrigin: f.origin,
    cookie: f.registered.cookie,
    body: { name: 'Gate One', email: 'gate@example.test' },
  });
  const credentials = { email: 'gate@example.test', password: scanner.data.temporary_password };
  let signed = await f.request('/auth/token', { method: 'POST', body: credentials });
  assert.equal(signed.data.user.must_change_password, true);
  assert.equal(
    (await f.request('/scanner/events', { token: signed.data.access_token })).status,
    403,
  );
  const newPassword = 'PrivateGatePassword123!';
  assert.equal(
    (
      await f.request('/settings/password', {
        method: 'PUT',
        token: signed.data.access_token,
        body: { current: credentials.password, newPassword },
      })
    ).status,
    200,
  );
  signed = await f.request('/auth/token', {
    method: 'POST',
    body: { ...credentials, password: newPassword },
  });
  const token = signed.data.access_token;
  assert.equal(
    (await f.request('/scanner/events', { token })).data.events[0].id,
    event.data.event.id,
  );
  assert.equal((await f.request('/organizer/finance', { token })).status, 403);
  assert.equal((await f.request('/gate/events', { token })).status, 403);
  assert.equal(
    (
      await f.request('/scanner/check-in', {
        method: 'POST',
        token,
        body: { event_id: randomUUID(), code: 'invalid' },
      })
    ).status,
    404,
  );
  await f.request(`/gate/events/${event.data.event.id}/scanners/${scanner.data.account.id}`, {
    method: 'DELETE',
    requestOrigin: f.origin,
    cookie: f.registered.cookie,
  });
  assert.deepEqual((await f.request('/scanner/events', { token })).data.events, []);
  assert.equal(
    (
      await f.request('/scanner/check-in', {
        method: 'POST',
        token,
        body: { event_id: event.data.event.id, code: 'invalid' },
      })
    ).status,
    404,
  );
});
