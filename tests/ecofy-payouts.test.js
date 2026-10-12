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
import { saveEvent, reserveOrder, completeOrder } from '../server/domain.js';
import { createApp } from '../server/app.js';
import {
  requestPayoutQuote,
  requestPayoutCode,
  submitPayout,
  confirmPayout,
  processPayoutJobs,
  syncEcofyFinance,
  organizerFinance,
  organizerFinancePreview,
  reviewPayout,
} from '../server/finance.js';

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-payouts-')),
    db = openDatabase(dir);
  const config = makeConfig({
    production: false,
    seedDemo: false,
    paymentDriver: 'ecofy',
    payoutDriver: 'ecofy',
    ecofyApiKey: 'sk_test_fixture',
    ecofyWebhookSecret: 'whsec_fixture',
    deliveryDriver: 'live',
    platformFeeBps: 500,
    payoutMinimum: 1000,
    dataDir: dir,
  });
  const env = Object.fromEntries(
    ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'tickets@example.test',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  });
  const user = {
    id: randomUUID(),
    name: 'Organizer',
    email: 'owner@example.test',
    password: hashPassword('TestPassword123!'),
    role: 'organizer',
    phone: '',
    organization: '',
    created_at: new Date().toISOString(),
  };
  const other = { ...user, id: randomUUID(), email: 'other@example.test' };
  for (const u of [user, other])
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(u));
  const event = saveEvent(db, user.id, {
    name: 'Payout Event',
    description: 'An event for safe payout integration tests.',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Warehouse 7',
    city: 'Dar es Salaam',
    category: 'Music',
    image: '',
    status: 'published',
    tickets: [{ name: 'Regular', price: 20000, capacity: 10 }],
  });
  const type = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').get(event.id);
  const sale = completeOrder(
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
  db.prepare('UPDATE orders SET provider_id=? WHERE id=?').run('pay_collection1', sale.id);
  const state = {
    matured: true,
    wallet: 100000,
    status: 'paid',
    timeout: false,
    hidePayout: false,
    reject: null,
    quotePatch: {},
    payoutPatch: {},
    collectionPatch: {},
    payments: new Map(),
    quotes: new Map(),
    calls: [],
    sentCode: '',
  };
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message) => {
      state.sentCode = message.text.match(/code is (\d{6})/)[1];
      return { accepted: [message.to] };
    },
    close() {},
  }));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, config.ecofyBaseUrl);
    assert.equal(options.headers.Authorization, 'Bearer sk_test_fixture');
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({
      path: u.pathname,
      search: u.search,
      method: options.method || 'GET',
      body,
      key: options.headers['Idempotency-Key'],
    });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.pathname === '/v1/balance')
      return reply({ currency: 'TZS', available: state.wallet, pending: 0, reserved: 0 });
    if (u.pathname === '/v1/payments/pay_collection1')
      return reply({
        id: 'pay_collection1',
        reference: sale.reference,
        status: 'succeeded',
        amount: sale.amount,
        currency: 'TZS',
        fee: 400,
        net: 19600,
        method: 'mobile_money',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        ...state.collectionPatch,
      });
    if (u.pathname === '/v1/transactions')
      return reply({
        data: state.matured
          ? [{ id: 'txn_1', type: 'matured', amount: 19600, reference: 'pay_collection1' }]
          : [],
        has_more: false,
      });
    if (u.pathname === '/v1/payouts/quote') {
      assert.deepEqual(Object.keys(body).sort(), [
        'account',
        'account_name',
        'amount',
        'channel',
        'skip_account_check',
        'type',
      ]);
      assert.equal(body.skip_account_check, true);
      const q = {
        id: `pq_${options.headers['Idempotency-Key'].replaceAll('-', '')}`,
        amount: body.amount,
        fee: 100,
        total: body.amount + 100,
        account_last4: body.account.slice(-4),
        account_name: 'VERIFIED RECIPIENT',
        account_name_source: 'merchant',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        ...state.quotePatch,
      };
      state.quotes.set(q.id, q);
      return reply(q, 201);
    }
    if (u.pathname === '/v1/payouts' && options.method === 'POST') {
      if (state.reject)
        return reply(
          { error: { code: state.reject } },
          state.reject === 'withdrawals_unavailable' ? 503 : 422,
        );
      const key = options.headers['Idempotency-Key'],
        q = state.quotes.get(body.quote);
      assert.ok(q);
      assert.deepEqual(Object.keys(body).sort(), ['quote', 'reference']);
      if (!state.payments.has(key))
        state.payments.set(key, {
          id: `po_${state.payments.size + 1}`,
          reference: body.reference,
          status: state.status,
          amount: q.amount,
          fee: q.fee,
          total: q.total,
        });
      if (state.timeout) {
        state.timeout = false;
        throw new Error('Network response lost after transfer');
      }
      return reply({ ...state.payments.get(key), ...state.payoutPatch }, 201);
    }
    if (u.pathname === '/v1/payouts')
      return reply({ data: state.hidePayout ? [] : [...state.payments.values()], has_more: false });
    if (u.pathname.startsWith('/v1/payouts/po_')) {
      const p = [...state.payments.values()].find((p) => p.id === u.pathname.split('/').pop());
      assert.ok(p);
      return reply({ ...p, status: state.status, ...state.payoutPatch });
    }
    throw new Error(`Unexpected API request ${u.pathname}`);
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const quoteInput = (patch = {}) => ({
    account_name: 'VERIFIED RECIPIENT',
    amount: 10000,
    destination_type: 'mobile_money',
    channel: 'MPESA',
    account: '0712345678',
    password: 'TestPassword123!',
    idempotency_key: randomUUID(),
    ...patch,
  });
  const quote = (patch = {}) => requestPayoutQuote(db, config, user, quoteInput(patch));
  const code = (q, patch = {}) =>
    requestPayoutCode(db, config, user, {
      quote_id: q.id,
      account_name_confirmed: true,
      password: 'TestPassword123!',
      idempotency_key: randomUUID(),
      ...patch,
    });
  const submit = (c) => submitPayout(db, config, user, c.challenge_id, { code: state.sentCode });
  const retry = async () => {
    db.prepare('UPDATE payout_jobs SET next_attempt=0').run();
    await processPayoutJobs(db, config);
  };
  return {
    dir,
    db,
    config,
    user,
    other,
    event,
    sale,
    state,
    quoteInput,
    quote,
    code,
    submit,
    retry,
    networkFetch: oldFetch,
  };
}
test('verified collections and maturation belong to their organizer, not the shared merchant wallet', async (t) => {
  const f = fixture(t);
  f.state.matured = false;
  await syncEcofyFinance(f.db, f.config);
  let balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.gross, 20000);
  assert.equal(balance.platform_fee, 1000);
  assert.equal(balance.provider_fees, 400);
  assert.equal(balance.net_estimate, 18600);
  assert.equal(balance.available, 0);
  assert.equal(balance.held, 18600);
  assert.equal(organizerFinance(f.db, f.config, f.other).available, 0);
  f.state.matured = true;
  f.db.prepare('UPDATE ecofy_wallet SET checked_at=0').run();
  await syncEcofyFinance(f.db, f.config);
  assert.equal(organizerFinance(f.db, f.config, f.user).available, 18600);
  await assert.rejects(f.quote({ amount: 19000 }), /available earnings/);
});
test('a quote verifies destination and fee, requires recognized-name consent, and binds OTP to exact server-held details', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const q = await f.quote();
  assert.equal(q.account_name, 'VERIFIED RECIPIENT');
  assert.equal(q.account_name_source, 'merchant');
  assert.equal(q.fee, 100);
  assert.equal(q.total, 10100);
  await assert.rejects(f.code(q, { account_name_confirmed: false }), /Confirm the recipient/);
  await assert.rejects(requestPayoutCode(f.db, f.config, f.other, { quote_id: q.id }), /not found/);
  const c = await f.code(q, {
    amount: 1,
    phone: '0744444444',
    recipient_name: 'Fake owner',
    network: 'CRDB',
  });
  assert.equal(c.amount, 10000);
  assert.equal(c.phone, '255712345678');
  assert.equal(c.recipient_name, 'VERIFIED RECIPIENT');
  assert.equal(c.demo_code, undefined);
  const p = await f.submit(c);
  assert.equal(p.status, 'paid');
  assert.equal(p.payout_fee, 100);
  assert.equal(p.driver, 'ecofy');
  assert.equal(organizerFinance(f.db, f.config, f.user).available, 8500);
  const replay = await f.submit(c);
  assert.equal(replay.id, p.id);
  assert.equal(f.state.payments.size, 1);
  await assert.rejects(f.code(q), /already been used/);
  assert.ok(f.state.calls.some((r) => r.path === '/v1/payouts/po_1' && r.method === 'GET'));
});

test('a combined fee allowance holds only its unused portion and funds a full-balance withdrawal without double deduction', async (t) => {
  const f = fixture(t);
  f.config.providerFeeAllowanceBps = 250;
  f.state.matured = false;
  await syncEcofyFinance(f.db, f.config);
  let balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.provider_fee_reserve, 0);
  assert.equal(balance.available, 0);
  f.state.matured = true;
  f.db.prepare('UPDATE ecofy_wallet SET checked_at=0').run();
  await syncEcofyFinance(f.db, f.config);
  balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.provider_fees, 400);
  assert.equal(balance.provider_fee_reserve, 100);
  assert.equal(balance.withdrawal_capacity, 18600);
  assert.equal(balance.available, 18500);
  const quote = await f.quote({ amount: 18500 });
  const challenge = await f.code(quote);
  const payout = await f.submit(challenge);
  assert.equal(payout.status, 'paid');
  balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.paid_out, 18600);
  assert.equal(balance.provider_fee_reserve, 0);
  assert.equal(balance.available, 0);
  assert.equal(balance.shortfall, 0);
});

test('fees above the allowance cannot exceed actual capacity and never cause an unsupported transfer', async (t) => {
  const f = fixture(t);
  f.config.providerFeeAllowanceBps = 250;
  await syncEcofyFinance(f.db, f.config);
  f.state.quotePatch = { fee: 200, total: 18700 };
  await assert.rejects(f.quote({ amount: 18500 }), (error) => {
    assert.match(error.message, /withdrawal fee exceeds/);
    assert.deepEqual(error.payoutAdjustment, {
      quoted_fee: 200,
      allowance_applied: 100,
      suggested_amount: 18400,
      minimum: 1000,
    });
    return true;
  });
  assert.equal(
    f.state.calls.filter((r) => r.path === '/v1/payouts' && r.method === 'POST').length,
    0,
  );
  f.state.quotePatch = { fee: 200, total: 18600 };
  const quote = await f.quote({ amount: 18400 });
  const payout = await f.submit(await f.code(quote));
  assert.equal(payout.status, 'paid');
  assert.equal(organizerFinance(f.db, f.config, f.user).available, 0);
});

test('partial withdrawal fees consume the allowance once and unused reserves remain available for subsequent fees', async (t) => {
  const f = fixture(t);
  f.config.providerFeeAllowanceBps = 250;
  await syncEcofyFinance(f.db, f.config);
  f.state.quotePatch = { fee: 50, total: 10050 };
  const quote = await f.quote({ amount: 10000 });
  await f.submit(await f.code(quote));
  const balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.withdrawal_capacity, 8550);
  assert.equal(balance.provider_fee_reserve, 50);
  assert.equal(balance.available, 8500);
});

test('pending fees consume the allowance, confirmed failures restore it, and cancelled sales cannot create a reserve', async (t) => {
  const f = fixture(t);
  f.config.providerFeeAllowanceBps = 250;
  await syncEcofyFinance(f.db, f.config);
  f.state.status = 'processing';
  const quote = await f.quote({ amount: 10000 });
  const payout = await f.submit(await f.code(quote));
  assert.equal(payout.status, 'processing');
  let balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.reserved, 10100);
  assert.equal(balance.provider_fee_reserve, 0);
  assert.equal(balance.available, 8500);
  f.state.status = 'failed';
  await f.retry();
  balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.reserved, 0);
  assert.equal(balance.provider_fee_reserve, 100);
  assert.equal(balance.available, 18500);
  f.db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(f.event.id);
  balance = organizerFinance(f.db, f.config, f.user);
  assert.equal(balance.provider_fee_reserve, 0);
  assert.equal(balance.available, 0);
});
test('bank quoting preserves leading zeros, uses documented channels, and rejects invalid type/channel pairs', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const q = await f.quote({ destination_type: 'bank', channel: 'CRDB', account: '0012345678' });
  assert.equal(q.account_last4, '5678');
  assert.equal(q.channel, 'CRDB');
  const call = f.state.calls.find((r) => r.path === '/v1/payouts/quote');
  assert.equal(call.body.account, '0012345678');
  await assert.rejects(
    f.quote({ destination_type: 'bank', channel: 'MPESA', account: '0012345678' }),
    /matching bank/,
  );
});

test('lookup bypass preserves the entered name, tracks source, rejects changed names and implements revised quote errors', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const q = await f.quote();
  assert.equal(q.account_name_source, 'merchant');
  const call = f.state.calls.find((r) => r.path === '/v1/payouts/quote');
  assert.equal(call.body.skip_account_check, true);
  assert.equal(call.body.account_name, 'VERIFIED RECIPIENT');
  f.state.quotePatch = { account_name: 'DIFFERENT NAME', account_name_source: 'merchant' };
  await assert.rejects(f.quote(), /account check could not be confirmed/);
  f.state.quotePatch = { account_name_source: 'unknown' };
  await assert.rejects(f.quote(), /account check could not be confirmed/);
  const providerFetch = globalThis.fetch;
  let code;
  globalThis.fetch = async (url, options) =>
    new URL(url).pathname === '/v1/payouts/quote'
      ? new Response(JSON.stringify({ error: { code } }), { status: 422 })
      : providerFetch(url, options);
  for (const [errorCode, status] of [
    ['account_not_found', 400],
    ['lookup_unavailable', 503],
    ['account_name_required', 422],
  ]) {
    code = errorCode;
    await assert.rejects(f.quote(), (error) => error.status === status);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
});

test('net withdrawal previews converge on actual fees, add up to sales, coalesce and never create financial authorization', async (t) => {
  const f = fixture(t);
  f.config.providerFeeAllowanceBps = 250;
  await syncEcofyFinance(f.db, f.config);
  await f.quote();
  const providerFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await providerFetch(url, options);
    if (new URL(url).pathname !== '/v1/payouts/quote') return response;
    const data = await response.json();
    data.fee = Math.round(data.amount * 0.025);
    data.total = data.amount + data.fee;
    return new Response(JSON.stringify(data), { status: 201 });
  };
  const start = f.state.calls.length;
  const [a, b] = await Promise.all([
    organizerFinancePreview(f.db, f.config, f.user),
    organizerFinancePreview(f.db, f.config, f.user),
  ]);
  assert.deepEqual(a.withdrawal_preview, b.withdrawal_preview);
  const p = a.withdrawal_preview;
  assert.equal(p.status, 'quoted');
  assert.equal(p.amount, 18146);
  assert.equal(p.fee, 454);
  assert.equal(p.remaining, 0);
  assert.equal(a.platform_fee + p.combined_fees + p.amount + p.remaining, a.gross);
  assert.equal(p.id, undefined);
  assert.equal(p.external_id, undefined);
  assert.ok(
    f.state.calls.slice(start).filter((call) => call.path === '/v1/payouts/quote').length <= 4,
  );
  const calls = f.state.calls.length;
  await organizerFinancePreview(f.db, f.config, f.user);
  assert.equal(f.state.calls.length, calls);
  const other = await organizerFinancePreview(f.db, f.config, f.other);
  assert.notEqual(other.withdrawal_preview?.status, 'quoted');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_quotes').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_challenges').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
  f.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(f.sale.id);
  const changed = await organizerFinancePreview(f.db, f.config, f.user);
  assert.equal(changed.withdrawal_preview.status, 'below_minimum');
  assert.equal(f.state.calls.length, calls);
});

test('a provider outage cannot turn an unconfirmed fee estimate into a quoted net balance', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  await f.quote();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'withdrawals_unavailable' } }), { status: 503 });
  const result = await organizerFinancePreview(f.db, f.config, f.user);
  assert.equal(result.withdrawal_preview.status, 'unavailable');
  assert.equal(result.available, 18600);
  assert.equal(result.reserved, 0);
  assert.equal(result.withdrawal_preview.amount, undefined);
});

test('a net withdrawal preview is unavailable when provider funds cannot cover it', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  await f.quote();
  f.state.wallet = 1000;
  const start = f.state.calls.length;
  const result = await organizerFinancePreview(f.db, f.config, f.user);
  assert.equal(result.withdrawal_preview.status, 'unavailable');
  assert.equal(result.withdrawal_preview.amount, undefined);
  assert.deepEqual(
    f.state.calls.slice(start).map((call) => call.path),
    ['/v1/balance'],
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
});

test('a balance change during a preview cannot publish a stale recipient amount', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  await f.quote();
  const providerFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await providerFetch(url, options);
    if (new URL(url).pathname === '/v1/payouts/quote')
      f.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(f.sale.id);
    return response;
  };
  const result = await organizerFinancePreview(f.db, f.config, f.user);
  assert.equal(result.gross, 0);
  assert.equal(result.withdrawal_preview.status, 'unavailable');
  assert.equal(result.withdrawal_preview.amount, undefined);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
});

test('withdrawals-unavailable quote exposes a clear provider block without an OTP, reservation or transfer', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const providerFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) =>
    new URL(url).pathname === '/v1/payouts/quote'
      ? new Response(JSON.stringify({ error: { code: 'withdrawals_unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      : providerFetch(url, options);
  await assert.rejects(f.quote(), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /Ecofy is currently refusing automatic withdrawals/);
    return true;
  });
  assert.equal(f.db.prepare('SELECT status FROM payout_quotes').get().status, 'failed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_challenges').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 0);
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
  assert.equal(f.state.sentCode, '');
});

test('unreadable quote responses preserve the original key for recovery and never reserve funds', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const providerFetch = globalThis.fetch;
  const keys = [];
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname !== '/v1/payouts/quote') return providerFetch(url, options);
    keys.push(options.headers['Idempotency-Key']);
    return new Response('<!DOCTYPE html><html>upstream failed</html>', { status: 502 });
  };
  const input = f.quoteInput();
  for (let i = 0; i < 2; i++)
    await assert.rejects(requestPayoutQuote(f.db, f.config, f.user, input), /No money was sent/);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_quotes').get().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM payout_quotes').get().status, 'quoting');
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
});
test('quote retries are durable and idempotent; changed details and expired quotes cannot send money', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const input = f.quoteInput();
  const q = await requestPayoutQuote(f.db, f.config, f.user, input);
  assert.equal((await requestPayoutQuote(f.db, f.config, f.user, input)).id, q.id);
  assert.equal(f.state.calls.filter((r) => r.path === '/v1/payouts/quote').length, 1);
  await assert.rejects(
    requestPayoutQuote(f.db, f.config, f.user, { ...input, amount: 11000 }),
    /different details/,
  );
  f.db.prepare('UPDATE payout_quotes SET expires_at=0 WHERE id=?').run(q.id);
  await assert.rejects(f.code(q), /expired/);
  assert.equal(f.state.payments.size, 0);
});
test('malformed quotes and unverifiable collection fees never create spendable money', async (t) => {
  const f = fixture(t);
  f.state.collectionPatch = { net: 20000 };
  await syncEcofyFinance(f.db, f.config);
  assert.equal(organizerFinance(f.db, f.config, f.user).available, 0);
  f.state.collectionPatch = {};
  f.db.prepare('UPDATE ecofy_wallet SET checked_at=0').run();
  await syncEcofyFinance(f.db, f.config);
  for (const patch of [
    { fee: '100' },
    { total: 9999 },
    { account_last4: '1111' },
    { account_name: '' },
    { id: 'po_wrong' },
  ]) {
    f.state.quotePatch = patch;
    await assert.rejects(f.quote(), /could not be confirmed/);
  }
  assert.equal(f.state.payments.size, 0);
});
test('fees and merchant capacity are checked separately from organizer earnings', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  await assert.rejects(f.quote({ amount: 18600 }), /plus withdrawal fee/);
  f.state.wallet = 100;
  await assert.rejects(f.quote(), /Provider funds/);
  assert.equal(f.state.payments.size, 0);
});
test('lost transfer response recovers by reference with no second transfer and no premature release', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const q = await f.quote(),
    c = await f.code(q);
  f.state.timeout = true;
  const p = await f.submit(c);
  assert.equal(p.status, 'processing');
  assert.equal(p.provider_id, null);
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 10100);
  const admin = { ...f.user, role: 'admin' };
  assert.throws(
    () =>
      reviewPayout(f.db, f.config, admin, p.id, {
        action: 'rejected',
        note: 'Never manually reject',
        confirmed_not_sent: true,
      }),
    /reconciled automatically/,
  );
  const reopened = openDatabase(f.dir);
  reopened.prepare('UPDATE payout_jobs SET next_attempt=0').run();
  await processPayoutJobs(reopened, f.config);
  reopened.close();
  await f.retry();
  assert.equal(
    f.db.prepare('SELECT status FROM payout_requests WHERE id=?').get(p.id).status,
    'paid',
  );
  assert.equal(
    f.state.calls.filter((r) => r.path === '/v1/payouts' && r.method === 'POST').length,
    1,
  );
});
test('an unresolved retry uses exactly the same quote, reference, body and key, even after quote expiry', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const q = await f.quote(),
    c = await f.code(q);
  f.state.timeout = true;
  f.state.hidePayout = true;
  const p = await f.submit(c);
  f.db.prepare('UPDATE payout_quotes SET expires_at=0 WHERE id=?').run(q.id);
  await f.retry();
  const posts = f.state.calls.filter((r) => r.path === '/v1/payouts' && r.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(posts[0].key, posts[1].key);
  assert.equal(f.state.payments.size, 1);
  assert.equal(
    f.db.prepare('SELECT status FROM payout_requests WHERE id=?').get(p.id).status,
    'paid',
  );
});
test('processing transfers stay reserved; only a verified final failure releases funds', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  f.state.status = 'processing';
  const c = await f.code(await f.quote()),
    p = await f.submit(c);
  assert.equal(p.status, 'processing');
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 10100);
  f.state.status = 'failed';
  await f.retry();
  assert.equal(
    f.db.prepare('SELECT status FROM payout_requests WHERE id=?').get(p.id).status,
    'rejected',
  );
  assert.equal(organizerFinance(f.db, f.config, f.user).available, 18600);
});
test('mismatched paid receipts cannot mark a payout paid or release its reservation', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const c = await f.code(await f.quote());
  f.state.payoutPatch = { amount: 1 };
  const p = await f.submit(c);
  assert.equal(p.status, 'processing');
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 10100);
  f.state.payoutPatch = {};
  await f.retry();
  assert.equal(
    f.db.prepare('SELECT status FROM payout_requests WHERE id=?').get(p.id).status,
    'paid',
  );
});
test('definite initial rejection releases funds, but a rejection after a lost response does not', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  f.state.reject = 'withdrawals_unavailable';
  const c = await f.code(await f.quote());
  assert.equal((await f.submit(c)).status, 'rejected');
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 0);
  f.db.prepare('UPDATE payout_challenges SET created_at=created_at-60001').run();
  f.state.reject = null;
  f.state.timeout = true;
  f.state.hidePayout = true;
  const next = await f.code(await f.quote()),
    p = await f.submit(next);
  f.state.reject = 'insufficient_balance';
  await f.retry();
  assert.equal(
    f.db.prepare('SELECT status FROM payout_requests WHERE id=?').get(p.id).status,
    'processing',
  );
  assert.equal(organizerFinance(f.db, f.config, f.user).reserved, 10100);
});
test('automatic configuration cannot enable simulated money in production or mix collection providers', () => {
  for (const invalid of [-1, 10001, 2.5, NaN])
    assert.throws(
      () => makeConfig({ providerFeeAllowanceBps: invalid }),
      /PROVIDER_FEE_ALLOWANCE_BPS/,
    );
  assert.throws(() => makeConfig({ production: true, payoutDriver: 'demo' }), /Demo payouts/);
  assert.throws(
    () => makeConfig({ paymentDriver: 'disabled', payoutDriver: 'ecofy' }),
    /require Ecofy/,
  );
});

test('simultaneous confirmations reserve once and submit only one logical payout', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const c = await f.code(await f.quote());
  const results = await Promise.all([f.submit(c), f.submit(c)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(f.state.payments.size, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payout_requests').get().n, 1);
  assert.equal(organizerFinance(f.db, f.config, f.user).paid_out, 10100);
});

test('payout API protects tenant boundaries, CSRF and OTP secrecy and rejects double manual transfers', async (t) => {
  const f = fixture(t);
  await syncEcofyFinance(f.db, f.config);
  const server = createApp(f.db, f.config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, cookie = '', customOrigin = origin) => {
    const response = await f.networkFetch(`${origin}/api${url}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Origin: customOrigin, Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const owner = (
    await request('/auth/login', { email: f.user.email, password: 'TestPassword123!' })
  ).cookie;
  const other = (
    await request('/auth/login', { email: f.other.email, password: 'TestPassword123!' })
  ).cookie;
  assert.equal((await request('/organizer/payouts/quote', f.quoteInput())).status, 401);
  assert.equal(
    (await request('/organizer/payouts/destination/code', { quote_id: 'unknown' })).status,
    401,
  );
  assert.equal(
    (
      await request('/organizer/payouts/destination/verify', {
        quote_id: 'unknown',
        code: '000000',
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('/organizer/payouts/quote', f.quoteInput(), owner, 'https://evil.example'))
      .status,
    403,
  );
  f.config.providerFeeAllowanceBps = 250;
  f.state.quotePatch = { fee: 200, total: 18700 };
  const adjustment = await request(
    '/organizer/payouts/quote',
    f.quoteInput({ amount: 18500 }),
    owner,
  );
  assert.equal(adjustment.status, 409);
  assert.deepEqual(adjustment.data.payout_adjustment, {
    quoted_fee: 200,
    allowance_applied: 100,
    suggested_amount: 18400,
    minimum: 1000,
  });
  f.config.providerFeeAllowanceBps = 0;
  f.state.quotePatch = {};
  const q = await request('/organizer/payouts/quote', f.quoteInput(), owner);
  assert.equal(
    (
      await request(
        '/organizer/payouts/destination/code',
        { quote_id: q.data.quote.id, password: 'TestPassword123!' },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/organizer/payouts/destination/verify',
        { quote_id: q.data.quote.id, code: '000000' },
        owner,
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(q.status, 200);
  assert.equal(q.data.quote.external_id, undefined);
  const details = {
    quote_id: q.data.quote.id,
    account_name_confirmed: true,
    password: 'TestPassword123!',
    idempotency_key: randomUUID(),
  };
  assert.equal((await request('/organizer/payouts/code', details, other)).status, 404);
  const c = await request('/organizer/payouts/code', details, owner);
  assert.equal(c.status, 200);
  assert.equal(c.data.demo_code, undefined);
  assert.equal(
    (
      await request(
        `/organizer/payouts/${c.data.challenge_id}/confirm`,
        { code: f.state.sentCode },
        other,
      )
    ).status,
    404,
  );
  const confirmed = await request(
    `/organizer/payouts/${c.data.challenge_id}/confirm`,
    { code: f.state.sentCode },
    owner,
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.payout.status, 'paid');
  assert.equal((await request('/organizer/finance', undefined, owner)).data.available, 8500);
  assert.equal(f.state.payments.size, 1);
});
