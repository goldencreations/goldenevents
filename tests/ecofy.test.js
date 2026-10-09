import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { saveEvent, reserveOrder } from '../server/domain.js';
import { createApp } from '../server/app.js';
import { prepareEcofy } from '../scripts/configure-ecofy.js';
import {
  initiateEcofy,
  verifyEcofy,
  verifyEcofySignature,
  processEcofyPayments,
} from '../server/ecofy.js';

function fixture(t, capacity = 10) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-ecofy-'));
  const db = openDatabase(dir);
  const config = makeConfig({
    production: false,
    seedDemo: false,
    dataDir: dir,
    paymentDriver: 'ecofy',
    ecofyApiKey: 'sk_test_fixture',
    ecofyWebhookSecret: 'whsec_fixture',
  });
  const owner = randomUUID();
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(
    owner,
    'Organizer',
    `${owner}@example.com`,
    'unused',
    'organizer',
    '',
    '',
    new Date().toISOString(),
  );
  const event = saveEvent(db, owner, {
    name: 'Ecofy Test',
    description: 'Payment integration test event.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Test Hall',
    city: 'Dar es Salaam',
    category: 'Community',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 500, capacity }],
  });
  const type = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').get(event.id);
  const order = (quantity = 4) =>
    reserveOrder(
      db,
      {
        event_id: event.id,
        ticket_type_id: type.id,
        quantity,
        phone: '0712345678',
        idempotency_key: randomUUID(),
      },
      config,
    ).order;
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, config, order, oldFetch, dir };
}

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
const payment = (order, patch = {}) => ({
  id: 'pay_fixture123',
  reference: order.reference,
  amount: order.amount,
  currency: 'TZS',
  method: 'mobile_money',
  status: 'pending',
  expires_at: new Date(Date.now() + 60000).toISOString(),
  ...patch,
});
const signature = (secret, body, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;

test('Ecofy phone-only checkout uses whole TZS, durable idempotency, and provider deadline', async (t) => {
  const { db, config, order } = fixture(t);
  const booking = order();
  const result = payment(booking);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://ecofypay.ecofy.co.tz/v1/payments');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_fixture');
    assert.equal(options.headers['Idempotency-Key'], `goldenevents-${booking.id}`);
    const body = JSON.parse(options.body);
    assert.equal(body.amount, 2000);
    assert.equal(body.currency, 'TZS');
    assert.equal(body.method, 'mobile_money');
    assert.deepEqual(body.customer, { phone: '255712345678' });
    assert.equal(body.customer.email, undefined);
    assert.equal(body.reference, booking.reference);
    assert.equal(options.redirect, 'error');
    return reply(result, 201);
  };
  await initiateEcofy(db, booking, config);
  assert.equal(calls, 1);
  const saved = db.prepare('SELECT * FROM orders WHERE id=?').get(booking.id);
  assert.equal(saved.provider_id, result.id);
  assert.equal(saved.expires_at, Date.parse(result.expires_at));
  assert.equal(saved.status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
  globalThis.fetch = async () => reply(payment(booking, { status: 'succeeded' }));
  await verifyEcofy(db, saved, config);
  await verifyEcofy(db, saved, config);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n, 1);
});

test('Ecofy ambiguous requests retry the identical payload/key after database reopen', async (t) => {
  const { db, config, order, dir } = fixture(t);
  const booking = order();
  let original;
  globalThis.fetch = async (_url, options) => {
    original = options;
    throw new Error('Network timeout after Ecofy received the request');
  };
  await assert.rejects(initiateEcofy(db, booking, config), /do not pay again/);
  assert.equal(db.prepare('SELECT status FROM orders').get().status, 'pending');
  const reopened = openDatabase(dir);
  t.after(() => reopened.close());
  reopened.prepare('UPDATE ecofy_jobs SET next_attempt=0').run();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.body, original.body);
    assert.equal(options.headers['Idempotency-Key'], original.headers['Idempotency-Key']);
    return reply(payment(booking), 201);
  };
  await processEcofyPayments(reopened, config);
  assert.equal(
    reopened.prepare('SELECT provider_id FROM orders').get().provider_id,
    'pay_fixture123',
  );
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
});

test('Ecofy rejects mismatched payment identity, reference, currency, method, and amount', async (t) => {
  const { db, config, order } = fixture(t);
  const booking = order();
  for (const patch of [
    { id: 'pay_other' },
    { reference: 'OTHER' },
    { currency: 'KES' },
    { amount: 200000 },
    { amount: '2000' },
    { method: 'qr' },
    { status: 'successful' },
  ]) {
    globalThis.fetch = async () => reply(payment(booking, { status: 'succeeded', ...patch }));
    await assert.rejects(verifyEcofy(db, booking, config, 'pay_fixture123'), /mismatch/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
});

test('Ecofy definitive validation failure releases stock but 5xx and conflicts remain uncertain', async (t) => {
  const { db, config, order } = fixture(t);
  for (const [status, code] of [
    [503, 'internal_error'],
    [409, 'request_in_progress'],
    [409, 'duplicate_reference'],
  ]) {
    const booking = order(1);
    globalThis.fetch = async () => reply({ error: { code } }, status);
    await assert.rejects(initiateEcofy(db, booking, config));
    assert.equal(
      db.prepare('SELECT status FROM orders WHERE id=?').get(booking.id).status,
      'pending',
    );
  }
  const rejected = order(1);
  globalThis.fetch = async () => reply({ error: { code: 'merchant_not_active' } }, 403);
  await assert.rejects(initiateEcofy(db, rejected, config), /could not accept/);
  assert.equal(
    db.prepare('SELECT status FROM orders WHERE id=?').get(rejected.id).status,
    'failed',
  );
  assert.equal(db.prepare('SELECT * FROM ecofy_jobs WHERE order_id=?').get(rejected.id), undefined);
});

test('Ecofy cancelled and failed payments never issue tickets; stale notifications cannot revoke paid tickets', async (t) => {
  const { db, config, order } = fixture(t);
  for (const [status, code, local] of [
    ['failed', 'provider_rejected', 'failed'],
    ['cancelled', 'expired', 'expired'],
  ]) {
    const booking = order(1);
    globalThis.fetch = async () => reply(payment(booking, { status, failure_code: code }));
    assert.equal((await verifyEcofy(db, booking, config, 'pay_fixture123')).status, local);
  }
  const booking = order(1);
  globalThis.fetch = async () => reply(payment(booking, { status: 'succeeded' }));
  await verifyEcofy(db, booking, config, 'pay_fixture123');
  globalThis.fetch = async () => reply(payment(booking, { status: 'pending' }));
  assert.equal((await verifyEcofy(db, booking, config, 'pay_fixture123')).status, 'paid');
  assert.equal(
    db.prepare('SELECT provider_status FROM orders WHERE id=?').get(booking.id).provider_status,
    'succeeded',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1);
});

test('Ecofy expired unknown requests recover by read-only pagination, never a new charge', async (t) => {
  const { db, config, order } = fixture(t);
  const booking = order();
  db.prepare("UPDATE orders SET status='expired',expires_at=0 WHERE id=?").run(booking.id);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.notEqual(options.method, 'POST');
    calls++;
    if (url.endsWith('/v1/payments?limit=100'))
      return reply({ data: [], has_more: true, next_before: 'pay_cursor123' });
    if (url.includes('before=pay_cursor123'))
      return reply({ data: [payment(booking)], has_more: false });
    assert.ok(url.endsWith('/v1/payments/pay_fixture123'));
    return reply(payment(booking, { status: 'succeeded' }));
  };
  await processEcofyPayments(db, config);
  assert.equal(calls, 3);
  assert.equal(db.prepare('SELECT status FROM orders').get().status, 'paid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 4);
});

test('Ecofy late success is sent to review when reserved inventory was sold', async (t) => {
  const { db, config, order } = fixture(t, 1);
  const late = order(1);
  db.prepare("UPDATE orders SET status='expired',expires_at=0 WHERE id=?").run(late.id);
  order(1);
  globalThis.fetch = async () => reply(payment(late, { status: 'succeeded' }));
  assert.equal((await verifyEcofy(db, late, config, 'pay_fixture123')).status, 'review');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
});

test('Ecofy webhook signatures reject tampering, stale/future timestamps, and malformed headers', () => {
  const body = Buffer.from('{"status":"succeeded"}');
  const secret = 'whsec_fixture';
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const valid = signature(secret, body, ts);
  assert.equal(verifyEcofySignature(valid, body, secret, now), true);
  assert.equal(
    verifyEcofySignature(valid, Buffer.from('{ "status":"succeeded"}'), secret, now),
    false,
  );
  for (const header of [
    undefined,
    '',
    't=bad,v1=ff',
    signature(secret, body, ts - 301),
    signature(secret, body, ts + 301),
    `${valid},t=${ts}`,
    `${valid},v1=ff`,
  ])
    assert.equal(verifyEcofySignature(header, body, secret, now), false);
});

test('Ecofy API verifies raw webhook bytes, deduplicates jobs, hides secrets, and marks unknown expiry', async (t) => {
  const { db, config, order, oldFetch } = fixture(t);
  const booking = order();
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = Buffer.from(JSON.stringify(payment(booking, { status: 'succeeded' }), null, 2));
  const send = (raw, sig) =>
    oldFetch(`${origin}/api/webhooks/ecofy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ecofy-Signature': sig },
      body: raw,
    });
  const sig = signature(config.ecofyWebhookSecret, body);
  assert.equal((await send(body, sig)).status, 200);
  assert.equal((await send(body, sig)).status, 200);
  const wrapped = Buffer.from(
    JSON.stringify({
      id: 'evt_fixture',
      type: 'payment.succeeded',
      created_at: new Date().toISOString(),
      data: payment(booking, { status: 'succeeded' }),
    }),
  );
  assert.equal((await send(wrapped, signature(config.ecofyWebhookSecret, wrapped))).status, 200);
  const mismatch = Buffer.from(
    JSON.stringify({
      type: 'payment.failed',
      data: payment(booking, { status: 'succeeded' }),
    }),
  );
  assert.equal((await send(mismatch, signature(config.ecofyWebhookSecret, mismatch))).status, 400);
  const unrelated = Buffer.from(JSON.stringify({ type: 'payout.paid', data: {} }));
  assert.equal(
    (await send(unrelated, signature(config.ecofyWebhookSecret, unrelated))).status,
    200,
  );
  assert.equal(
    (await send(Buffer.from(body.toString().replace('succeeded', 'cancelled')), sig)).status,
    401,
  );
  assert.equal(
    (
      await send(
        Buffer.from('not json'),
        signature(config.ecofyWebhookSecret, Buffer.from('not json')),
      )
    ).status,
    400,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM webhook_jobs').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
  const publicConfig = await (await oldFetch(`${origin}/api/config`)).json();
  assert.equal(publicConfig.ecofyApiKey, undefined);
  assert.equal(publicConfig.ecofyWebhookSecret, undefined);
  db.prepare("UPDATE orders SET status='expired',expires_at=0 WHERE id=?").run(booking.id);
  let result = await (await oldFetch(`${origin}/api/orders/${booking.token}`)).json();
  assert.equal(result.order.payment_uncertain, true);
  db.prepare("UPDATE orders SET provider_status='cancelled' WHERE id=?").run(booking.id);
  result = await (await oldFetch(`${origin}/api/orders/${booking.token}`)).json();
  assert.equal(result.order.payment_uncertain, false);
});

test('Ecofy configuration rejects missing secrets, insecure origins, and production test keys', () => {
  const config = {
    production: false,
    seedDemo: false,
    paymentDriver: 'ecofy',
    ecofyApiKey: 'sk_test_fixture',
    ecofyWebhookSecret: 'whsec_fixture',
  };
  assert.throws(() => makeConfig({ ...config, ecofyApiKey: '' }), /required/);
  assert.throws(() => makeConfig({ ...config, ecofyWebhookSecret: '' }), /required/);
  for (const origin of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com?key=secret',
  ])
    assert.throws(() => makeConfig({ ...config, ecofyBaseUrl: origin }), /HTTPS origin/);
  assert.throws(
    () =>
      makeConfig({
        ...config,
        production: true,
        publicOrigin: 'https://goldencreations.events',
        appOrigin: 'https://app.goldencreations.events',
      }),
    /live key/,
  );
});

test('Ecofy private setup verifies live merchant, registers a stable webhook, and never charges', async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  const env = {
    ECOFY_API_KEY: 'sk_live_fixture',
    PUBLIC_ORIGIN: 'https://goldencreations.events',
    PAYMENT_DRIVER: 'disabled',
  };
  let registration;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer sk_live_fixture');
    if (url.endsWith('/v1/merchant')) return reply({ status: 'active', mode: 'live' });
    assert.ok(url.endsWith('/v1/webhook-endpoints'));
    if (registration) {
      assert.equal(options.body, registration.body);
      assert.equal(options.headers['Idempotency-Key'], registration.headers['Idempotency-Key']);
    }
    registration = options;
    return reply({ url: JSON.parse(options.body).url, enabled: true, secret: 'whsec_fixture' });
  };
  const first = await prepareEcofy(env);
  assert.deepEqual(await prepareEcofy(env), first);
  assert.equal(first.ECOFY_WEBHOOK_SECRET, 'whsec_fixture');
  assert.equal(env.PAYMENT_DRIVER, 'disabled');
  globalThis.fetch = async () => reply({ status: 'pending', mode: 'live' });
  await assert.rejects(prepareEcofy(env), /active live/);
});
