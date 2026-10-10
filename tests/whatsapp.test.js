import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { saveEvent, reserveOrder, completeOrder } from '../server/domain.js';
import { processDeliveries } from '../server/providers.js';
import { renderTicketImage } from '../server/ticket-image.js';
import { sendMetaTickets } from '../server/whatsapp.js';
import { createApp } from '../server/app.js';

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-whatsapp-'));
  const db = openDatabase(dir);
  const config = makeConfig({
    dataDir: dir,
    seedDemo: false,
    paymentDriver: 'demo',
    production: false,
    deliveryDriver: 'outbox',
  });
  const owner = randomUUID();
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(
    owner,
    'Organizer',
    'test@example.com',
    'unused',
    'organizer',
    '',
    '',
    new Date().toISOString(),
  );
  const event = saveEvent(db, owner, {
    name: 'Party & Friends',
    description: 'A community event for friends.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Venue',
    city: 'Dar es Salaam',
    category: 'Music',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 1000, capacity: 20 }],
  });
  const type = db.prepare('SELECT id FROM ticket_types WHERE event_id=?').get(event.id);
  const order = reserveOrder(
    db,
    {
      event_id: event.id,
      ticket_type_id: type.id,
      quantity: 2,
      phone: '0712345678',
      email: '',
      whatsapp: true,
      idempotency_key: randomUUID(),
    },
    config,
  ).order;
  completeOrder(db, order.id, config);
  const delivery = db.prepare("SELECT * FROM deliveries WHERE channel='whatsapp'").get();
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, config, event, order, delivery };
}

test('Meta sends private PNG media headers and resumes only unacknowledged tickets', async (t) => {
  const { db, config, delivery } = fixture(t);
  const keys = {
    WHATSAPP_DRIVER: 'meta',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_BUSINESS_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'test-only',
    WHATSAPP_TEMPLATE_NAME: 'golden_event_ticket',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en',
  };
  const previous = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  Object.assign(process.env, keys);
  t.after(() => {
    for (const key of Object.keys(keys)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  let uploads = 0,
    sends = 0;
  const payloads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    if (url.endsWith('?fields=display_phone_number'))
      return Response.json({ display_phone_number: '+255700000001' });
    if (url.includes('/message_templates?'))
      return Response.json({
        data: [
          {
            name: 'golden_event_ticket',
            language: 'en',
            status: 'APPROVED',
            components: [
              { type: 'HEADER', format: 'IMAGE' },
              { type: 'BODY', text: 'Your ticket is attached.' },
            ],
          },
        ],
      });
    if (url.endsWith('/media')) {
      uploads++;
      assert.equal(options.body.get('messaging_product'), 'whatsapp');
      const file = options.body.get('file');
      assert.equal(file.type, 'image/png');
      const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
      assert.equal(meta.width, 800);
      assert.equal(meta.height, 1280);
      return Response.json({ id: `media-${uploads}` });
    }
    sends++;
    payloads.push(JSON.parse(options.body));
    if (sends === 2)
      return Response.json(
        { error: { code: 130429, message: 'private provider details' } },
        { status: 429 },
      );
    return Response.json({ messages: [{ id: `message-${sends}` }] });
  });
  await processDeliveries(db, config);
  assert.equal(
    db.prepare('SELECT status FROM deliveries WHERE id=?').get(delivery.id).status,
    'queued',
  );
  assert.equal(
    db
      .prepare('SELECT COUNT(*) AS n FROM whatsapp_ticket_messages WHERE message_id IS NOT NULL')
      .get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT status FROM deliveries WHERE channel='sms'").get().status,
    'outbox',
  );
  db.prepare('UPDATE deliveries SET next_attempt=0 WHERE id=?').run(delivery.id);
  await processDeliveries(db, config);
  assert.equal(uploads, 2);
  assert.equal(sends, 3);
  assert.equal(
    db.prepare('SELECT status FROM deliveries WHERE id=?').get(delivery.id).status,
    'sent',
  );
  assert.equal(payloads[0].to, '255712345678');
  assert.deepEqual(payloads[0].template.components, [
    { type: 'header', parameters: [{ type: 'image', image: { id: 'media-1' } }] },
  ]);
  assert.equal(
    payloads[1].template.components[0].parameters[0].image.id,
    payloads[2].template.components[0].parameters[0].image.id,
  );
});

test('cancelled and claimed tickets are never uploaded to the original buyer', async (t) => {
  const { db, config, event, delivery } = fixture(t);
  const old = process.env.WHATSAPP_DRIVER;
  process.env.WHATSAPP_DRIVER = 'meta';
  const keys = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEMPLATE_NAME'];
  const values = keys.map((key) => process.env[key]);
  for (const key of keys) process.env[key] = 'test';
  t.after(() => {
    if (old === undefined) delete process.env.WHATSAPP_DRIVER;
    else process.env.WHATSAPP_DRIVER = old;
    keys.forEach((key, i) => {
      if (values[i] === undefined) delete process.env[key];
      else process.env[key] = values[i];
    });
  });
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Must not contact Meta');
  });
  db.prepare('UPDATE tickets SET claimed_at=?').run(new Date().toISOString());
  assert.equal(await sendMetaTickets(db, delivery, config), false);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  assert.equal(await sendMetaTickets(db, delivery, config), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM whatsapp_ticket_messages').get().n, 0);
});

test('pending template review holds tickets without consuming delivery retries', async (t) => {
  const { db, config, delivery } = fixture(t);
  const settings = {
    WHATSAPP_DRIVER: 'meta',
    WHATSAPP_BUSINESS_ID: '654321',
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'test-only',
    WHATSAPP_TEMPLATE_NAME: 'pending_ticket',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.includes('/message_templates?'));
    return Response.json({ data: [{ name: 'pending_ticket', language: 'en', status: 'PENDING' }] });
  });
  await processDeliveries(db, config);
  const row = db.prepare('SELECT * FROM deliveries WHERE id=?').get(delivery.id);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempts, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM whatsapp_ticket_messages').get().n, 0);
});

test('business sender cannot receive its own ticket and no image is uploaded', async (t) => {
  const { db, config, delivery } = fixture(t);
  const settings = {
    WHATSAPP_DRIVER: 'meta',
    WHATSAPP_PHONE_NUMBER_ID: '987654',
    WHATSAPP_ACCESS_TOKEN: 'test-only',
    WHATSAPP_TEMPLATE_NAME: 'golden_event_ticket',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.ok(url.endsWith('/987654?fields=display_phone_number'));
    return Response.json({ display_phone_number: delivery.recipient });
  });
  await assert.rejects(sendMetaTickets(db, delivery, config), /own business sender/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM whatsapp_ticket_messages').get().n, 0);
});

test('image renderer handles escaped labels and missing covers', async (t) => {
  const { config, event } = fixture(t);
  const png = await renderTicketImage(
    { ...event, image: '/uploads/missing.webp', name: '<Party> & Friends' },
    { code: 'GE-SAMPLE', token: 'sample', ticket_type: 'Regular', holder_name: '' },
    config,
  );
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 1280);
});

test('private ticket image endpoint rejects cancelled and rotated credentials', async (t) => {
  const { db, config, event } = fixture(t);
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const ticket = db.prepare('SELECT * FROM tickets LIMIT 1').get();
  const imageUrl = `http://127.0.0.1:${server.address().port}/api/tickets/${ticket.token}/image`;
  const response = await fetch(imageUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^image\/png/);
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width, 800);
  db.prepare('UPDATE tickets SET token=? WHERE id=?').run(randomUUID(), ticket.id);
  assert.equal((await fetch(imageUrl)).status, 404);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  const other = db.prepare('SELECT token FROM tickets WHERE id!=?').get(ticket.id);
  assert.equal(
    (await fetch(`http://127.0.0.1:${server.address().port}/api/tickets/${other.token}/image`))
      .status,
    404,
  );
});
