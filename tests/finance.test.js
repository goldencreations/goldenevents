import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { hashPassword } from '../server/auth.js';
import { platformFee } from '../server/fees.js';
import { saveEvent, reserveOrder, completeOrder } from '../server/domain.js';
import {
  organizerFinance,
  adminFinance,
  reconcileOrder,
  requestPayoutCode,
  confirmPayout,
  cancelPayout,
  reviewPayout,
  payoutVerificationMode,
} from '../server/finance.js';
import { createApp } from '../server/app.js';

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-finance-')),
    db = openDatabase(dir);
  const config = makeConfig({
    production: false,
    paymentDriver: 'demo',
    payoutDriver: 'manual',
    seedDemo: false,
    deliveryDriver: 'outbox',
    platformFeeBps: 500,
    payoutMinimum: 1000,
    dataDir: dir,
  });
  const account = (role) => {
    const user = {
      id: randomUUID(),
      name: `${role} test`,
      email: `${randomUUID()}@example.com`,
      password: hashPassword('TestPassword123!'),
      role,
      phone: '',
      organization: '',
      created_at: new Date().toISOString(),
    };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
    return user;
  };
  const user = account('organizer'),
    admin = account('admin'),
    other = account('organizer'),
    scanner = account('scanner');
  const event = saveEvent(db, user.id, {
    name: 'Finance Test Event',
    description: 'A test event for organizer earnings.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Music',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 20000, capacity: 100 }],
  });
  const type = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').get(event.id);
  const sale = () =>
    completeOrder(
      db,
      reserveOrder(
        db,
        {
          event_id: event.id,
          ticket_type_id: type.id,
          quantity: 1,
          phone: '0712345678',
          idempotency_key: randomUUID(),
        },
        config,
      ).order.id,
      config,
    );
  const release = (order) =>
    reconcileOrder(db, config, admin, order.id, {
      provider_fee: 500,
      reference: `statement-${order.id}`,
      funds_received: true,
    });
  const input = (patch = {}) => ({
    amount: 10000,
    phone: '0712345678',
    network: 'mpesa',
    recipient_name: 'Organizer Test',
    password: 'TestPassword123!',
    idempotency_key: randomUUID(),
    ...patch,
  });
  const code = (patch = {}) => requestPayoutCode(db, config, user, input(patch));
  const confirm = (c, account = user, patch = {}) =>
    confirmPayout(db, config, account, c.challenge_id, { code: c.demo_code, ...patch });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    db,
    config,
    user,
    admin,
    other,
    scanner,
    event,
    sale,
    release,
    input,
    code,
    confirm,
  };
}
test('fees round once in whole TZS and checkout preserves the original rate', (t) => {
  assert.equal(platformFee(20000, 500), 1000);
  assert.equal(platformFee(10, 500), 1);
  assert.equal(platformFee(9, 500), 0);
  assert.equal(platformFee(1000, 0), 0);
  assert.throws(() => platformFee(Number.MAX_SAFE_INTEGER + 1, 500));
  assert.throws(() => makeConfig({ platformFeeBps: -1 }));
  assert.throws(() => makeConfig({ payoutMinimum: 0 }));
  const { db, config, user, sale } = fixture(t);
  const order = sale();
  config.platformFeeBps = 600;
  completeOrder(db, order.id, config);
  assert.equal(
    db.prepare('SELECT platform_fee_bps FROM orders WHERE id=?').get(order.id).platform_fee_bps,
    500,
  );
  const finance = organizerFinance(db, config, user);
  assert.equal(finance.gross, 20000);
  assert.equal(finance.platform_fee, 1000);
  assert.equal(finance.net_estimate, 19000);
  assert.equal(finance.available, 0);
  assert.equal(finance.held, 19000);
  assert.equal(finance.provider_fees_pending, 1);
});
test('only administrator-confirmed, valid collections become withdrawable; legacy sales are not repriced', (t) => {
  const { db, config, user, admin, other, scanner, event, sale, release } = fixture(t);
  const order = sale();
  assert.throws(() => reconcileOrder(db, config, user, order.id, {}), /Administrator/);
  assert.throws(
    () =>
      reconcileOrder(db, config, admin, order.id, {
        provider_fee: 500,
        reference: 'stmt',
        funds_received: false,
      }),
    /confirm funds/,
  );
  assert.throws(
    () =>
      reconcileOrder(db, config, admin, order.id, {
        provider_fee: 19500,
        reference: 'stmt',
        funds_received: true,
      }),
    /Fees cannot exceed/,
  );
  release(order);
  release(order);
  let finance = organizerFinance(db, config, user);
  assert.equal(finance.available, 18500);
  assert.equal(finance.provider_fees, 500);
  assert.equal(finance.held, 0);
  assert.equal(organizerFinance(db, config, other).gross, 0);
  assert.throws(() => organizerFinance(db, config, scanner), /Organizer/);
  assert.throws(() => adminFinance(db, config, user), /Administrator/);
  assert.throws(
    () =>
      reconcileOrder(db, config, admin, order.id, {
        provider_fee: 0,
        reference: 'new-stmt',
        funds_received: true,
      }),
    /already been reconciled/,
  );
  const legacy = sale();
  db.prepare('UPDATE orders SET platform_fee=NULL,platform_fee_bps=NULL WHERE id=?').run(legacy.id);
  release(legacy);
  finance = organizerFinance(db, config, user);
  assert.equal(finance.legacy_orders, 1);
  assert.equal(finance.platform_fee, 1000);
  assert.equal(finance.available, 38000);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  assert.equal(organizerFinance(db, config, user).available, 0);
  assert.throws(() => release(order), /valid paid sales/);
});
test('password reauthentication, amount limits, recipient binding, resend limits and ownership are enforced', async (t) => {
  const { db, config, user, other, scanner, sale, release, input, code, confirm } = fixture(t);
  await assert.rejects(code(), /available balance/);
  release(sale());
  await assert.rejects(code({ password: 'wrong' }), /password is incorrect/);
  await assert.rejects(code({ amount: 999 }), /Check the amount/);
  await assert.rejects(code({ amount: 19000 }), /available balance/);
  await assert.rejects(code({ network: 'unsupported' }), /Check the amount/);
  await assert.rejects(requestPayoutCode(db, config, scanner, input()), /Organizer/);
  const request = input(),
    c = await requestPayoutCode(db, config, user, request);
  assert.match(c.demo_code, /^\d{6}$/);
  assert.equal((await requestPayoutCode(db, config, user, request)).challenge_id, c.challenge_id);
  await assert.rejects(
    requestPayoutCode(db, config, user, { ...request, amount: 12000 }),
    /different details/,
  );
  await assert.rejects(code(), /Too many verification requests/);
  assert.throws(() => confirm(c, other), /not found/);
  const p = confirm(c, user, { amount: 1, phone: '0744444444', network: 'airtel' });
  assert.equal(p.amount, 10000);
  assert.equal(p.phone, '+255712345678');
  assert.equal(p.network, 'mpesa');
  assert.equal(p.challenge_id, undefined);
  const stored = db
    .prepare('SELECT otp_hash FROM payout_challenges WHERE id=?')
    .get(c.challenge_id);
  assert.notEqual(stored.otp_hash, c.demo_code);
});
test('verification guesses are committed, codes expire, and password or mode changes invalidate them', async (t) => {
  const { db, config, user, sale, release, code, confirm } = fixture(t);
  release(sale());
  let c = await code();
  const wrong = c.demo_code === '100000' ? '100001' : '100000';
  for (let i = 0; i < 5; i++) assert.throws(() => confirm(c, user, { code: wrong }), /incorrect/);
  assert.equal(
    db.prepare('SELECT attempts FROM payout_challenges WHERE id=?').get(c.challenge_id).attempts,
    5,
  );
  assert.throws(() => confirm(c), /Too many incorrect/);
  db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  c = await code();
  db.prepare('UPDATE payout_challenges SET expires_at=0 WHERE id=?').run(c.challenge_id);
  assert.throws(() => confirm(c), /expired/);
  db.prepare('UPDATE payout_challenges SET expires_at=? WHERE id=?').run(
    Date.now() + 300000,
    c.challenge_id,
  );
  config.production = true;
  assert.throws(() => confirm(c), /verification changed/);
  config.production = false;
  db.prepare('UPDATE users SET password=? WHERE id=?').run(
    hashPassword('ChangedPassword123!'),
    user.id,
  );
  assert.throws(() => confirm(c), /verification changed/);
});
test('OTP confirmation reserves once; cancellation releases once and superseded codes cannot reserve', async (t) => {
  const { db, config, user, other, sale, release, code, confirm } = fixture(t);
  release(sale());
  const c = await code(),
    p = confirm(c);
  const duplicate = confirm(c);
  assert.equal(p.id, duplicate.id);
  assert.equal(organizerFinance(db, config, user).reserved, 10000);
  assert.equal(organizerFinance(db, config, user).available, 8500);
  assert.throws(() => cancelPayout(db, config, other, p.id), /not found/);
  cancelPayout(db, config, user, p.id);
  cancelPayout(db, config, user, p.id);
  assert.equal(organizerFinance(db, config, user).available, 18500);
  db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  const old = await code();
  db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  const next = await code();
  assert.throws(() => confirm(old), /replaced/);
  confirm(next);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 2);
});
test('balance changes are checked again at confirmation and approval', async (t) => {
  const { db, config, user, admin, event, sale, release, code, confirm } = fixture(t);
  const order = sale();
  release(order);
  const c = await code();
  db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
  assert.throws(() => confirm(c), /balance changed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
  db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
  const p = confirm(c);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event.id);
  assert.equal(organizerFinance(db, config, user).shortfall, 10000);
  assert.throws(
    () =>
      reviewPayout(db, config, admin, p.id, {
        action: 'processing',
        note: 'Confirmed beneficiary',
      }),
    /no longer sufficient/,
  );
  cancelPayout(db, config, user, p.id);
  assert.equal(organizerFinance(db, config, user).reserved, 0);
});
test('manual payout transitions need proof and preserve reservations for uncertain transfers', async (t) => {
  const { db, config, user, admin, sale, release, code, confirm } = fixture(t);
  release(sale());
  release(sale());
  const p = confirm(await code());
  assert.throws(() => reviewPayout(db, config, user, p.id, {}), /Administrator/);
  assert.throws(
    () =>
      reviewPayout(db, config, admin, p.id, {
        action: 'paid',
        note: 'Payment completed',
        transfer_reference: 'TX-111',
        transfer_confirmed: true,
      }),
    /already changed/,
  );
  reviewPayout(db, config, admin, p.id, {
    action: 'processing',
    note: 'Beneficiary and funds verified',
  });
  assert.throws(() => cancelPayout(db, config, user, p.id), /awaiting review/);
  assert.throws(
    () => reviewPayout(db, config, admin, p.id, { action: 'rejected', note: 'Transfer uncertain' }),
    /Confirm no transfer/,
  );
  assert.throws(
    () => reviewPayout(db, config, admin, p.id, { action: 'paid', note: 'Payment completed' }),
    /provider reference/,
  );
  assert.equal(organizerFinance(db, config, user).reserved, 10000);
  const proof = {
    action: 'paid',
    note: 'Recipient received the full amount',
    transfer_reference: 'TX-111',
    transfer_confirmed: true,
  };
  reviewPayout(db, config, admin, p.id, proof);
  reviewPayout(db, config, admin, p.id, proof);
  const finance = organizerFinance(db, config, user);
  assert.equal(finance.paid_out, 10000);
  assert.equal(finance.reserved, 0);
  assert.equal(finance.available, 27000);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM payout_audit WHERE payout_id=?').get(p.id).n,
    3,
  );
  assert.throws(
    () =>
      reviewPayout(db, config, admin, p.id, { action: 'rejected', note: 'Reject paid request' }),
    /already changed/,
  );
  db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  const next = confirm(await code());
  reviewPayout(db, config, admin, next.id, { action: 'processing', note: 'Beneficiary checked' });
  assert.throws(() => reviewPayout(db, config, admin, next.id, proof), /already been recorded/);
  reviewPayout(db, config, admin, next.id, {
    action: 'rejected',
    note: 'Provider confirmed no transfer',
    confirmed_not_sent: true,
  });
  assert.equal(organizerFinance(db, config, user).available, 27000);
});
test('live verification fails closed without email, never reveals a code, and ignores demo collections', async (t) => {
  const { db, config, user, admin, sale, release, input } = fixture(t);
  const demo = sale();
  release(demo);
  const live = { ...config, production: true, paymentDriver: 'disabled', deliveryDriver: 'outbox' };
  assert.equal(organizerFinance(db, live, user).gross, 0);
  assert.equal(payoutVerificationMode(live), 'disabled');
  await assert.rejects(requestPayoutCode(db, live, user, input()), /not configured/);
  assert.throws(
    () =>
      reconcileOrder(db, live, admin, demo.id, {
        provider_fee: 0,
        reference: 'stmt',
        funds_received: true,
      }),
    /not found/,
  );
  const order = sale();
  db.prepare("UPDATE orders SET provider='ecofy' WHERE id=?").run(order.id);
  reconcileOrder(db, live, admin, order.id, {
    provider_fee: 500,
    reference: 'real-statement-test',
    funds_received: true,
  });
  const env = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'tickets@example.test',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  live.deliveryDriver = 'live';
  let delivered;
  t.mock.method(nodemailer, 'createTransport', (options) => {
    assert.equal(options.requireTLS, true);
    return {
      sendMail: async (message) => {
        delivered = message;
        return { accepted: [user.email] };
      },
      close() {},
    };
  });
  const c = await requestPayoutCode(db, live, user, input());
  assert.equal(c.demo_code, undefined);
  assert.equal(c.mode, 'email');
  assert.equal(delivered.to, user.email);
  assert.match(delivered.text, /10000/);
  assert.match(delivered.text, /\+255712345678/);
  const sentCode = delivered.text.match(/code is (\d{6})/)[1];
  const p = confirmPayout(db, live, user, c.challenge_id, { code: sentCode });
  assert.equal(p.mode, 'manual');
  assert.equal(p.status, 'requested');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 1);
  db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async () => {
      throw new Error('private SMTP credentials');
    },
    close() {},
  }));
  await assert.rejects(
    requestPayoutCode(db, live, user, input({ amount: 5000 })),
    /could not be delivered/,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM payout_challenges WHERE status='failed'").get().n,
    1,
  );
  assert.equal(organizerFinance(db, live, user).reserved, 10000);
});
test('finance API authorization, CSRF, OTP reservation, review, and settled-refund guard work end to end', async (t) => {
  const { db, config, user, admin, other, scanner, sale } = fixture(t),
    order = sale();
  const server = createApp(db, config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (
    url,
    body,
    cookie = '',
    method = body ? 'POST' : 'GET',
    source = origin,
  ) => {
    const r = await fetch(`${origin}/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: source, Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      data: await r.json(),
    };
  };
  const login = async (account) =>
    (await request('/auth/login', { email: account.email, password: 'TestPassword123!' })).cookie;
  const ownerCookie = await login(user),
    adminCookie = await login(admin),
    otherCookie = await login(other),
    scannerCookie = await login(scanner);
  assert.equal((await request('/organizer/finance')).status, 401);
  assert.equal((await request('/organizer/finance', undefined, scannerCookie)).status, 403);
  assert.equal((await request('/admin/finance', undefined, ownerCookie)).status, 403);
  assert.equal((await request('/organizer/finance', undefined, otherCookie)).data.gross, 0);
  const settle = { provider_fee: 500, reference: 'statement-API', funds_received: true };
  assert.equal(
    (
      await request(
        `/admin/finance/orders/${order.id}/reconcile`,
        settle,
        adminCookie,
        'POST',
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`/admin/finance/orders/${order.id}/reconcile`, settle, adminCookie)).status,
    200,
  );
  assert.equal(
    (await request(`/organizer/orders/${order.id}/refund`, {}, ownerCookie)).status,
    409,
  );
  const c = (
    await request(
      '/organizer/payouts/code',
      {
        amount: 10000,
        phone: '0712345678',
        network: 'mpesa',
        recipient_name: 'Organizer Test',
        password: 'TestPassword123!',
        idempotency_key: randomUUID(),
      },
      ownerCookie,
    )
  ).data;
  assert.equal(
    (
      await request(
        `/organizer/payouts/${c.challenge_id}/confirm`,
        { code: c.demo_code },
        otherCookie,
      )
    ).status,
    404,
  );
  const approved = await request(
    `/organizer/payouts/${c.challenge_id}/confirm`,
    { code: c.demo_code },
    ownerCookie,
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.data.payout.challenge_id, undefined);
  assert.equal((await request('/organizer/finance', undefined, ownerCookie)).data.available, 8500);
  const review = { action: 'processing', note: 'Beneficiary and funds checked' };
  assert.equal(
    (await request(`/admin/payouts/${approved.data.payout.id}/review`, review, scannerCookie))
      .status,
    403,
  );
  assert.equal(
    (await request(`/admin/payouts/${approved.data.payout.id}/review`, review, adminCookie)).status,
    200,
  );
});
