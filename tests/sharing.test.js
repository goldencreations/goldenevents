import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { tokenHash } from '../server/auth.js';
import { saveEvent, reserveOrder, completeOrder, checkIn } from '../server/domain.js';
import { createApp } from '../server/app.js';
import {
  createInvite,
  cancelInvite,
  bookingTickets,
  pendingInvite,
  requestClaimCode,
  claimTicket,
  sharingMode,
} from '../server/sharing.js';

function fixture(t, paid = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-sharing-'));
  const db = openDatabase(dir);
  const config = makeConfig({
    dataDir: dir,
    production: false,
    paymentDriver: 'demo',
    seedDemo: false,
    deliveryDriver: 'outbox',
  });
  const user = { id: randomUUID() };
  db.prepare('INSERT INTO users (id,name,email,password,created_at) VALUES (?,?,?,?,?)').run(
    user.id,
    'Host',
    'host@example.com',
    'unused',
    new Date().toISOString(),
  );
  const event = saveEvent(db, user.id, {
    name: 'Friends Night',
    description: 'A night out with four good friends.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Nightlife',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 20000, capacity: 4 }],
  });
  const type = db.prepare('SELECT id FROM ticket_types WHERE event_id=?').get(event.id);
  const { order } = reserveOrder(
    db,
    {
      event_id: event.id,
      ticket_type_id: type.id,
      quantity: 4,
      phone: '0712345678',
      email: '',
      whatsapp: false,
      idempotency_key: randomUUID(),
    },
    config,
  );
  if (paid) completeOrder(db, order.id, config);
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_id=? ORDER BY id').all(order.id);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const invite = (ticket = tickets[1], input = {}) => {
    const result = createInvite(db, config, order.token, ticket.id, {
      name: 'Asha',
      phone: '0712345671',
      ...input,
    });
    return result.url.split('/').pop();
  };
  return { db, config, user, event, order, tickets, invite };
}

test('four friends claim separate tickets; buyer loses recipient credentials and gate admits each independently', async (t) => {
  const { db, config, user, event, order, tickets } = fixture(t);
  const session = randomUUID();
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
    tokenHash(session),
    user.id,
    Date.now() + 60000,
  );
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, method = body ? 'POST' : 'GET', organizer = false) => {
    const response = await fetch(`${origin}/api${route}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(organizer ? { Cookie: `ge_session=${session}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  const recipients = ['Asha', 'Juma', 'Neema'];
  const newCodes = [];
  for (let i = 1; i < 4; i++) {
    const created = await request(`/orders/${order.token}/tickets/${tickets[i].id}/invite`, {
      name: recipients[i - 1],
      phone: `071234567${i}`,
    });
    assert.equal(created.status, 201);
    const token = created.data.url.split('/').pop();
    const invitation = await request(`/claims/${token}`);
    assert.equal(invitation.data.name, recipients[i - 1]);
    assert.equal(invitation.data.order, undefined);
    assert.equal(invitation.data.ticket_token, undefined);
    assert.equal(invitation.data.phone.includes('71234567'), false);
    const challenge = await request(`/claims/${token}/code`, {});
    assert.equal(challenge.status, 200);
    const key = randomUUID();
    assert.equal(
      (await request(`/claims/${token}/accept`, { code: '000000', claim_key: key })).status,
      400,
    );
    const accepted = await request(`/claims/${token}/accept`, {
      code: challenge.data.demo_code,
      claim_key: key,
    });
    assert.equal(accepted.status, 200);
    assert.notEqual(accepted.data.token, tickets[i].token);
    const repeat = await request(`/claims/${token}/accept`, {
      code: challenge.data.demo_code,
      claim_key: key,
    });
    assert.equal(repeat.data.token, accepted.data.token);
    assert.equal(
      (
        await request(`/claims/${token}/accept`, {
          code: challenge.data.demo_code,
          claim_key: randomUUID(),
        })
      ).status,
      410,
    );
    assert.equal((await request(`/tickets/${tickets[i].token}`)).status, 404);
    const held = await request(`/tickets/${accepted.data.token}`);
    assert.equal(held.data.ticket.holder_name, recipients[i - 1]);
    assert.notEqual(held.data.ticket.code, tickets[i].code);
    assert.ok(held.data.qr.startsWith('data:image/png'));
    newCodes.push(held.data.ticket.code);
    const booking = await request(`/orders/${order.token}`);
    const summary = booking.data.tickets.find((ticket) => ticket.id === tickets[i].id);
    assert.equal(summary.claimed, true);
    assert.equal(summary.token, undefined);
    assert.equal(summary.code, undefined);
    assert.equal(JSON.stringify(booking.data).includes(accepted.data.token), false);
    assert.equal(
      (await request(`/orders/${order.token}/tickets/${tickets[i].id}/invite`, {}, 'DELETE'))
        .status,
      409,
    );
    assert.equal(
      (
        await request(`/orders/${order.token}/tickets/${tickets[i].id}/invite`, {
          name: 'Other',
          phone: '0712345679',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          '/organizer/check-in',
          { event_id: event.id, code: tickets[i].code },
          'POST',
          true,
        )
      ).status,
      404,
    );
  }
  assert.equal(
    (
      await request(
        '/organizer/check-in',
        { event_id: event.id, code: tickets[0].code },
        'POST',
        true,
      )
    ).status,
    200,
  );
  for (let i = 0; i < 3; i++) {
    const admitted = await request(
      '/organizer/check-in',
      { event_id: event.id, code: newCodes[i] },
      'POST',
      true,
    );
    assert.equal(admitted.status, 200);
    assert.equal(admitted.data.ticket.holder_name, recipients[i]);
    assert.equal(admitted.data.ticket.phone, `+25571234567${i + 1}`);
    assert.equal(admitted.data.ticket.reference, order.reference);
    assert.equal(
      (
        await request(
          '/organizer/check-in',
          { event_id: event.id, code: newCodes[i] },
          'POST',
          true,
        )
      ).status,
      409,
    );
  }
  const guests = await request('/organizer/guests', undefined, 'GET', true);
  assert.equal(guests.data.guests.filter((g) => g.holder_name).length, 3);
  assert.equal(guests.data.guests.filter((g) => g.checked_in_at).length, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 4);
});

test('pending invitations can be cancelled, replaced, or expired without changing buyer admission', async (t) => {
  const { db, config, order, tickets, invite } = fixture(t);
  const first = invite();
  const otp = await requestClaimCode(db, config, first);
  const second = invite();
  assert.throws(() => pendingInvite(db, first), /cancelled/);
  assert.throws(
    () => claimTicket(db, config, first, { code: otp.demo_code, claim_key: randomUUID() }),
    /expired|cancelled/,
  );
  cancelInvite(db, order.token, tickets[1].id);
  assert.throws(() => pendingInvite(db, second), /cancelled/);
  const third = invite();
  db.prepare('UPDATE ticket_invites SET expires_at=0 WHERE token=?').run(third);
  assert.throws(() => pendingInvite(db, third), /expired/);
  assert.equal(
    bookingTickets(db, order.id, config).find((t) => t.id === tickets[1].id).invite,
    null,
  );
  assert.equal(
    db.prepare('SELECT token FROM tickets WHERE id=?').get(tickets[1].id).token,
    tickets[1].token,
  );
  assert.throws(
    () =>
      createInvite(db, config, 'wrong-booking', tickets[1].id, {
        name: 'Asha',
        phone: '0712345671',
      }),
    /not found/,
  );
});

test('claimed handover is blocked after admission, refund, cancellation, or challenge expiry', async (t) => {
  const { db, config, user, event, order, tickets, invite } = fixture(t);
  const token = invite();
  const code = (await requestClaimCode(db, config, token)).demo_code;
  const input = { code, claim_key: randomUUID() };
  db.prepare('UPDATE ticket_invites SET otp_expires_at=0 WHERE token=?').run(token);
  assert.throws(() => claimTicket(db, config, token, input), /expired/);
  db.prepare('UPDATE ticket_invites SET otp_expires_at=? WHERE token=?').run(
    Date.now() + 60000,
    token,
  );
  db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
  assert.throws(() => claimTicket(db, config, token, input), /no longer available/);
  db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  assert.throws(() => claimTicket(db, config, token, input), /no longer available/);
  db.prepare("UPDATE events SET status='published' WHERE id=?").run(event.id);
  checkIn(db, user, event.id, tickets[1].code);
  assert.throws(() => claimTicket(db, config, token, input), /admitted/);
  assert.throws(() => invite(), /admitted/);
  assert.equal(
    db.prepare('SELECT token FROM tickets WHERE id=?').get(tickets[1].id).token,
    tickets[1].token,
  );
});

test('verification attempts persist, cooldown applies, and phone rate limits span invitations', async (t) => {
  const { db, config, invite, tickets } = fixture(t);
  const token = invite();
  const challenge = await requestClaimCode(db, config, token);
  assert.notEqual(
    db.prepare('SELECT otp_hash FROM ticket_invites WHERE token=?').get(token).otp_hash,
    challenge.demo_code,
  );
  await assert.rejects(requestClaimCode(db, config, token), /Wait one minute/);
  for (let i = 0; i < 5; i++)
    assert.throws(
      () => claimTicket(db, config, token, { code: '000000', claim_key: randomUUID() }),
      /incorrect/,
    );
  assert.equal(
    db.prepare('SELECT otp_attempts FROM ticket_invites WHERE token=?').get(token).otp_attempts,
    5,
  );
  assert.throws(
    () => claimTicket(db, config, token, { code: challenge.demo_code, claim_key: randomUUID() }),
    /Too many/,
  );
  const next = invite(tickets[2]);
  await requestClaimCode(db, config, next);
  const third = invite(tickets[3]);
  await requestClaimCode(db, config, third);
  const fourth = invite(tickets[0]);
  await assert.rejects(requestClaimCode(db, config, fourth), /Too many verification/);
});

test('production never reveals or accepts demo verification codes; unconfigured SMS fails closed', async (t) => {
  const { db, config, invite, tickets, order } = fixture(t);
  const token = invite();
  const challenge = await requestClaimCode(db, config, token);
  const live = { ...config, production: true, paymentDriver: 'disabled' };
  assert.equal(sharingMode(live), 'disabled');
  assert.throws(
    () => createInvite(db, live, order.token, tickets[2].id, { name: 'Juma', phone: '0712345672' }),
    /not configured/,
  );
  await assert.rejects(requestClaimCode(db, live, token), /unavailable/);
  assert.throws(
    () => claimTicket(db, live, token, { code: challenge.demo_code, claim_key: randomUUID() }),
    /new verification/,
  );
});

test('live verification sends only to the invited phone and provider failure invalidates the code', async (t) => {
  const { db, config, invite } = fixture(t);
  const token = invite();
  const originalFetch = globalThis.fetch;
  const names = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM'];
  const originals = names.map((key) => process.env[key]);
  names.forEach((key) => {
    process.env[key] = 'test';
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    names.forEach((key, i) => {
      if (originals[i] === undefined) delete process.env[key];
      else process.env[key] = originals[i];
    });
  });
  const live = { ...config, production: true, paymentDriver: 'disabled', deliveryDriver: 'live' };
  let message;
  globalThis.fetch = async (_url, options) => {
    message = options.body;
    return { ok: true };
  };
  const challenge = await requestClaimCode(db, live, token);
  assert.equal(challenge.demo_code, undefined);
  assert.equal(message.get('To'), '+255712345671');
  const code = message.get('Body').match(/\b\d{6}\b/)[0];
  db.prepare('UPDATE ticket_invites SET last_sent=0 WHERE token=?').run(token);
  globalThis.fetch = async () => {
    throw new Error('Provider unavailable');
  };
  await assert.rejects(requestClaimCode(db, live, token), /Could not send/);
  assert.throws(() => claimTicket(db, live, token, { code, claim_key: randomUUID() }), /expired/);
});

test('database migration is repeatable and preserves an existing issued ticket', (t) => {
  const { db, config, tickets } = fixture(t);
  for (const name of ['holder_name', 'holder_phone', 'claimed_at'])
    db.exec(`ALTER TABLE tickets DROP COLUMN ${name}`);
  const second = openDatabase(config.dataDir);
  assert.equal(
    second.prepare('SELECT token FROM tickets WHERE id=?').get(tickets[0].id).token,
    tickets[0].token,
  );
  assert.equal(
    second.prepare('SELECT holder_name FROM tickets WHERE id=?').get(tickets[0].id).holder_name,
    null,
  );
  second.close();
});
