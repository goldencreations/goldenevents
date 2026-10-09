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
