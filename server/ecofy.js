import { createHmac, timingSafeEqual } from 'node:crypto';
import { completeOrder, HttpError } from './domain.js';

const statuses = new Set(['created', 'pending', 'processing', 'succeeded', 'failed', 'cancelled']);

export async function ecofyRequest(config, pathname, options = {}) {
  const response = await fetch(`${config.ecofyBaseUrl}${pathname}`, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${config.ecofyApiKey}`,
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error('Ecofy returned an unreadable response.');
    error.code = 'invalid_response';
    error.httpStatus = response.status;
    error.definitive = false;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('Ecofy request could not be completed.');
    error.code = typeof data?.error?.code === 'string' ? data.error.code : 'unknown';
    error.httpStatus = response.status;
    // Only documented pre-creation validation/access errors prove no charge was created.
    error.definitive =
      [400, 401, 403, 422].includes(response.status) &&
      [
        'invalid_request_body',
        'missing_idempotency_key',
        'missing_api_key',
        'invalid_api_key',
        'revoked_api_key',
        'merchant_not_active',
        'kyc_incomplete',
        'invalid_amount',
        'unsupported_currency',
        'unsupported_method',
        'missing_customer_phone',
        'invalid_webhook_url',
      ].includes(data?.error?.code);
    throw error;
  }
  return data;
}
const request = ecofyRequest;

function validatePayment(payment, order, expectedId) {
  if (
    !payment ||
    typeof payment.id !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(payment.id) ||
    payment.reference !== order.reference ||
    payment.currency !== order.currency ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount !== order.amount ||
    payment.method !== 'mobile_money' ||
    !statuses.has(payment.status)
  )
    throw new Error('Ecofy payment verification mismatch.');
  if (
    (expectedId && payment.id !== expectedId) ||
    (order.provider_id && payment.id !== order.provider_id)
  )
    throw new Error('Ecofy payment ID mismatch.');
}

function storePayment(db, order, payment) {
  const expiry = Date.parse(payment.expires_at);
  if (!Number.isFinite(expiry)) throw new Error('Ecofy payment deadline is missing.');
  db.prepare('UPDATE orders SET provider_id=?,expires_at=? WHERE id=?').run(
    payment.id,
    expiry,
    order.id,
  );
}

export async function initiateEcofy(db, order, config) {
  // Lease prevents checkout and the background worker sending concurrent retries.
  const lease = db
    .prepare(
      'UPDATE ecofy_jobs SET next_attempt=?,attempts=attempts+1 WHERE order_id=? AND next_attempt<=?',
    )
    .run(Date.now() + 30000, order.id, Date.now());
  if (!lease.changes) return;
  try {
    const payment = await request(config, '/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': `goldenevents-${order.id}` },
      body: JSON.stringify({
        amount: order.amount,
        currency: order.currency,
        method: 'mobile_money',
        reference: order.reference,
        customer: { phone: order.phone.replace(/^\+/, '') },
        ...(config.publicOrigin.startsWith('https://')
          ? { callback_url: `${config.publicOrigin}/api/webhooks/ecofy` }
          : {}),
      }),
    });
    const current = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    validatePayment(payment, current);
    storePayment(db, current, payment);
    db.prepare('UPDATE ecofy_jobs SET error=NULL,next_attempt=? WHERE order_id=?').run(
      Date.now(),
      order.id,
    );
    // Even a replayed successful POST needs an authoritative GET before fulfilment.
  } catch (error) {
    if (error.definitive) {
      db.prepare(
        "UPDATE orders SET status='failed' WHERE id=? AND status='pending' AND provider_id IS NULL",
      ).run(order.id);
      db.prepare('DELETE FROM ecofy_jobs WHERE order_id=?').run(order.id);
      throw new HttpError(
        502,
        'The payment provider could not accept this request. No ticket was issued.',
      );
    }
    db.prepare('UPDATE ecofy_jobs SET error=?,next_attempt=? WHERE order_id=?').run(
      'Payment request not yet confirmed.',
      Date.now() + 5000,
      order.id,
    );
    throw new HttpError(
      502,
      'Your payment request is being checked. Keep this booking open; do not pay again yet.',
    );
  }
}

async function findPayment(config, reference) {
  // After a reservation expires, do not POST: a never-received request could charge too late.
  let before;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
    const list = await request(config, `/v1/payments?${params}`);
    if (!Array.isArray(list.data)) throw new Error('Invalid Ecofy payment list.');
    const match = list.data.find((payment) => payment.reference === reference);
    if (match) return match.id;
    if (!list.has_more) return null;
    if (typeof list.next_before !== 'string' || list.next_before === before)
      throw new Error('Invalid Ecofy pagination cursor.');
    before = list.next_before;
  }
  throw new Error('Ecofy reconciliation requires another review.');
}

export async function verifyEcofy(db, order, config, paymentId) {
  const id = paymentId || order.provider_id || (await findPayment(config, order.reference));
  if (!id || typeof id !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(id))
    throw new Error('Ecofy payment is not yet located.');
  const payment = await request(config, `/v1/payments/${encodeURIComponent(id)}`);
  const current = db
    .prepare('SELECT * FROM orders WHERE id=? AND provider=?')
    .get(order.id, 'ecofy');
  if (!current) throw new Error('Ecofy order not found.');
  validatePayment(payment, current, id);
  storePayment(db, current, payment);
  if (!['paid', 'review', 'refunded'].includes(current.status))
    db.prepare('UPDATE orders SET provider_status=? WHERE id=?').run(payment.status, current.id);
  if (payment.status === 'succeeded') {
    if (
      Number.isSafeInteger(payment.fee) &&
      payment.fee >= 0 &&
      Number.isSafeInteger(payment.net) &&
      payment.net >= 0 &&
      payment.fee + payment.net === current.amount
    ) {
      const mature = db
        .prepare('SELECT * FROM ecofy_maturations WHERE payment_id=? AND net=?')
        .get(payment.id, payment.net);
      const existing = db
        .prepare('SELECT * FROM ecofy_collection_finance WHERE order_id=?')
        .get(current.id);
      if (existing && (existing.fee !== payment.fee || existing.net !== payment.net))
        throw new Error('Ecofy collection fee changed after verification.');
      db.prepare(
        `INSERT INTO ecofy_collection_finance (order_id,fee,net,matured_at,verified_at) VALUES (?,?,?,?,?)
        ON CONFLICT(order_id) DO UPDATE SET verified_at=excluded.verified_at,
        matured_at=COALESCE(ecofy_collection_finance.matured_at,excluded.matured_at)`,
      ).run(current.id, payment.fee, payment.net, mature?.observed_at || null, Date.now());
    }
    return completeOrder(db, current.id, config);
  }
  if (['failed', 'cancelled'].includes(payment.status)) {
    db.prepare("UPDATE orders SET status=? WHERE id=? AND status IN ('pending','expired')").run(
      payment.status === 'cancelled' && payment.failure_code === 'expired' ? 'expired' : 'failed',
      current.id,
    );
    db.prepare('DELETE FROM ecofy_jobs WHERE order_id=?').run(current.id);
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(current.id);
}

export function verifyEcofySignature(header, body, secret, now = Date.now()) {
  if (!secret || typeof header !== 'string' || !Buffer.isBuffer(body)) return false;
  const fields = header.split(',').map((field) => field.trim());
  const timestamps = fields.filter((field) => field.startsWith('t='));
  const signatures = fields.filter((field) => field.startsWith('v1='));
  if (timestamps.length !== 1 || signatures.length !== 1) return false;
  const timestamp = timestamps[0].slice(2),
    signature = signatures[0].slice(3);
  if (
    !/^\d{1,12}$/.test(timestamp) ||
    !/^[a-fA-F0-9]{64}$/.test(signature) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export async function processEcofyPayments(db, config) {
  const jobs = db
    .prepare(
      `SELECT o.* FROM ecofy_jobs j JOIN orders o ON o.id=j.order_id
     WHERE j.next_attempt<=? AND o.created_at>? ORDER BY j.next_attempt LIMIT 20`,
    )
    .all(Date.now(), new Date(Date.now() - 86400000).toISOString());
  for (const order of jobs) {
    if (['paid', 'failed', 'review', 'refunded'].includes(order.status)) {
      db.prepare('DELETE FROM ecofy_jobs WHERE order_id=?').run(order.id);
      continue;
    }
    try {
      if (!order.provider_id && order.status === 'pending' && order.expires_at > Date.now())
        await initiateEcofy(db, order, config);
      else {
        db.prepare('UPDATE ecofy_jobs SET next_attempt=? WHERE order_id=?').run(
          Date.now() + (order.status === 'expired' ? 60000 : 5000),
          order.id,
        );
        await verifyEcofy(db, order, config);
      }
    } catch {
      db.prepare('UPDATE ecofy_jobs SET error=?,next_attempt=? WHERE order_id=?').run(
        'Payment verification will be retried.',
        Date.now() + 10000,
        order.id,
      );
    }
  }
}
