import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { hashPassword, tokenHash } from '../server/auth.js';
import { saveEvent, reserveOrder, completeOrder, checkIn } from '../server/domain.js';
import {
  inviteScanner,
  acceptScanner,
  scannerInvitation,
  revokeScanner,
  cancelScannerInvite,
} from '../server/scanners.js';

async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-gate-')),
    db = openDatabase(dir);
  const config = makeConfig({
    dataDir: dir,
    production: false,
    seedDemo: false,
    paymentDriver: 'demo',
  });
  const addUser = (role, email) => {
    const user = {
      id: randomUUID(),
      name: 'Gate Person',
      email,
      password: hashPassword('GatePassword123!'),
      role,
      phone: '',
      organization: '',
      created_at: new Date().toISOString(),
    };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
    return user;
  };
  const owner = addUser('organizer', 'owner@example.com'),
    other = addUser('organizer', 'other@example.com'),
    admin = addUser('admin', 'admin@example.com');
  const event = saveEvent(db, owner.id, {
    name: 'Gate Night',
    description: 'Music and friends at the door.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse',
    city: 'Dar es Salaam',
    category: 'Music',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 1000, capacity: 10 }],
  });
  const second = saveEvent(db, other.id, {
    ...event,
    name: 'Other Gate',
    tickets: [{ name: 'Regular', price: 1000, capacity: 10 }],
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
  completeOrder(db, order.id, config);
  const tickets = db.prepare('SELECT * FROM tickets WHERE order_id=?').all(order.id);
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const session = (user) => {
    const raw = randomUUID();
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      tokenHash(raw),
      user.id,
      Date.now() + 60000,
    );
    return `ge_session=${raw}`;
  };
  const req = async (
    url,
    cookie = '',
    body,
    method = body ? 'POST' : 'GET',
    requestOrigin = origin,
  ) => {
    const res = await fetch(origin + '/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const invite = (by = owner, target = event, email = 'scanner@example.com') => {
    const result = inviteScanner(db, config, by, target.id, { name: 'Asha Gate', email });
    return { ...result, token: result.url.split('/').pop() };
  };
  return { db, config, owner, other, admin, event, second, tickets, session, req, invite };
}

test('scanner onboarding, least privilege, independent account, one admission and instant revocation', async (t) => {
  const f = await fixture(t),
    { db, req, owner, other, event, second, tickets } = f;
  const ownerCookie = f.session(owner),
    otherCookie = f.session(other);
  assert.equal((await req('/scanner/events')).status, 401);
  assert.equal((await req(`/gate/events/${event.id}/team`, otherCookie)).status, 404);
  assert.equal(
    (
      await req(`/gate/events/${event.id}/invites`, otherCookie, {
        name: 'Bad Actor',
        email: 'bad@example.com',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        `/gate/events/${event.id}/invites`,
        ownerCookie,
        { name: 'Asha', email: 'asha@example.com' },
        'POST',
        'https://evil.example',
      )
    ).status,
    403,
  );
  const created = await req(`/gate/events/${event.id}/invites`, ownerCookie, {
    name: 'Asha',
    email: 'ASHA@example.com',
    role: 'admin',
  });
  assert.equal(created.status, 201);
  const raw = created.data.url.split('/').pop();
  assert.equal(
    db.prepare('SELECT token_hash FROM scanner_invites WHERE id=?').get(created.data.id).token_hash,
    tokenHash(raw),
  );
  const pending = await req('/scanner-invites/' + raw);
  assert.equal(pending.data.email, 'asha@example.com');
  const accepted = await req(`/scanner-invites/${raw}/accept`, '', {
    password: 'ScannerPassword123!',
    role: 'admin',
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.user.role, 'scanner');
  assert.equal(accepted.data.user.password, undefined);
  assert.equal(
    (await req(`/scanner-invites/${raw}/accept`, '', { password: 'ScannerPassword123!' })).status,
    410,
  );
  const cookie = accepted.cookie;
  const events = await req('/scanner/events', cookie);
  assert.deepEqual(
    events.data.events.map((e) => e.id),
    [event.id],
  );
  for (const field of ['revenue', 'tickets', 'owner_id', 'orders', 'sold'])
    assert.equal(events.data.events[0][field], undefined);
  for (const url of [
    '/organizer/events',
    '/organizer/orders',
    '/organizer/stats',
    '/organizer/guests',
    '/organizer/deliveries',
    '/admin',
    '/gate/events',
  ])
    assert.equal((await req(url, cookie)).status, 403, url);
  assert.equal((await req('/organizer/events', cookie, {})).status, 403);
  assert.equal((await req(`/gate/events/${event.id}/team`, cookie)).status, 404);
  assert.equal(
    (await req('/scanner/check-in', cookie, { event_id: second.id, code: tickets[0].code })).status,
    404,
  );
  assert.equal(
    (
      await req(
        '/scanner/check-in',
        cookie,
        { event_id: event.id, code: tickets[0].code },
        'POST',
        'https://evil.example',
      )
    ).status,
    403,
  );
  const admitted = await req('/scanner/check-in', cookie, {
    event_id: event.id,
    code: tickets[0].code,
  });
  assert.equal(admitted.status, 200);
  assert.equal(admitted.data.ticket.phone.includes('712345678'), false);
  assert.equal(
    db.prepare('SELECT checked_in_by FROM tickets WHERE id=?').get(tickets[0].id).checked_in_by,
    accepted.data.user.id,
  );
  assert.equal(
    (await req('/organizer/guests', ownerCookie)).data.guests.find(
      (g) => g.code === tickets[0].code,
    ).admitted_by,
    'Asha',
  );
  const repeated = await Promise.all([
    req('/scanner/check-in', cookie, { event_id: event.id, code: tickets[1].code }),
    req('/scanner/check-in', ownerCookie, { event_id: event.id, code: tickets[1].code }),
  ]);
  assert.deepEqual(repeated.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await req(
        `/gate/events/${event.id}/scanners/${accepted.data.user.id}`,
        otherCookie,
        {},
        'DELETE',
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(
        `/gate/events/${event.id}/scanners/${accepted.data.user.id}`,
        ownerCookie,
        {},
        'DELETE',
      )
    ).status,
    200,
  );
  assert.equal(
    (await req('/scanner/check-in', cookie, { event_id: event.id, code: tickets[2].code })).status,
    404,
  );
  assert.equal((await req('/scanner/events', cookie)).data.events.length, 0);
  assert.equal(
    (await req('/auth/login', '', { email: 'asha@example.com', password: 'ScannerPassword123!' }))
      .status,
    200,
  );
  assert.equal((await req(`/gate/events/${event.id}/team`, ownerCookie)).data.scanners.length, 0);
});

test('platform staff can be assigned across owners without granting global scan or organizer access', async (t) => {
  const f = await fixture(t),
    a = f.invite(f.admin);
  const scanner = acceptScanner(f.db, a.token, null, { password: 'ScannerPassword123!' });
  assert.equal(
    f.db.prepare('SELECT source FROM event_scanners WHERE user_id=?').get(scanner.id).source,
    'golden',
  );
  assert.throws(() => checkIn(f.db, f.admin, f.event.id, f.tickets[0].code), /No scanner access/);
  const b = f.invite(f.admin, f.second);
  assert.throws(() => acceptScanner(f.db, b.token, null, {}), /Sign in/);
  acceptScanner(f.db, b.token, scanner, {});
  const cookie = f.session(scanner);
  assert.equal((await f.req('/scanner/events', cookie)).data.events.length, 2);
  revokeScanner(f.db, f.owner, f.event.id, scanner.id);
  assert.deepEqual(
    (await f.req('/scanner/events', cookie)).data.events.map((e) => e.id),
    [f.second.id],
  );
  const c = f.invite();
  acceptScanner(f.db, c.token, scanner, {});
  assert.equal((await f.req('/scanner/events', cookie)).data.events.length, 2);
  assert.equal((await f.req('/gate/events', f.session(f.admin))).data.events.length, 2);
});

test('existing accounts cannot be hijacked; invitations are single use, replaceable, cancellable and expiring', async (t) => {
  const f = await fixture(t),
    a = f.invite(f.owner, f.event, f.other.email);
  assert.throws(
    () => acceptScanner(f.db, a.token, null, { password: 'NewPassword123!' }),
    /Sign in/,
  );
  assert.throws(() => acceptScanner(f.db, a.token, f.owner, {}), /email on this invitation/);
  const accepted = acceptScanner(f.db, a.token, f.other, {});
  assert.equal(accepted.role, 'organizer');
  assert.equal(accepted.password, f.other.password);
  assert.throws(() => acceptScanner(f.db, a.token, f.other, {}), /no longer available/);
  const b = f.invite(),
    c = f.invite();
  assert.throws(() => scannerInvitation(f.db, b.token), /no longer available/);
  cancelScannerInvite(f.db, f.owner, f.event.id, c.id);
  assert.throws(() => scannerInvitation(f.db, c.token), /no longer available/);
  const d = f.invite();
  f.db.prepare('UPDATE scanner_invites SET expires_at=0 WHERE id=?').run(d.id);
  assert.throws(
    () => acceptScanner(f.db, d.token, null, { password: 'ScannerPassword123!' }),
    /expired/,
  );
  const e = f.invite();
  assert.throws(() => acceptScanner(f.db, e.token, null, { password: 'short' }), /at least 10/);
  f.db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(f.event.id);
  assert.throws(
    () => acceptScanner(f.db, e.token, null, { password: 'ScannerPassword123!' }),
    /cancelled/,
  );
  assert.throws(() => checkIn(f.db, f.other, f.event.id, f.tickets[0].code), /cancelled/);
});
