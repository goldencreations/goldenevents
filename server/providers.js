import nodemailer from 'nodemailer';
import { sendMetaTickets, metaTemplateReady } from './whatsapp.js';
import { completeOrder, HttpError } from './domain.js';
import { initiateEcofy, verifyEcofy, processEcofyPayments } from './ecofy.js';

async function flw(path, options = {}) {
  const response = await fetch(`https://api.flutterwave.com/v3${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok || data.status !== 'success')
    throw new Error('Payment provider request could not be completed.');
  return data.data;
}

export async function initiatePayment(db, order, config) {
  if (config.paymentDriver === 'demo') return;
  if (config.paymentDriver === 'ecofy') return initiateEcofy(db, order, config);
  try {
    const data = await flw('/charges?type=mobile_money_tanzania', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: order.reference,
        amount: order.amount,
        currency: order.currency,
        email: order.email,
        phone_number: order.phone.replace('+', ''),
      }),
    });
    if (data.id)
      db.prepare('UPDATE orders SET provider_id=? WHERE id=?').run(String(data.id), order.id);
    // A successful initiation is not proof that the customer authorized the payment.
  } catch {
    // Keep ambiguous requests pending; reconciliation can find a charge by its reference.
    throw new HttpError(
      502,
      'The payment request is taking longer than expected. Your order is reserved; check its status before trying again.',
    );
  }
}

export async function verifyPayment(db, order, config, transactionId) {
  if (order.provider === 'ecofy') return verifyEcofy(db, order, config, transactionId);
  const data = await flw(
    transactionId
      ? `/transactions/${encodeURIComponent(transactionId)}/verify`
      : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(order.reference)}`,
  );
  if (
    data.tx_ref !== order.reference ||
    data.currency !== order.currency ||
    Number(data.amount) !== order.amount
  )
    throw new Error('Payment verification mismatch.');
  if (order.provider_id && String(data.id) !== order.provider_id)
    throw new Error('Payment transaction ID mismatch.');
  db.prepare('UPDATE orders SET provider_id=? WHERE id=?').run(String(data.id), order.id);
  if (data.status === 'successful') return completeOrder(db, order.id, config);
  if (data.status === 'failed')
    db.prepare(
      "UPDATE orders SET status='failed' WHERE id=? AND status IN ('pending','expired')",
    ).run(order.id);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
}

export async function sendTwilio(delivery) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = process.env;
  if (!sid || !token) throw new Error('Twilio credentials are missing.');
  const whatsapp = delivery.channel === 'whatsapp';
  const from = whatsapp ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error(`The ${delivery.channel} sender is not configured.`);
  const params = new URLSearchParams({
    From: whatsapp ? `whatsapp:${from}` : from,
    To: whatsapp ? `whatsapp:${delivery.recipient}` : delivery.recipient,
  });
  if (whatsapp) {
    if (!process.env.TWILIO_WHATSAPP_CONTENT_SID)
      throw new Error('An approved WhatsApp template is required.');
    params.set('ContentSid', process.env.TWILIO_WHATSAPP_CONTENT_SID);
    params.set('ContentVariables', JSON.stringify({ 1: delivery.body }));
  } else params.set('Body', delivery.body);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!response.ok) throw new Error('Messaging provider rejected the request.');
}

export async function processDeliveries(db, config) {
  const rows = db
    .prepare(
      "SELECT d.* FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE o.status='paid' AND d.status='queued' AND d.next_attempt<=? LIMIT 10",
    )
    .all(Date.now());
  for (const row of rows) {
    const meta = row.channel === 'whatsapp' && process.env.WHATSAPP_DRIVER === 'meta';
    if (config.deliveryDriver === 'outbox' && !meta) {
      db.prepare("UPDATE deliveries SET status='outbox',error=NULL WHERE id=?").run(row.id);
      continue;
    }
    try {
      if (meta) {
        if (!(await metaTemplateReady())) continue;
        if (!(await sendMetaTickets(db, row, config))) {
          db.prepare("UPDATE deliveries SET status='skipped',error=NULL WHERE id=?").run(row.id);
          continue;
        }
      } else if (row.channel === 'email') {
        if (!process.env.SMTP_HOST) throw new Error('Email delivery is not configured.');
        const smtp = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined,
        });
        await smtp.sendMail({
          from: process.env.SMTP_FROM,
          to: row.recipient,
          subject: 'Your Golden Events tickets',
          text: row.body,
        });
      } else await sendTwilio(row);
      db.prepare(
        "UPDATE deliveries SET status='sent',attempts=attempts+1,error=NULL WHERE id=?",
      ).run(row.id);
    } catch (error) {
      const attempts = row.attempts + 1;
      db.prepare('UPDATE deliveries SET status=?,attempts=?,error=?,next_attempt=? WHERE id=?').run(
        attempts >= 5 ? 'failed' : 'queued',
        attempts,
        error.message,
        Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
        row.id,
      );
    }
  }
}

export function startWorker(db, config) {
  config.workerHealth.startedAt = Date.now();
  let busy = false,
    lastReconcile = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      db.prepare("UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<?").run(
        Date.now(),
      );
      if (['flutterwave', 'ecofy'].includes(config.paymentDriver)) {
        for (const job of db
          .prepare(
            "SELECT * FROM webhook_jobs WHERE provider=? AND status='queued' AND next_attempt<=? LIMIT 10",
          )
          .all(config.paymentDriver, Date.now())) {
          try {
            const order = db
              .prepare('SELECT * FROM orders WHERE reference=? AND provider=?')
              .get(job.reference, job.provider);
            if (order) await verifyPayment(db, order, config, job.transaction_id);
            db.prepare("UPDATE webhook_jobs SET status='processed' WHERE id=?").run(job.id);
          } catch (error) {
            const attempts = job.attempts + 1;
            db.prepare(
              'UPDATE webhook_jobs SET status=?,attempts=?,error=?,next_attempt=? WHERE id=?',
            ).run(
              attempts >= 12 ? 'failed' : 'queued',
              attempts,
              error.message,
              Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
              job.id,
            );
          }
        }
        if (config.paymentDriver === 'ecofy') await processEcofyPayments(db, config);
        if (config.paymentDriver === 'flutterwave' && Date.now() - lastReconcile > 60000) {
          lastReconcile = Date.now();
          const rows = db
            .prepare(
              "SELECT * FROM orders WHERE provider='flutterwave' AND status IN ('pending','expired') AND created_at>? LIMIT 20",
            )
            .all(new Date(Date.now() - 86400000).toISOString());
          for (const order of rows) {
            try {
              await verifyPayment(db, order, config, order.provider_id);
            } catch {
              /* Retry on the next reconciliation pass. */
            }
          }
        }
      }
      await processDeliveries(db, config);
      config.workerHealth.lastCompleted = Date.now();
      config.workerHealth.lastFailed = null;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(
    () =>
      tick().catch((error) => {
        config.workerHealth.lastFailed = Date.now();
        console.error('Worker:', error.message);
      }),
    5000,
  );
  timer.unref();
  return () => {
    clearInterval(timer);
    config.workerHealth.startedAt = null;
  };
}
