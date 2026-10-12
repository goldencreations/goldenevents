import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase, transaction } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { hashPassword, tokenHash } from '../server/auth.js';
import {
  issueOtp,
  consumeOtp,
  otpBinding,
  verifiedPhone,
  requestPhoneCode,
  verifyPhoneCode,
  otpOverview,
} from '../server/otp.js';
import { smsGateway, acceptedSms, toMsisdn } from '../server/sms.js';
import { createApp } from '../server/app.js';
import { saveEvent, reserveOrder, completeOrder, checkIn } from '../server/domain.js';
import {
  createInvite,
  requestClaimCode,
  claimTicket,
  bookingTickets,
  cancelInvite,
} from '../server/sharing.js';
import {
  requestPayoutCode,
  confirmPayout,
  organizerFinance,
  requestPayoutQuote,
  reconcileOrder,
} from '../server/finance.js';
import { createHealthMonitor } from '../server/health.js';

function fixture(t, patch = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-otp-')),
    db = openDatabase(dir),
    messages = [];
  const config = makeConfig({
    dataDir: dir,
    production: false,
    seedDemo: false,
    paymentDriver: 'demo',
    payoutDriver: 'manual',
    deliveryDriver: 'live',
    payoutOtpDriver: 'nextsms',
    smsGateway: {
      async send(phone, text, reference) {
        messages.push({ phone, text, reference });
        return { messageId: `fake-${messages.length}`, status: 'accepted' };
      },
    },
    ...patch,
  });
  const user = {
    id: randomUUID(),
    name: 'Organizer',
    email: `${randomUUID()}@example.com`,
    password: hashPassword('OtpTestPassword123!'),
    role: 'organizer',
    phone: '',
    organization: '',
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
  const context = {
    userId: user.id,
    phone: '+255748281701',
    purpose: 'phone_verification',
    binding: otpBinding(['phone', user.id]),
    ip: '127.0.0.1',
  };
  const lastCode = () => messages.at(-1).text.match(/code (\d{6})\./)[1];
  const consume = (id, code, ctx = context) =>
    transaction(db, () => consumeOtp(db, config, id, ctx, code));
  const row = (id) => db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(id);
  const age = (id) =>
    db.prepare('UPDATE otp_challenges SET created_at=? WHERE id=?').run(Date.now() - 61000, id);
  const verifyPhone = async () => {
    const challenge = await requestPhoneCode(
      db,
      config,
      user,
      { phone: context.phone, password: 'OtpTestPassword123!' },
      context.ip,
    );
    verifyPhoneCode(db, config, user, challenge.challenge_id, lastCode());
    age(challenge.challenge_id);
    return challenge;
  };
  const sale = () => {
    const event = saveEvent(db, user.id, {
      name: 'Four Friends',
      description: 'An event for four independently arriving friends.',
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      venue: 'Warehouse',
      city: 'Dar es Salaam',
      category: 'Music',
      image: '',
      status: 'published',
      tickets: [{ name: 'Regular', price: 20000, capacity: 4 }],
    });
    const type = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').get(event.id);
    const { order } = reserveOrder(
      db,
      {
        event_id: event.id,
        ticket_type_id: type.id,
        quantity: 4,
        phone: '0712345678',
        idempotency_key: randomUUID(),
      },
      config,
    );
    completeOrder(db, order.id, config);
    return {
      event,
      order,
      tickets: db.prepare('SELECT * FROM tickets WHERE order_id=?').all(order.id),
    };
  };
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    db,
    config,
    messages,
    user,
    context,
    lastCode,
    consume,
    row,
    age,
    verifyPhone,
    sale,
  };
}

test('NextSMS config is disabled by default and refuses unsafe credentials, URL, testing gateway and OTP settings', () => {
  assert.equal(makeConfig({ nextsmsEnabled: false }).nextsmsEnabled, false);
  for (const patch of [
    { nextsmsBaseUrl: 'http://example.com' },
    { nextsmsBaseUrl: 'https://example.com/api' },
    { nextsmsApiVersion: 3 },
    { nextsmsEnabled: true },
    { otpLength: 4 },
    { otpMaxAttempts: 6 },
    { otpTtlMinutes: 6 },
    { otpResendCooldownSeconds: 1 },
    { otpSendLimitPerHour: 100 },
    { otpVerificationTtlMinutes: 20 },
  ])
    assert.throws(() => makeConfig(patch));
  assert.throws(() => makeConfig({ production: true, smsGateway: {} }), /forbidden/);
  assert.throws(
    () =>
      makeConfig({
        nextsmsEnabled: true,
        nextsmsUsername: 'key',
        nextsmsPassword: 'secret',
        nextsmsSenderId: '   ',
      }),
    /Sender/,
  );
});
test('MSISDN normalization accepts all supported Tanzanian forms and rejects malformed input', () => {
  for (const phone of ['0748281701', '748281701', '+255748281701', '255748281701', '0748 281 701'])
    assert.equal(toMsisdn(phone), '255748281701');
  for (const phone of ['', '074828170', '07482817011', '254748281701', '123', null])
    assert.throws(() => toMsisdn(phone));
});
test('SMS acceptance is strict: rejects rejected, failed, undeliverable and unknown status even with HTTP 200', () => {
  const payload = (groupId, id, patch = {}) => ({
    messages: [{ to: '255748281701', messageId: 'provider-1', status: { groupId, id }, ...patch }],
  });
  for (const id of [50, 51, 52, 88])
    assert.equal(acceptedSms(payload(18, id), '255748281701').status, 'accepted');
  for (const id of [73, 77, 109]) assert.ok(acceptedSms(payload(20, id), '255748281701'));
  for (const [group, id] of [
    [19, 62],
    [22, 57],
    [22, 58],
    [20, 76],
    [20, 74],
    [20, 79],
    [1, 1],
    [18, 999],
  ])
    assert.equal(acceptedSms(payload(group, id), '255748281701'), null);
  for (const value of [
    {},
    { success: false, message_id: 'id' },
    { success: true },
    { success: true, messages: [] },
    payload(18, 51, { messageId: '' }),
    payload(18, 51, { to: '255712345678' }),
  ])
    assert.equal(acceptedSms(value, '255748281701'), null);
  assert.deepEqual(acceptedSms({ success: true, message_id: 'id' }, '255748281701'), {
    messageId: 'id',
    status: 'accepted',
  });
});
test('HTTP adapter uses documented Basic JSON endpoints, preserves large IDs, strips provider secrets and never retries ambiguous requests', async (t) => {
  const requests = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(
      '{"messages":[{"to":"255748281701","messageId":6342623755839987000,"status":{"groupId":18,"id":51,"groupName":"PENDING"}}]}',
    );
  });
  const config = makeConfig({
    nextsmsEnabled: true,
    nextsmsApiVersion: '2',
    nextsmsUsername: 'own-key',
    nextsmsPassword: 'own-secret',
    nextsmsSenderId: 'GoldenEvnts',
  });
  const result = await smsGateway(config).send('0748281701', 'redacted fixture', 'reference');
  assert.equal(result.messageId, '6342623755839987000');
  assert.equal(requests[0].url, 'https://messaging-service.co.tz/api/sms/v2/text/single');
  assert.equal(
    requests[0].options.headers.Authorization,
    `Basic ${Buffer.from('own-key:own-secret').toString('base64')}`,
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    from: 'GoldenEvnts',
    to: '255748281701',
    text: 'redacted fixture',
    reference: 'reference',
  });
  assert.equal(requests[0].options.redirect, 'error');
  config.nextsmsApiVersion = '1';
  fetch.mock.mockImplementation(async (url, options) => {
    assert.ok(url.endsWith('/v1/text/single'));
    assert.equal(JSON.parse(options.body).reference, 'reference');
    return new Response('{"success":true,"message_id":"v1-id"}');
  });
  assert.equal(
    (await smsGateway(config).send('0748281701', 'fixture', 'reference')).messageId,
    'v1-id',
  );
  for (const status of [401, 403, 422, 429, 500, 503]) {
    fetch.mock.mockImplementation(async () => new Response('secret echoed 482193', { status }));
    await assert.rejects(
      smsGateway(config).send('0748281701', 'fixture'),
      (e) =>
        e.status === 502 &&
        e.smsFailureCode === `http_${status}` &&
        !e.message.includes('secret') &&
        !e.message.includes('482193'),
    );
  }
  for (const body of ['not JSON', '{}', '{"success":false}', '{"success":true}']) {
    fetch.mock.mockImplementation(async () => new Response(body));
    await assert.rejects(smsGateway(config).send('0748281701', 'fixture'), { status: 502 });
  }
  let calls = 0;
  fetch.mock.mockImplementation(async () => {
    calls++;
    throw new DOMException('secret request timeout', 'TimeoutError');
  });
  await assert.rejects(smsGateway(config).send('0748281701', 'fixture'), { status: 502 });
  assert.equal(calls, 1);
  await assert.rejects(
    smsGateway({ ...config, nextsmsEnabled: false }).send('0748281701', 'fixture'),
    { status: 503 },
  );
});
test('account-linked v1 contract accepts only documented immediate status pairs, with an optional provider ID', () => {
  const payload = (groupId, id, name, patch = {}) => ({
    messages: [{ to: '255748281701', status: { groupId, id, name }, ...patch }],
  });
  assert.deepEqual(acceptedSms(payload(1, 7, 'PENDING_ENROUTE'), '255748281701', '1'), {
    messageId: null,
    status: 'accepted',
  });
  assert.deepEqual(acceptedSms(payload(3, 5, 'DELIVERED_TO_HANDSET'), '255748281701', '1'), {
    messageId: null,
    status: 'delivered',
  });
  for (const [group, id] of [
    [18, 50],
    [18, 51],
    [18, 52],
    [20, 73],
    [20, 77],
  ])
    assert.ok(acceptedSms(payload(group, id, 'DOCUMENTED'), '255748281701', '1'));
  for (const [group, id, name] of [
    [1, 26, 'PENDING_ACCEPTED'],
    [19, 57, 'REJECTED_NOT_ENOUGH_CREDITS'],
    [20, 76, 'UNDELIVERABLE'],
    [22, 58, 'FAILED_SENDER'],
    [1, 999, 'PENDING_ENROUTE'],
  ])
    assert.equal(acceptedSms(payload(group, id, name), '255748281701', '1'), null);
  assert.equal(acceptedSms(payload(1, 7, 'PENDING_ENROUTE'), '255748281701', '2'), null);
  assert.equal(
    acceptedSms(payload(18, 51, 'PENDING_ENROUTE', { to: '255712345678' }), '255748281701', '1'),
    null,
  );
  assert.equal(
    acceptedSms(payload(18, 51, 'PENDING_ENROUTE', { to: undefined }), '255748281701', '1'),
    null,
  );
  assert.equal(
    acceptedSms(payload(18, 51, 'PENDING_ENROUTE', { messageId: '' }), '255748281701', '1'),
    null,
  );
  assert.equal(acceptedSms({ success: true }, '255748281701', '1'), null);
});
test('v1 is the default, sends the documented reference, and never calls the dummy endpoint for real verification', async (t) => {
  const config = makeConfig({
    nextsmsEnabled: true,
    nextsmsUsername: 'fixture',
    nextsmsPassword: 'fixture',
    nextsmsSenderId: 'GoldenECARD',
  });
  assert.equal(config.nextsmsApiVersion, '1');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://messaging-service.co.tz/api/sms/v1/text/single');
    assert.deepEqual(JSON.parse(options.body), {
      from: 'GoldenECARD',
      to: '255748281701',
      text: 'fixture',
      reference: 'challenge-reference',
    });
    return new Response(
      JSON.stringify({
        messages: [{ to: '255748281701', status: { groupId: 1, id: 7, name: 'PENDING_ENROUTE' } }],
      }),
    );
  });
  assert.deepEqual(await smsGateway(config).send('0748281701', 'fixture', 'challenge-reference'), {
    messageId: null,
    status: 'accepted',
  });
});
test('v1 without a provider ID still persists a usable purpose-bound OTP, and numeric failure diagnostics never include message bodies', async (t) => {
  const f = fixture(t);
  f.config.smsGateway = { send: async () => ({ messageId: null, status: 'accepted' }) };
  const c = await issueOtp(f.db, f.config, f.context);
  assert.equal(f.row(c.challenge_id).status, 'sent');
  assert.equal(f.row(c.challenge_id).provider_message_id, null);
  assert.ok(f.row(c.challenge_id).code_hash);
  assert.equal(c.demo_code, undefined);
  f.age(c.challenge_id);
  f.config.smsGateway = {
    send: async () => {
      const e = new Error('body with secret code must never be saved');
      e.smsFailureCode = 'provider_19_56';
      throw e;
    },
  };
  await assert.rejects(issueOtp(f.db, f.config, f.context), { status: 502 });
  const failure = f.db.prepare("SELECT * FROM otp_challenges WHERE status='delivery_failed'").get();
  assert.equal(failure.error_code, 'provider_19_56');
  assert.equal(failure.code_hash, null);
  assert.equal(JSON.stringify(failure).includes('secret code'), false);
});
test('OTP is random, salted, purpose/owner/context bound, single use, cleared atomically, and never returned', async (t) => {
  const f = fixture(t),
    c = await issueOtp(f.db, f.config, f.context),
    code = f.lastCode();
  assert.match(code, /^[1-9]\d{5}$/);
  assert.equal(JSON.stringify(c).includes(code), false);
  assert.equal(c.demo_code, undefined);
  assert.ok(f.row(c.challenge_id).code_hash && !f.row(c.challenge_id).code_hash.includes(code));
  for (const patch of [
    { userId: randomUUID() },
    { purpose: 'payout' },
    { phone: '0712345678' },
    { binding: otpBinding('changed') },
  ])
    assert.equal(f.consume(c.challenge_id, code, { ...f.context, ...patch }).status, 404);
  assert.equal(f.consume(c.challenge_id, code).ok, true);
  assert.equal(f.row(c.challenge_id).code_hash, null);
  assert.equal(f.row(c.challenge_id).status, 'verified');
  assert.equal(f.consume(c.challenge_id, code).ok, false);
  assert.equal(JSON.stringify(otpOverview(f.db)).includes('+255748281701'), false);
});
test('wrong guesses commit, lock at five, expire, and resending supersedes the old code', async (t) => {
  const f = fixture(t),
    c = await issueOtp(f.db, f.config, f.context);
  for (let i = 0; i < 5; i++)
    assert.equal(f.consume(c.challenge_id, '000000').status, i === 4 ? 429 : 400);
  assert.equal(f.row(c.challenge_id).attempts, 5);
  assert.equal(f.row(c.challenge_id).code_hash, null);
  assert.equal(f.consume(c.challenge_id, f.lastCode()).status, 429);
  await assert.rejects(issueOtp(f.db, f.config, f.context), { status: 429 });
  f.age(c.challenge_id);
  const fresh = await issueOtp(f.db, f.config, f.context);
  f.db.prepare('UPDATE otp_challenges SET expires_at=0 WHERE id=?').run(fresh.challenge_id);
  assert.equal(f.consume(fresh.challenge_id, f.lastCode()).status, 409);
  assert.equal(f.row(fresh.challenge_id).status, 'expired');
  assert.equal(f.row(fresh.challenge_id).code_hash, null);
  f.age(fresh.challenge_id);
  const third = await issueOtp(f.db, f.config, f.context),
    oldCode = f.lastCode();
  f.age(third.challenge_id);
  const fourth = await issueOtp(f.db, f.config, f.context);
  assert.equal(f.row(third.challenge_id).status, 'superseded');
  assert.equal(f.row(third.challenge_id).code_hash, null);
  assert.equal(f.consume(third.challenge_id, oldCode).ok, false);
  assert.equal(f.consume(fourth.challenge_id, f.lastCode()).ok, true);
});
test('send limits are durable across purposes, IPs, resends and database reopen', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) {
    const c = await issueOtp(f.db, f.config, { ...f.context, ip: `ip-${i}` });
    f.age(c.challenge_id);
  }
  await assert.rejects(issueOtp(f.db, f.config, { ...f.context, ip: 'new-ip' }), { status: 429 });
  const another = openDatabase(f.dir);
  try {
    await assert.rejects(issueOtp(another, f.config, { ...f.context, ip: 'new-ip' }), {
      status: 429,
    });
  } finally {
    another.close();
  }
  for (let i = 0; i < 3; i++)
    await issueOtp(f.db, f.config, {
      ...f.context,
      phone: `071234567${i}`,
      ip: 'abusive-ip',
      purpose: i === 2 ? 'payout' : 'phone_verification',
    });
  await assert.rejects(
    issueOtp(f.db, f.config, { ...f.context, phone: '0712345678', ip: 'abusive-ip' }),
    { status: 429 },
  );
});
test('unconfirmed provider sends invalidate the hash and pending codes cannot authorize an action', async (t) => {
  const f = fixture(t);
  let pending;
  f.config.smsGateway.send = async () => {
    pending = f.db.prepare('SELECT * FROM otp_challenges').get();
    assert.equal(f.consume(pending.id, '000000').ok, false);
    throw new Error('upstream contains secret body');
  };
  await assert.rejects(
    issueOtp(f.db, f.config, f.context),
    (e) => e.status === 502 && !e.message.includes('secret'),
  );
  assert.equal(f.row(pending.id).status, 'delivery_failed');
  assert.equal(f.row(pending.id).code_hash, null);
  await assert.rejects(issueOtp(f.db, f.config, f.context), { status: 429 });
});
test('phone verification requires password and current ownership; contact edits cannot replace payout security phone', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    requestPhoneCode(f.db, f.config, f.user, { phone: f.context.phone, password: 'wrong' }),
    { status: 401 },
  );
  await assert.rejects(requestPhoneCode(f.db, f.config, { ...f.user, role: 'scanner' }, {}), {
    status: 403,
  });
  const c = await requestPhoneCode(f.db, f.config, f.user, {
    phone: f.context.phone,
    password: 'OtpTestPassword123!',
  });
  assert.throws(
    () =>
      verifyPhoneCode(
        f.db,
        f.config,
        { ...f.user, id: randomUUID() },
        c.challenge_id,
        f.lastCode(),
      ),
    { status: 404 },
  );
  verifyPhoneCode(f.db, f.config, f.user, c.challenge_id, f.lastCode());
  assert.equal(verifiedPhone(f.db, f.user.id), '+255748281701');
  assert.throws(() => verifyPhoneCode(f.db, f.config, f.user, c.challenge_id, f.lastCode()), {
    status: 409,
  });
  f.db.prepare('UPDATE users SET phone=? WHERE id=?').run('+255712345678', f.user.id);
  assert.equal(verifiedPhone(f.db, f.user.id), '+255748281701');
  await assert.rejects(
    requestPhoneCode(f.db, f.config, f.user, {
      phone: '0712345678',
      password: 'OtpTestPassword123!',
    }),
    { status: 409 },
  );
});
test('password changes invalidate phone-verification codes already sent', async (t) => {
  const f = fixture(t),
    c = await requestPhoneCode(f.db, f.config, f.user, {
      phone: f.context.phone,
      password: 'OtpTestPassword123!',
    });
  f.db
    .prepare('UPDATE users SET password=? WHERE id=?')
    .run(hashPassword('ChangedPassword123!'), f.user.id);
  assert.throws(() => verifyPhoneCode(f.db, f.config, f.user, c.challenge_id, f.lastCode()), {
    status: 404,
  });
  assert.equal(verifiedPhone(f.db, f.user.id), null);
});
test('payout SMS goes to verified primary phone, never destination; confirmation reserves once and keeps OTP secret', async (t) => {
  const f = fixture(t),
    { order } = f.sale();
  reconcileOrder(f.db, f.config, { ...f.user, role: 'admin' }, order.id, {
    provider_fee: 0,
    reference: 'test-statement',
    funds_received: true,
  });
  const input = {
    amount: 10000,
    phone: '0712345678',
    network: 'mpesa',
    recipient_name: 'Payout Recipient',
    password: 'OtpTestPassword123!',
    idempotency_key: randomUUID(),
  };
  await assert.rejects(requestPayoutCode(f.db, f.config, f.user, input), { status: 409 });
  await f.verifyPhone();
  f.db.prepare('UPDATE users SET phone=? WHERE id=?').run('+255712345679', f.user.id);
  const c = await requestPayoutCode(f.db, f.config, f.user, input, 'payout-ip');
  assert.equal(c.mode, 'nextsms');
  assert.equal(c.delivery_channel, 'sms');
  assert.equal(c.demo_code, undefined);
  assert.equal(f.messages.at(-1).phone, '+255748281701');
  assert.equal(JSON.stringify(c).includes(f.lastCode()), false);
  const sentCount = f.messages.length;
  const recovered = await requestPayoutCode(f.db, f.config, f.user, input, 'payout-ip');
  assert.equal(recovered.challenge_id, c.challenge_id);
  assert.equal(recovered.demo_code, undefined);
  assert.equal(f.messages.length, sentCount);
  await assert.rejects(
    requestPayoutCode(f.db, f.config, f.user, { ...input, amount: 11000 }, 'payout-ip'),
    { status: 409 },
  );
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
  assert.throws(() => confirmPayout(f.db, f.config, f.user, c.challenge_id, { code: '000000' }), {
    status: 400,
  });
  const payout = confirmPayout(f.db, f.config, f.user, c.challenge_id, { code: f.lastCode() });
  assert.equal(payout.phone, '+255712345678');
  assert.equal(payout.amount, 10000);
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 10000);
  const replay = confirmPayout(f.db, f.config, f.user, c.challenge_id, { code: f.lastCode() });
  assert.equal(replay.id, payout.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 1);
  const otp = f.db.prepare("SELECT * FROM otp_challenges WHERE purpose='payout'").get();
  assert.equal(otp.status, 'verified');
  assert.equal(otp.code_hash, null);
});
test('quoted payout SMS authorizes the exact quote plus withdrawal fee and preserves bank account zeros', async (t) => {
  const f = fixture(t, { payoutDriver: 'demo' });
  f.sale();
  await f.verifyPhone();
  const q = await requestPayoutQuote(f.db, f.config, f.user, {
    amount: 10000,
    destination_type: 'bank',
    account: '0012345678',
    channel: 'CRDB',
    password: 'OtpTestPassword123!',
    idempotency_key: randomUUID(),
  });
  const c = await requestPayoutCode(
    f.db,
    f.config,
    f.user,
    {
      quote_id: q.id,
      account_name_confirmed: true,
      password: 'OtpTestPassword123!',
      idempotency_key: randomUUID(),
    },
    'payout-ip',
  );
  assert.ok(f.messages.at(-1).text.includes(`TZS ${q.total}`));
  assert.equal(f.messages.at(-1).phone, '+255748281701');
  const payout = confirmPayout(f.db, f.config, f.user, c.challenge_id, { code: f.lastCode() });
  assert.equal(payout.phone, '0012345678');
  assert.equal(payout.payout_fee, q.fee);
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, q.total);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_jobs').get().n, 1);
});
test('payout SMS failures cannot reserve funds; five bad guesses lock and password changes invalidate confirmation', async (t) => {
  const f = fixture(t),
    { order } = f.sale();
  reconcileOrder(f.db, f.config, { ...f.user, role: 'admin' }, order.id, {
    provider_fee: 0,
    reference: 'test-statement',
    funds_received: true,
  });
  await f.verifyPhone();
  const input = () => ({
    amount: 10000,
    phone: '0712345678',
    network: 'mpesa',
    recipient_name: 'Recipient',
    password: 'OtpTestPassword123!',
    idempotency_key: randomUUID(),
  });
  const gateway = f.config.smsGateway;
  f.config.smsGateway = {
    send: async () => {
      throw new Error('failed');
    },
  };
  await assert.rejects(requestPayoutCode(f.db, f.config, f.user, input(), 'payout-ip'), {
    status: 502,
  });
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
  assert.equal(f.db.prepare('SELECT status FROM payout_challenges').get().status, 'failed');
  f.db.prepare('UPDATE otp_challenges SET created_at=?').run(Date.now() - 61000);
  f.config.smsGateway = gateway;
  const c = await requestPayoutCode(f.db, f.config, f.user, input(), 'payout-ip');
  for (let i = 0; i < 5; i++)
    assert.throws(() => confirmPayout(f.db, f.config, f.user, c.challenge_id, { code: '000000' }));
  assert.equal(
    f.db
      .prepare(
        "SELECT status,code_hash FROM otp_challenges WHERE purpose='payout' ORDER BY created_at DESC",
      )
      .get().status,
    'locked',
  );
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
  const prior = f.db
    .prepare("SELECT id FROM otp_challenges WHERE purpose='payout' ORDER BY created_at DESC")
    .get();
  f.age(prior.id);
  const fresh = await requestPayoutCode(f.db, f.config, f.user, input(), 'another-ip');
  f.db
    .prepare('UPDATE users SET password=? WHERE id=?')
    .run(hashPassword('ChangedPassword123!'), f.user.id);
  assert.throws(
    () => confirmPayout(f.db, f.config, f.user, fresh.challenge_id, { code: f.lastCode() }),
    { status: 409 },
  );
});
test('shared tickets use NextSMS only to the friend; rotate admission credentials and replay only with private claim key', async (t) => {
  const f = fixture(t),
    { order, tickets, event } = f.sale();
  for (let i = 1; i < 4; i++) {
    const invite = createInvite(f.db, f.config, order.token, tickets[i].id, {
      name: `Friend ${i}`,
      phone: `071234567${i}`,
    })
      .url.split('/')
      .pop();
    const c = await requestClaimCode(f.db, f.config, invite, `friend-ip-${i}`),
      code = f.lastCode();
    assert.equal(c.verification_mode, 'nextsms');
    assert.equal(c.demo_code, undefined);
    assert.equal(f.messages.at(-1).phone, `+25571234567${i}`);
    assert.throws(
      () => claimTicket(f.db, f.config, invite, { code: '000000', claim_key: randomUUID() }),
      { status: 400 },
    );
    const key = randomUUID(),
      accepted = claimTicket(f.db, f.config, invite, { code, claim_key: key });
    assert.notEqual(accepted.token, tickets[i].token);
    assert.equal(
      claimTicket(f.db, f.config, invite, { code, claim_key: key }).token,
      accepted.token,
    );
    assert.throws(() => claimTicket(f.db, f.config, invite, { code, claim_key: randomUUID() }), {
      status: 410,
    });
    const summary = bookingTickets(f.db, order.id, f.config).find((r) => r.id === tickets[i].id);
    assert.equal(summary.token, undefined);
    assert.equal(summary.code, undefined);
    const ticket = f.db.prepare('SELECT * FROM tickets WHERE id=?').get(tickets[i].id);
    assert.equal(checkIn(f.db, f.user, event.id, ticket.code).holder_name, `Friend ${i}`);
    assert.throws(() => checkIn(f.db, f.user, event.id, tickets[i].code), { status: 404 });
  }
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM otp_challenges WHERE code_hash IS NULL AND status='verified'",
      )
      .get().n,
    3,
  );
});
test('cancelled, admitted and refunded invitations cannot use an SMS already sent', async (t) => {
  const f = fixture(t),
    { order, tickets, event } = f.sale();
  for (let i = 0; i < 3; i++) {
    const invite = createInvite(f.db, f.config, order.token, tickets[i].id, {
      name: 'Friend',
      phone: `071234567${i}`,
    })
      .url.split('/')
      .pop();
    await requestClaimCode(f.db, f.config, invite, `ip-${i}`);
    const code = f.lastCode();
    if (i === 0) cancelInvite(f.db, order.token, tickets[i].id);
    if (i === 1) checkIn(f.db, f.user, event.id, tickets[i].code);
    if (i === 2) f.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
    assert.throws(() => claimTicket(f.db, f.config, invite, { code, claim_key: randomUUID() }));
    assert.equal(
      f.db.prepare('SELECT token FROM tickets WHERE id=?').get(tickets[i].id).token,
      tickets[i].token,
    );
  }
});
test('public OTP health distinguishes unobserved configuration, provider acceptance and failures without sending probes', async (t) => {
  const f = fixture(t, {
    nextsmsEnabled: true,
    nextsmsUsername: 'own-fixture-key',
    nextsmsPassword: 'own-fixture-secret',
    nextsmsSenderId: 'GoldenEvnts',
  });
  let now = Date.now();
  const health = createHealthMonitor(f.db, f.config, { clock: () => now });
  t.after(() => health.stop());
  const otpStatus = async () => (await health.collect()).components.find((c) => c.id === 'otp');
  assert.equal((await otpStatus()).status, 'unknown');
  assert.equal(f.messages.length, 0);
  await issueOtp(f.db, f.config, f.context);
  now += 20000;
  const accepted = await otpStatus();
  assert.equal(accepted.status, 'operational');
  assert.match(accepted.detail, /handset delivery is not monitored/);
  assert.equal(f.messages.length, 1);
  f.config.smsGateway = {
    send: async () => {
      throw new Error('unconfirmed');
    },
  };
  await assert.rejects(issueOtp(f.db, f.config, { ...f.context, phone: '0712345678' }), {
    status: 502,
  });
  now += 20000;
  const result = await health.collect();
  assert.equal(result.components.find((c) => c.id === 'otp').status, 'degraded');
  const serialized = JSON.stringify(result);
  for (const secret of ['own-fixture-key', 'own-fixture-secret', '+255748281701', f.lastCode()])
    assert.equal(serialized.includes(secret), false);
});

test('authenticated phone API protects CSRF, ownership and scanner boundaries; status and admin records redact secrets', async (t) => {
  const f = fixture(t),
    session = randomUUID();
  f.db
    .prepare('INSERT INTO sessions VALUES (?,?,?)')
    .run(tokenHash(session), f.user.id, Date.now() + 60000);
  const health = createHealthMonitor(f.db, f.config);
  t.after(() => health.stop());
  const server = createApp(f.db, f.config, health).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const req = async (route, body, cookie = session, validOrigin = true) => {
    const response = await fetch(`${origin}/api${route}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `ge_session=${cookie}`,
        Origin: validOrigin ? origin : 'https://evil.example',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await req('/settings/phone', undefined, '')).status, 401);
  assert.equal((await req('/settings/phone/code', {}, session, false)).status, 403);
  const c = await req('/settings/phone/code', {
    phone: '0748281701',
    password: 'OtpTestPassword123!',
  });
  assert.equal(c.status, 202);
  assert.equal(JSON.stringify(c.data).includes(f.lastCode()), false);
  assert.equal(
    (
      await req(`/settings/phone/${c.data.challenge_id}/resend`, {
        password: 'OtpTestPassword123!',
      })
    ).status,
    429,
  );
  const [a, b] = await Promise.all([
    req(`/settings/phone/${c.data.challenge_id}/verify`, { code: f.lastCode() }),
    req(`/settings/phone/${c.data.challenge_id}/verify`, { code: f.lastCode() }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((a.status === 200 ? a : b).data.verified, true);
  assert.equal((await req('/admin/otp')).status, 403);
  f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(f.user.id);
  const activity = await req('/admin/otp');
  assert.equal(activity.status, 200);
  assert.equal(activity.data.recent[0].phone, '+255 *** *** 1701');
  for (const field of ['code_hash', 'binding_hash', 'requester_ip_hash', 'password'])
    assert.equal(JSON.stringify(activity.data).includes(field), false);
  assert.equal(JSON.stringify(activity.data).includes(f.lastCode()), false);
  f.db.prepare("UPDATE users SET role='scanner' WHERE id=?").run(f.user.id);
  assert.equal((await req('/settings/phone')).status, 403);
  const status = await req('/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.components.find((c) => c.id === 'otp').status, 'not_configured');
});
