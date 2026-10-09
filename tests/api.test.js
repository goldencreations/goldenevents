import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';

test('API sessions, tenant boundaries, CSRF, and demo checkout work end to end', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-api-')),
    db = openDatabase(dir),
    config = makeConfig({
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
    body,
    cookie = '',
    method = body ? 'POST' : 'GET',
    customOrigin = origin,
  ) => {
    const response = await fetch(`${origin}/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: customOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      data: await response.json(),
    };
  };
  assert.equal((await request('/organizer/events')).status, 401);
  const account = await request('/auth/register', {
    name: 'Organizer One',
    email: 'one@example.com',
    password: 'StrongPassword123!',
    role: 'admin',
  });
  assert.equal(account.status, 200);
  assert.equal(account.data.user.role, 'organizer');
  assert.equal(account.data.user.password, undefined);
  assert.equal(
    (await request('/organizer/events', {}, account.cookie, 'POST', 'https://evil.example')).status,
    403,
  );
  const eventInput = {
    name: 'Test Launch Party',
    description: 'Our first event with friends and music.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Nightlife',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 20000, capacity: 2 }],
  };
  const created = await request('/organizer/events', eventInput, account.cookie);
  assert.equal(created.status, 201);
  const event = created.data.event;
  const second = await request('/auth/register', {
    name: 'Other Organizer',
    email: 'other@example.com',
    password: 'StrongPassword123!',
  });
  assert.equal(
    (await request(`/organizer/events/${event.id}`, undefined, second.cookie)).status,
    404,
  );
  assert.equal(
    (await request(`/organizer/events/${event.id}`, eventInput, second.cookie, 'PUT')).status,
    404,
  );
  assert.equal((await request('/admin', undefined, account.cookie)).status, 403);
  const paid = await request('/orders', {
    event_id: event.id,
    ticket_type_id: event.tickets[0].id,
    quantity: 2,
    phone: '0712345678',
    email: '',
    whatsapp: true,
    idempotency_key: crypto.randomUUID(),
  });
  assert.equal(paid.status, 201);
  assert.equal(
    (await request(`/orders/${paid.data.token}/demo`, { action: 'approve' })).status,
    200,
  );
  const order = await request(`/orders/${paid.data.token}`);
  assert.equal(order.data.order.status, 'paid');
  assert.equal(order.data.tickets.length, 2);
  assert.equal(order.data.order.idempotency_key, undefined);
  const ticket = await request(`/tickets/${order.data.tickets[0].token}`);
  assert.ok(ticket.data.qr.startsWith('data:image/png;base64,'));
  assert.equal(
    (
      await request(
        '/organizer/check-in',
        { event_id: event.id, code: order.data.tickets[0].code },
        account.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/organizer/check-in',
        { event_id: event.id, code: order.data.tickets[0].code },
        account.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/webhooks/flutterwave', {
        event: 'charge.completed',
        data: { id: 1, tx_ref: 'fake' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        '/organizer/check-in',
        { event_id: event.id, code: order.data.tickets[1].code },
        second.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(`/organizer/orders/${order.data.order.id}/refund`, {}, account.cookie)).status,
    409,
  );
  const refundableEvent = (
    await request('/organizer/events', { ...eventInput, name: 'Refund Test' }, account.cookie)
  ).data.event;
  const refundable = await request('/orders', {
    event_id: refundableEvent.id,
    ticket_type_id: refundableEvent.tickets[0].id,
    quantity: 1,
    phone: '712345678',
    email: '',
    whatsapp: false,
    idempotency_key: crypto.randomUUID(),
  });
  await request(`/orders/${refundable.data.token}/demo`, { action: 'approve' });
  const refundableOrder = (await request(`/orders/${refundable.data.token}`)).data;
  assert.equal(
    (await request(`/organizer/orders/${refundableOrder.order.id}/refund`, {}, second.cookie))
      .status,
    404,
  );
  assert.equal(
    (await request(`/organizer/orders/${refundableOrder.order.id}/refund`, {}, account.cookie))
      .status,
    200,
  );
  assert.equal(
    (await request(`/tickets/${refundableOrder.tickets[0].token}`)).data.ticket.valid,
    false,
  );
  assert.equal(
    (
      await request(
        '/organizer/check-in',
        { event_id: refundableEvent.id, code: refundableOrder.tickets[0].code },
        account.cookie,
      )
    ).status,
    409,
  );
});
