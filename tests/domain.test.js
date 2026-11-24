import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { makeConfig } from '../server/config.js';
import {
  saveEvent,
  reserveOrder,
  completeOrder,
  checkIn,
  normalizePhone,
  availableSlug,
} from '../server/domain.js';
import { verifyPayment, processDeliveries } from '../server/providers.js';
import { createInvite, requestClaimCode, claimTicket } from '../server/sharing.js';

function fixture(t, capacity = 10) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-test-'));
  const db = openDatabase(dir),
    config = makeConfig({
      dataDir: dir,
      seedDemo: false,
      paymentDriver: 'demo',
      production: false,
    });
  const user = {
    id: randomUUID(),
    name: 'Organizer',
    email: 'organizer@example.com',
    password: hashPassword('TestPassword123!'),
    role: 'organizer',
    phone: '',
    organization: '',
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
  const input = {
    name: 'Niffer Party',
    description: 'A party for our friends and community.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Nightlife',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 20000, capacity }],
  };
  const event = saveEvent(db, user.id, input),
    type = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').get(event.id);
  const order = (patch = {}) =>
    reserveOrder(
      db,
      {
        event_id: event.id,
        ticket_type_id: type.id,
        quantity: 1,
        phone: '0712345678',
        email: '',
        whatsapp: false,
        idempotency_key: randomUUID(),
        ...patch,
      },
      config,
    );
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, config, user, event, type, input, order };
}

test('phone normalization and slug collisions preserve reserved dashboard names', (t) => {
  const { db } = fixture(t);
  assert.equal(normalizePhone('0712 345 678'), '+255712345678');
  assert.equal(normalizePhone('255712345678'), '+255712345678');
  assert.equal(normalizePhone('712345678'), '+255712345678');
  assert.throws(() => normalizePhone('123'), /valid Tanzanian/);
  assert.equal(availableSlug(db, 'Niffer Party'), 'niffer-party-2');
  assert.equal(availableSlug(db, 'app'), 'app-event');
});
test('ticket inventory is reserved atomically and released when payment fails', (t) => {
  const { db, order } = fixture(t, 1);
  const first = order().order;
  assert.throws(() => order(), /not enough tickets/);
  db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(first.id);
  assert.equal(order().order.status, 'pending');
});
test('idempotent checkout and payment notifications never issue duplicate tickets', (t) => {
  const { db, order, config } = fixture(t);
  const key = randomUUID();
  const a = order({ quantity: 2, idempotency_key: key });
  const b = order({ quantity: 2, idempotency_key: key });
  assert.equal(a.order.id, b.order.id);
  assert.equal(b.created, false);
  assert.throws(() => order({ quantity: 3, idempotency_key: key }), /already used/);
  completeOrder(db, a.order.id, config);
  completeOrder(db, a.order.id, config);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_id=?').get(a.order.id).n,
    2,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE order_id=?').get(a.order.id).n,
    1,
  );
});
test('a late payment cannot take inventory that was sold to another buyer', (t) => {
  const { db, order, config } = fixture(t, 1);
  const late = order().order;
  db.prepare("UPDATE orders SET status='expired',expires_at=0 WHERE id=?").run(late.id);
  const next = order().order;
  completeOrder(db, next.id, config);
  assert.equal(completeOrder(db, late.id, config).status, 'review');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_id=?').get(late.id).n, 0);
});
test('inventory edits roll back when capacity falls below occupied tickets', (t) => {
  const { db, user, input, event, type, order } = fixture(t);
  order({ quantity: 3 });
  assert.throws(
    () =>
      saveEvent(
        db,
        user.id,
        { ...input, name: 'Changed', tickets: [{ ...type, capacity: 2 }] },
        event.id,
      ),
    /below sold and reserved/,
  );
  assert.equal(db.prepare('SELECT name FROM events WHERE id=?').get(event.id).name, 'Niffer Party');
});
test('check-in rejects duplicate scans, wrong events, and refunded tickets', (t) => {
  const { db, order, config, user, event, input } = fixture(t);
  const paid = completeOrder(db, order({ quantity: 2 }).order.id, config);
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_id=?').all(paid.id);
  const other = saveEvent(db, user.id, { ...input, name: 'Another Party' });
  assert.throws(() => checkIn(db, user, other.id, tickets[0].code), /does not belong/);
  assert.equal(checkIn(db, user, event.id, tickets[0].code).code, tickets[0].code);
  assert.throws(() => checkIn(db, user, event.id, tickets[0].token), /Already admitted/);
  db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(paid.id);
  assert.throws(() => checkIn(db, user, event.id, tickets[1].code), /not valid/);
});
test('cancelled events never issue new tickets after verified payment', (t) => {
  const { db, order, config, event } = fixture(t);
  const reserved = order().order;
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  assert.equal(completeOrder(db, reserved.id, config).status, 'review');
});
test('provider verification rejects mismatched references, currency, amount, and transaction IDs', async (t) => {
  const { db, order, config } = fixture(t),
    reserved = order().order;
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  for (const patch of [{ tx_ref: 'other' }, { currency: 'KES' }, { amount: 1 }]) {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            id: 123,
            tx_ref: reserved.reference,
            currency: 'TZS',
            amount: reserved.amount,
            status: 'successful',
            ...patch,
          },
        }),
      );
    await assert.rejects(verifyPayment(db, reserved, config, '123'), /mismatch/);
  }
  assert.equal(
    db.prepare('SELECT status FROM orders WHERE id=?').get(reserved.id).status,
    'pending',
  );
  db.prepare('UPDATE orders SET provider_id=? WHERE id=?').run('999', reserved.id);
  const withId = db.prepare('SELECT * FROM orders WHERE id=?').get(reserved.id);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'success',
        data: {
          id: 123,
          tx_ref: reserved.reference,
          currency: 'TZS',
          amount: reserved.amount,
          status: 'successful',
        },
      }),
    );
  await assert.rejects(verifyPayment(db, withId, config, '123'), /ID mismatch/);
});
test('delivery outbox persists all chosen channels without claiming they were sent', async (t) => {
  const { db, order, config } = fixture(t);
  const paid = completeOrder(
    db,
    order({ email: 'guest@example.com', whatsapp: true }).order.id,
    config,
  );
  await processDeliveries(db, config);
  const rows = db.prepare('SELECT * FROM deliveries WHERE order_id=?').all(paid.id);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((d) => d.status === 'outbox'));
  assert.ok(rows.every((d) => d.body.includes(paid.token)));
});
test('production configuration refuses demo payment and seeding', () => {
  assert.throws(
    () => makeConfig({ production: true, paymentDriver: 'demo', seedDemo: false }),
    /not allowed/,
  );
  assert.throws(
    () => makeConfig({ production: true, paymentDriver: 'disabled', seedDemo: true }),
    /not allowed/,
  );
});

test('purchase SMS includes a private link and four independent, single-use admission codes', async (t) => {
  const { db, order, config, user, event } = fixture(t);
  const sent = [];
  const deliveryConfig = {
    ...config,
    ticketSmsDriver: 'nextsms',
    smsGateway: {
      send: async (...args) => {
        sent.push(args);
        return { messageId: 'provider-ticket-1', status: 'accepted' };
      },
    },
  };
  const reserved = order({ quantity: 4, email: 'guest@example.com' }).order;
  await processDeliveries(db, deliveryConfig);
  assert.equal(sent.length, 0, 'unpaid orders cannot send tickets');
  completeOrder(db, reserved.id, deliveryConfig);
  completeOrder(db, reserved.id, deliveryConfig);
  await processDeliveries(db, deliveryConfig);
  await processDeliveries(db, deliveryConfig);
  assert.equal(sent.length, 1);
  const [phone, body, reference] = sent[0];
  assert.equal(phone, reserved.phone);
  assert.ok(body.includes(`${config.publicOrigin}/order/${reserved.token}`));
  assert.ok(body.includes(event.name));
  const codes = body.match(/GE-[A-F0-9]{8}/g);
  assert.equal(new Set(codes).size, 4);
  for (const code of codes) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE code=?').get(code);
    assert.equal(checkIn(db, user, event.id, code.toLowerCase()).code, code);
    assert.throws(() => checkIn(db, user, event.id, `/ticket/${ticket.token}`), /Already admitted/);
  }
  const delivery = db.prepare("SELECT * FROM deliveries WHERE channel='sms'").get();
  assert.equal(delivery.id, reference);
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.provider_message_id, 'provider-ticket-1');
  assert.equal(delivery.provider_status, 'accepted');
  assert.equal(
    db.prepare("SELECT status FROM deliveries WHERE channel='email'").get().status,
    'outbox',
  );
});

test("NextSMS purchase retries rebuild codes without exposing a friend's claimed ticket", async (t) => {
  const { db, order, config, event, user } = fixture(t);
  const paid = completeOrder(db, order({ quantity: 3 }).order.id, config);
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_id=?').all(paid.id);
  const sent = [];
  let fail = true;
  const deliveryConfig = {
    ...config,
    ticketSmsDriver: 'nextsms',
    smsGateway: {
      send: async (...args) => {
        if (fail) throw new Error('provider payload contains private data');
        sent.push(args);
        return { messageId: null, status: 'accepted' };
      },
    },
  };
  await processDeliveries(db, deliveryConfig);
  let delivery = db.prepare("SELECT * FROM deliveries WHERE channel='sms'").get();
  assert.equal(delivery.status, 'queued');
  assert.equal(delivery.attempts, 1);
  assert.ok(delivery.next_attempt > Date.now());
  assert.equal(delivery.error.includes('private data'), false);
  await processDeliveries(db, deliveryConfig);
  assert.equal(sent.length, 0);

  const invitation = createInvite(db, config, paid.token, tickets[0].id, {
    name: 'Asha',
    phone: '0712345671',
  })
    .url.split('/')
    .pop();
  const otp = await requestClaimCode(db, config, invitation, '127.0.0.1');
  claimTicket(db, config, invitation, { code: otp.demo_code, claim_key: randomUUID() });
  const claimed = db.prepare('SELECT * FROM tickets WHERE id=?').get(tickets[0].id);
  assert.notEqual(claimed.code, tickets[0].code);
  checkIn(db, user, event.id, tickets[1].code);
  fail = false;
  db.prepare('UPDATE deliveries SET next_attempt=0').run();
  await processDeliveries(db, deliveryConfig);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].includes(tickets[0].code), false);
  assert.equal(sent[0][1].includes(claimed.code), false);
  assert.equal(sent[0][1].includes(claimed.token), false);
  assert.equal(sent[0][1].includes(tickets[1].code), false);
  assert.ok(sent[0][1].includes(tickets[2].code));
  delivery = db.prepare("SELECT * FROM deliveries WHERE channel='sms'").get();
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.error, null);
  assert.equal(delivery.attempts, 2);
});

test('purchase SMS skips cancelled events, refunded orders and exhausted tickets', async (t) => {
  const { db, order, config, event, user } = fixture(t);
  let calls = 0;
  const deliveryConfig = {
    ...config,
    ticketSmsDriver: 'nextsms',
    smsGateway: {
      send: async () => {
        calls++;
        throw new Error('must not send');
      },
    },
  };
  const admitted = completeOrder(db, order().order.id, config);
  checkIn(
    db,
    user,
    event.id,
    db.prepare('SELECT code FROM tickets WHERE order_id=?').get(admitted.id).code,
  );
  await processDeliveries(db, deliveryConfig);
  assert.equal(
    db.prepare('SELECT status FROM deliveries WHERE order_id=?').get(admitted.id).status,
    'skipped',
  );
  const refunded = completeOrder(db, order().order.id, config);
  db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(refunded.id);
  const cancelled = completeOrder(db, order().order.id, config);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  await processDeliveries(db, deliveryConfig);
  assert.equal(
    db.prepare('SELECT status FROM deliveries WHERE order_id=?').get(cancelled.id).status,
    'skipped',
  );
  assert.equal(calls, 0);
});

test('enabling NextSMS never automatically replays historical outbox messages', async (t) => {
  const { db, order, config } = fixture(t);
  completeOrder(db, order().order.id, config);
  await processDeliveries(db, { ...config, ticketSmsDriver: 'outbox' });
  let calls = 0;
  await processDeliveries(db, {
    ...config,
    ticketSmsDriver: 'nextsms',
    smsGateway: {
      send: async () => {
        calls++;
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT status FROM deliveries').get().status, 'outbox');
});

test('NextSMS purchase delivery fails visibly after five attempts without issuing extra tickets', async (t) => {
  const { db, order, config } = fixture(t);
  const paid = completeOrder(db, order().order.id, config);
  const deliveryConfig = {
    ...config,
    ticketSmsDriver: 'nextsms',
    smsGateway: {
      send: async () => {
        throw new Error('rejected');
      },
    },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    db.prepare('UPDATE deliveries SET next_attempt=0').run();
    await processDeliveries(db, deliveryConfig);
  }
  const row = db.prepare('SELECT * FROM deliveries WHERE order_id=?').get(paid.id);
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 5);
  await processDeliveries(db, deliveryConfig);
  assert.equal(db.prepare('SELECT attempts FROM deliveries WHERE id=?').get(row.id).attempts, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1);
});

test('purchase SMS configuration is explicit and fails closed when NextSMS is not configured', () => {
  assert.equal(
    makeConfig({ deliveryDriver: 'outbox', ticketSmsDriver: '' }).ticketSmsDriver,
    'outbox',
  );
  assert.equal(
    makeConfig({ deliveryDriver: 'live', ticketSmsDriver: '' }).ticketSmsDriver,
    'twilio',
  );
  assert.equal(
    makeConfig({ deliveryDriver: 'live', ticketSmsDriver: 'outbox' }).ticketSmsDriver,
    'outbox',
  );
  assert.throws(() => makeConfig({ ticketSmsDriver: 'unknown' }), /Unknown ticket SMS driver/);
  assert.throws(
    () => makeConfig({ ticketSmsDriver: 'nextsms', nextsmsEnabled: false }),
    /NEXTSMS_ENABLED/,
  );
});

test('purchase delivery uses the NextSMS API and only records provider-confirmed acceptance', async (t) => {
  const { db, order, config } = fixture(t);
  const paid = completeOrder(db, order().order.id, config);
  const deliveryConfig = makeConfig({
    ...config,
    ticketSmsDriver: 'nextsms',
    nextsmsEnabled: true,
    nextsmsUsername: 'fixture',
    nextsmsPassword: 'fixture',
    nextsmsSenderId: 'GoldenECARD',
    nextsmsApiVersion: '1',
  });
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let accepted = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://messaging-service.co.tz/api/sms/v1/text/single');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.from, 'GoldenECARD');
    assert.equal(body.to, paid.phone.slice(1));
    assert.ok(body.text.includes(paid.token));
    assert.match(body.text, /GE-[A-F0-9]{8}/);
    assert.ok(body.reference);
    return accepted
      ? new Response(
          JSON.stringify({
            messages: [
              {
                to: body.to,
                messageId: 'sms-accepted',
                status: { groupId: 1, id: 7, name: 'PENDING_ENROUTE' },
              },
            ],
          }),
        )
      : new Response('<!DOCTYPE html>unavailable', { status: 503 });
  };
  await processDeliveries(db, deliveryConfig);
  assert.equal(db.prepare('SELECT status FROM deliveries').get().status, 'queued');
  accepted = true;
  db.prepare('UPDATE deliveries SET next_attempt=0').run();
  await processDeliveries(db, deliveryConfig);
  const delivery = db.prepare('SELECT * FROM deliveries').get();
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.provider_message_id, 'sms-accepted');
  assert.equal(delivery.provider_status, 'accepted');
});
