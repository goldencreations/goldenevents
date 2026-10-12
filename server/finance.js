import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { transaction } from './db.js';
import { HttpError, normalizePhone } from './domain.js';
import { safeEqual, tokenHash, verifyPassword } from './auth.js';
import { scannerEmailAvailable } from './scanner-mail.js';
import { smsAvailable } from './sms.js';
import { issueOtp, consumeOtp, verifiedPhone, otpReceiptProof, maskOtpPhone } from './otp.js';
import { ecofyRequest, verifyEcofy } from './ecofy.js';
import {
  ecofyBalance,
  ecofyQuote,
  sendEcofyPayout,
  findEcofyPayout,
  fetchEcofyPayout,
} from './ecofy-payouts.js';

const demoMode = (config) => !config.production && config.paymentDriver === 'demo';
const automatic = (config) => ['ecofy', 'demo'].includes(config.payoutDriver);
export function payoutVerificationMode(config) {
  if (config.payoutOtpDriver === 'nextsms') return smsAvailable(config) ? 'nextsms' : 'disabled';
  if (demoMode(config) && config.deliveryDriver === 'outbox') return 'demo';
  if (config.payoutOtpDriver !== 'email' && smsAvailable(config)) return 'nextsms';
  return scannerEmailAvailable(config) ? 'email' : 'disabled';
}
function organizer(user) {
  if (!['organizer', 'admin'].includes(user?.role))
    throw new HttpError(403, 'Organizer access required.');
}
function administrator(user) {
  if (user?.role !== 'admin') throw new HttpError(403, 'Administrator access required.');
}
function ordersFor(db, userId, config) {
  return db
    .prepare(
      `SELECT o.id,o.reference,o.amount,o.currency,o.status,o.provider,
    o.platform_fee_bps,o.platform_fee,o.created_at,e.name AS event_name,e.status AS event_status,
    s.provider_fee,s.net AS settled_net,s.reference AS settlement_reference,s.settled_at,
    cf.fee AS ecofy_fee,cf.net AS ecofy_net,cf.matured_at
    FROM orders o JOIN events e ON e.id=o.event_id LEFT JOIN order_settlements s ON s.order_id=o.id
    LEFT JOIN ecofy_collection_finance cf ON cf.order_id=o.id
    WHERE e.owner_id=? AND o.currency='TZS' AND ${demoMode(config) ? "o.provider='demo'" : "o.provider!='demo'"}
    AND o.status IN ('paid','refunded') ORDER BY o.created_at DESC`,
    )
    .all(userId)
    .map((o) => {
      if (o.ecofy_fee !== null) o.provider_fee = o.ecofy_fee;
      if (config.payoutDriver === 'ecofy' && o.provider === 'ecofy') {
        o.settled_at = o.matured_at;
        o.settled_net = Math.max(0, (o.ecofy_net ?? 0) - (o.platform_fee ?? 0));
      }
      if (config.payoutDriver === 'demo') {
        o.provider_fee ??= 0;
        o.settled_at ||= o.created_at;
        o.settled_net = Math.max(0, o.amount - (o.platform_fee ?? 0) - o.provider_fee);
      }
      return o;
    });
}
function publicPayout(row) {
  const { challenge_id, ...safe } = row;
  return safe;
}
export function organizerFinance(db, config, user) {
  organizer(user);
  const rows = ordersFor(db, user.id, config);
  const paid = rows.filter((o) => o.status === 'paid');
  const payouts = db
    .prepare('SELECT * FROM payout_requests WHERE user_id=? AND mode=? ORDER BY created_at DESC')
    .all(user.id, demoMode(config) ? 'demo' : 'manual');
  const sum = (items, field) => items.reduce((total, row) => total + (row[field] ?? 0), 0);
  const gross = sum(paid, 'amount'),
    fee = sum(paid, 'platform_fee');
  const providerFees = sum(paid, 'provider_fee');
  const released = sum(
    paid.filter((o) => o.settled_at && o.event_status !== 'cancelled'),
    'settled_net',
  );
  const reserved =
    sum(
      payouts.filter((p) => ['requested', 'processing'].includes(p.status)),
      'amount',
    ) +
    sum(
      payouts.filter((p) => ['requested', 'processing'].includes(p.status)),
      'payout_fee',
    );
  const paidOut =
    sum(
      payouts.filter((p) => p.status === 'paid'),
      'amount',
    ) +
    sum(
      payouts.filter((p) => p.status === 'paid'),
      'payout_fee',
    );
  const remaining = released - reserved - paidOut;
  return {
    currency: 'TZS',
    fee_bps: config.platformFeeBps,
    minimum: config.payoutMinimum,
    demo: demoMode(config),
    payout_mode: automatic(config) ? config.payoutDriver : 'manual_review',
    automatic_disbursement: automatic(config),
    payout_fees: sum(
      payouts.filter((p) => p.status === 'paid'),
      'payout_fee',
    ),
    verification: payoutVerificationMode(config),
    verification_phone_ready:
      payoutVerificationMode(config) !== 'nextsms' || !!verifiedPhone(db, user.id),
    verification_phone: verifiedPhone(db, user.id)
      ? maskOtpPhone(verifiedPhone(db, user.id))
      : null,
    gross,
    platform_fee: fee,
    provider_fees: providerFees,
    provider_fees_pending: paid.filter((o) => o.provider_fee === null).length,
    net_estimate: gross - fee - providerFees,
    held: gross - fee - providerFees - released,
    released,
    reserved,
    paid_out: paidOut,
    available: Math.max(0, remaining),
    shortfall: Math.max(0, -remaining),
    refunded: sum(
      rows.filter((o) => o.status === 'refunded'),
      'amount',
    ),
    legacy_orders: paid.filter((o) => o.platform_fee_bps === null).length,
    orders: rows.map((o) => ({
      ...o,
      platform_fee: o.platform_fee ?? 0,
      platform_fee_bps: o.platform_fee_bps ?? 0,
      legacy: o.platform_fee_bps === null,
      net: o.amount - (o.platform_fee ?? 0) - (o.provider_fee ?? 0),
      released: o.status === 'paid' && !!o.settled_at && o.event_status !== 'cancelled',
    })),
    payouts: payouts.map(publicPayout),
  };
}
export function adminFinance(db, config, user) {
  administrator(user);
  const liveFilter = demoMode(config) ? "o.provider='demo'" : "o.provider!='demo'";
  return {
    demo: demoMode(config),
    automatic_disbursement: automatic(config),
    settlements: automatic(config)
      ? []
      : db
          .prepare(
            `SELECT o.id,o.reference,o.amount,o.platform_fee_bps,o.platform_fee,
      o.provider,e.name AS event_name,e.starts_at,u.name AS owner_name,u.email AS owner_email
      FROM orders o JOIN events e ON e.id=o.event_id JOIN users u ON u.id=e.owner_id
      LEFT JOIN order_settlements s ON s.order_id=o.id
      WHERE o.status='paid' AND o.currency='TZS' AND e.status!='cancelled' AND s.order_id IS NULL
      AND ${liveFilter} ORDER BY o.paid_at`,
          )
          .all(),
    payouts: db
      .prepare(
        `SELECT p.*,u.name AS owner_name,u.email AS owner_email FROM payout_requests p
      JOIN users u ON u.id=p.user_id WHERE p.mode=? ORDER BY p.created_at DESC`,
      )
      .all(demoMode(config) ? 'demo' : 'manual')
      .map(publicPayout),
    audit: db
      .prepare(
        `SELECT a.*,p.reference,u.name AS actor_name FROM payout_audit a
      JOIN payout_requests p ON p.id=a.payout_id JOIN users u ON u.id=a.actor_id
      WHERE p.mode=? ORDER BY a.created_at DESC LIMIT 100`,
      )
      .all(demoMode(config) ? 'demo' : 'manual'),
  };
}
export function reconcileOrder(db, config, user, orderId, input) {
  administrator(user);
  if (automatic(config))
    throw new HttpError(
      409,
      'Automatic payout balances use verified provider records, not manual releases.',
    );
  const parsed = z
    .object({
      provider_fee: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      reference: z.string().trim().min(4).max(120),
      funds_received: z.literal(true),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new HttpError(
      400,
      'Enter the provider fee, a statement reference, and confirm funds were received.',
    );
  return transaction(db, () => {
    const order = db
      .prepare(
        'SELECT o.*,e.status AS event_status FROM orders o JOIN events e ON e.id=o.event_id WHERE o.id=?',
      )
      .get(orderId);
    if (!order || order.currency !== 'TZS' || (order.provider === 'demo') !== demoMode(config))
      throw new HttpError(404, 'Order not found.');
    if (order.status !== 'paid' || order.event_status === 'cancelled')
      throw new HttpError(409, 'Only valid paid sales can be released.');
    const existing = db.prepare('SELECT * FROM order_settlements WHERE order_id=?').get(orderId);
    if (existing) {
      if (
        existing.provider_fee !== parsed.data.provider_fee ||
        existing.reference !== parsed.data.reference
      )
        throw new HttpError(409, 'This sale has already been reconciled.');
      return existing;
    }
    const net = order.amount - (order.platform_fee ?? 0) - parsed.data.provider_fee;
    if (net < 0) throw new HttpError(400, 'Fees cannot exceed the sale amount.');
    db.prepare('INSERT INTO order_settlements VALUES (?,?,?,?,?,?)').run(
      orderId,
      parsed.data.provider_fee,
      net,
      parsed.data.reference,
      user.id,
      new Date().toISOString(),
    );
    return db.prepare('SELECT * FROM order_settlements WHERE order_id=?').get(orderId);
  });
}
function challengeResponse(challenge, code) {
  return {
    challenge_id: challenge.id,
    email: challenge.email,
    mode: challenge.mode,
    expires_at: challenge.expires_at,
    amount: challenge.amount,
    phone: challenge.phone,
    network: challenge.network,
    recipient_name: challenge.recipient_name,
    payout_fee: challenge.payout_fee,
    total: challenge.amount + challenge.payout_fee,
    verification_phone: challenge.mode === 'nextsms' ? maskOtpPhone(challenge.otp_phone) : null,
    delivery_channel: challenge.mode === 'nextsms' ? 'sms' : 'email',
    ...(challenge.mode === 'demo' && code ? { demo_code: code } : {}),
  };
}
async function deliverCode(challenge, code) {
  const smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    requireTLS: true,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
  try {
    const result = await smtp.sendMail({
      from: process.env.SMTP_FROM,
      to: challenge.email,
      subject: 'Confirm your Golden Events payout request',
      text: `Your verification code is ${code}. It expires in 5 minutes.\n\nRecipient receives: TZS ${challenge.amount}\nWithdrawal fee: TZS ${challenge.payout_fee}\nTotal deducted: TZS ${challenge.amount + challenge.payout_fee}\nRecipient: ${challenge.recipient_name}\nDestination: ${challenge.network}, ${challenge.phone}\n\n${challenge.quote_id ? 'Confirming this code authorizes sending this payout.' : 'This code submits a request for review; it does not transfer money.'} Do not share it. If you did not request this, change your password and contact support.`,
    });
    if (!result.accepted?.includes(challenge.email)) throw new Error('Recipient not accepted');
  } finally {
    smtp.close();
  }
}
export async function requestPayoutCode(db, config, user, input, ip) {
  organizer(user);
  const mode = payoutVerificationMode(config);
  if (mode === 'disabled')
    throw new HttpError(
      503,
      'Payout verification delivery is not configured. No request has been submitted.',
    );
  const securityPhone = mode === 'nextsms' ? verifiedPhone(db, user.id) : null;
  if (mode === 'nextsms' && !securityPhone)
    throw new HttpError(409, 'Verify your account phone in Settings before requesting a payout.');
  let quote;
  if (automatic(config)) {
    quote = ownedQuote(db, config, user, input?.quote_id);
    if (input?.account_name_confirmed !== true)
      throw new HttpError(400, 'Confirm the verified account holder name before continuing.');
    input = {
      ...input,
      amount: quote.amount,
      phone: quote.account,
      network: quote.channel,
      recipient_name: quote.account_name,
    };
  }
  const parsed = z
    .object({
      amount: z.number().int().min(config.payoutMinimum).max(1000000000000),
      phone: z.string().max(30),
      network: quote
        ? z.enum(['MPESA', 'AIRTELMONEY', 'CRDB', 'NMB'])
        : z.enum(['mpesa', 'airtel', 'mixx', 'halopesa']),
      recipient_name: z.string().trim().min(2).max(100),
      password: z.string().min(1).max(128),
      idempotency_key: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success)
    throw new HttpError(400, 'Check the amount, mobile-money account, and password.');
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(parsed.data.password, current.password))
    throw new HttpError(401, 'Your account password is incorrect.');
  const phone = quote ? quote.account : normalizePhone(parsed.data.phone),
    now = Date.now();
  const payloadHash = tokenHash(
    JSON.stringify([
      user.id,
      parsed.data.amount,
      phone,
      parsed.data.network,
      parsed.data.recipient_name,
      quote?.id || '',
      quote?.fee || 0,
    ]),
  );
  const id = randomUUID(),
    code = String(randomInt(100000, 1000000));
  if (mode === 'nextsms') {
    const existing = db
      .prepare('SELECT * FROM payout_challenges WHERE idempotency_key=?')
      .get(parsed.data.idempotency_key);
    if (existing) {
      if (
        existing.user_id !== user.id ||
        existing.payload_hash !== payloadHash ||
        existing.mode !== mode ||
        existing.otp_phone !== securityPhone ||
        existing.email !== current.email ||
        existing.password_fingerprint !== tokenHash(current.password)
      )
        throw new HttpError(409, 'This request key was already used for different details.');
      const otp = db
        .prepare('SELECT status FROM otp_challenges WHERE id=?')
        .get(existing.otp_challenge_id);
      if (existing.status !== 'ready' || existing.expires_at <= now || otp?.status !== 'sent')
        throw new HttpError(409, 'Start a new verification request.');
      return {
        ...challengeResponse(existing),
        expires_in: Math.ceil((existing.expires_at - now) / 1000),
        resend_after: config.otpResendCooldownSeconds,
      };
    }
    let created;
    await issueOtp(
      db,
      config,
      { purpose: 'payout', userId: user.id, phone: securityPhone, binding: payloadHash, ip },
      {
        expiresAt: quote?.expires_at,
        amount: parsed.data.amount + (quote?.fee || 0),
        afterCreate: (otp) => {
          if (quote) ownedQuote(db, config, user, quote.id);
          if (
            verifiedPhone(db, user.id) !== securityPhone ||
            db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password !==
              current.password
          )
            throw new HttpError(409, 'Account verification changed. Start again.');
          if (
            parsed.data.amount + (quote?.fee || 0) >
            organizerFinance(db, config, current).available
          )
            throw new HttpError(409, 'The amount exceeds your available balance.');
          const duplicate = db
            .prepare('SELECT * FROM payout_challenges WHERE idempotency_key=?')
            .get(parsed.data.idempotency_key);
          if (duplicate)
            throw new HttpError(409, 'This payout verification key has already been used.');
          db.prepare(
            "UPDATE payout_challenges SET status='superseded' WHERE user_id=? AND status IN ('ready','sending')",
          ).run(user.id);
          db.prepare(
            `INSERT INTO payout_challenges
          (id,user_id,idempotency_key,payload_hash,amount,phone,network,recipient_name,email,password_fingerprint,otp_hash,mode,expires_at,status,created_at,quote_id,payout_fee,otp_challenge_id,otp_phone)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'sending',?,?,?,?,?)`,
          ).run(
            id,
            user.id,
            parsed.data.idempotency_key,
            payloadHash,
            parsed.data.amount,
            phone,
            parsed.data.network,
            parsed.data.recipient_name,
            current.email,
            tokenHash(current.password),
            `nextsms:${otp.id}`,
            mode,
            otp.expires_at,
            now,
            quote?.id || null,
            quote?.fee || 0,
            otp.id,
            securityPhone,
          );
          created = db.prepare('SELECT * FROM payout_challenges WHERE id=?').get(id);
        },
        afterSent: () => {
          const ready = db
            .prepare("UPDATE payout_challenges SET status='ready' WHERE id=? AND status='sending'")
            .run(id);
          if (!ready.changes) throw new HttpError(409, 'This verification was replaced.');
        },
        afterFailed: () =>
          db
            .prepare("UPDATE payout_challenges SET status='failed' WHERE id=? AND status='sending'")
            .run(id),
      },
    );
    return {
      ...challengeResponse(created),
      expires_in: Math.max(0, Math.ceil((created.expires_at - Date.now()) / 1000)),
      resend_after: config.otpResendCooldownSeconds,
    };
  }
  const result = transaction(db, () => {
    const duplicate = db
      .prepare('SELECT * FROM payout_challenges WHERE idempotency_key=?')
      .get(parsed.data.idempotency_key);
    if (duplicate) {
      if (duplicate.user_id !== user.id || duplicate.payload_hash !== payloadHash)
        throw new HttpError(409, 'This request key was already used for different details.');
      if (duplicate.status !== 'ready' || duplicate.expires_at <= now)
        throw new HttpError(409, 'Start a new verification request.');
      return { challenge: duplicate, created: false };
    }
    const limits = db
      .prepare(
        `SELECT MAX(created_at) AS last_sent,
      SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS recent,
      SUM(CASE WHEN created_at>? THEN attempts ELSE 0 END) AS attempts,
      COUNT(*) AS daily FROM payout_challenges WHERE user_id=? AND created_at>?`,
      )
      .get(now - 900000, now - 900000, user.id, now - 86400000);
    if (
      (limits.last_sent && now - limits.last_sent < 60000) ||
      limits.recent >= 3 ||
      limits.daily >= 10 ||
      limits.attempts >= 10
    )
      throw new HttpError(429, 'Too many verification requests. Wait before trying again.');
    if (quote) ownedQuote(db, config, user, quote.id);
    if (parsed.data.amount + (quote?.fee || 0) > organizerFinance(db, config, current).available)
      throw new HttpError(409, 'The amount exceeds your available balance.');
    db.prepare(
      "UPDATE payout_challenges SET status='superseded' WHERE user_id=? AND status IN ('ready','sending')",
    ).run(user.id);
    db.prepare(
      `INSERT INTO payout_challenges
      (id,user_id,idempotency_key,payload_hash,amount,phone,network,recipient_name,email,password_fingerprint,otp_hash,mode,expires_at,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'sending',?)`,
    ).run(
      id,
      user.id,
      parsed.data.idempotency_key,
      payloadHash,
      parsed.data.amount,
      phone,
      parsed.data.network,
      parsed.data.recipient_name,
      current.email,
      tokenHash(current.password),
      tokenHash(`${id}:${payloadHash}:${code}`),
      mode,
      Math.min(now + 300000, quote?.expires_at || Infinity),
      now,
    );
    db.prepare('UPDATE payout_challenges SET quote_id=?,payout_fee=? WHERE id=?').run(
      quote?.id || null,
      quote?.fee || 0,
      id,
    );
    return {
      challenge: db.prepare('SELECT * FROM payout_challenges WHERE id=?').get(id),
      created: true,
    };
  });
  if (!result.created) return challengeResponse(result.challenge);
  try {
    if (mode === 'email') await deliverCode(result.challenge, code);
    const sent = db
      .prepare("UPDATE payout_challenges SET status='ready' WHERE id=? AND status='sending'")
      .run(id);
    if (!sent.changes) throw new Error('Verification was superseded');
  } catch {
    db.prepare("UPDATE payout_challenges SET status='failed' WHERE id=? AND status='sending'").run(
      id,
    );
    throw new HttpError(
      502,
      'The verification email could not be delivered. No request was submitted. Try again in a minute.',
    );
  }
  return challengeResponse(result.challenge, code);
}
export function confirmPayout(db, config, user, challengeId, input) {
  organizer(user);
  if (typeof input?.code !== 'string' || !/^\d{6}$/.test(input.code))
    throw new HttpError(400, 'Enter the six-digit verification code.');
  const result = transaction(db, () => {
    const c = db
      .prepare('SELECT * FROM payout_challenges WHERE id=? AND user_id=?')
      .get(challengeId, user.id);
    if (!c) throw new HttpError(404, 'Verification request not found.');
    const account = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (
      c.mode !== payoutVerificationMode(config) ||
      c.email !== account.email ||
      !safeEqual(c.password_fingerprint, tokenHash(account.password))
    )
      throw new HttpError(409, 'Account verification changed. Start again.');
    if (c.attempts >= 5) throw new HttpError(429, 'Too many incorrect codes. Start again.');
    if (
      !['ready', 'consumed'].includes(c.status) ||
      (c.status !== 'consumed' && c.expires_at <= Date.now())
    )
      throw new HttpError(409, 'This verification code expired or was replaced. Start again.');
    const smsContext =
      c.mode === 'nextsms'
        ? { userId: user.id, phone: c.otp_phone, purpose: 'payout', binding: c.payload_hash }
        : null;
    if (smsContext && verifiedPhone(db, user.id) !== c.otp_phone)
      throw new HttpError(409, 'Account phone changed. Start again.');
    if (smsContext && c.status === 'consumed') {
      if (!otpReceiptProof(db, config, c.otp_challenge_id, smsContext))
        throw new HttpError(409, 'Read the completed payout from your payout history.');
      return {
        payout: publicPayout(
          db.prepare('SELECT * FROM payout_requests WHERE challenge_id=?').get(c.id),
        ),
      };
    }
    if (smsContext) {
      const verified = consumeOtp(db, config, c.otp_challenge_id, smsContext, input.code);
      if (!verified.ok) {
        db.prepare('UPDATE payout_challenges SET attempts=attempts+1 WHERE id=?').run(c.id);
        return { error: new HttpError(verified.status, verified.error) };
      }
    } else if (!safeEqual(c.otp_hash, tokenHash(`${c.id}:${c.payload_hash}:${input.code}`))) {
      db.prepare('UPDATE payout_challenges SET attempts=attempts+1 WHERE id=?').run(c.id);
      return { error: new HttpError(400, 'The verification code is incorrect.') };
    }
    if (c.status === 'consumed')
      return {
        payout: publicPayout(
          db.prepare('SELECT * FROM payout_requests WHERE challenge_id=?').get(c.id),
        ),
      };
    const quote = c.quote_id ? ownedQuote(db, config, user, c.quote_id) : null;
    if (automatic(config) !== !!quote)
      throw new HttpError(409, 'Payout configuration changed. Start again.');
    if (
      c.amount < config.payoutMinimum ||
      c.amount + c.payout_fee > organizerFinance(db, config, account).available
    )
      throw new HttpError(409, 'Your available balance changed. Refresh and start again.');
    const id = randomUUID(),
      now = new Date().toISOString();
    db.prepare(
      `INSERT INTO payout_requests
      (id,reference,user_id,challenge_id,amount,currency,phone,network,recipient_name,mode,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'TZS',?,?,?,?,'requested',?,?)`,
    ).run(
      id,
      `GP-${randomBytes(6).toString('hex').toUpperCase()}`,
      user.id,
      c.id,
      c.amount,
      c.phone,
      c.network,
      c.recipient_name,
      demoMode(config) ? 'demo' : 'manual',
      now,
      now,
    );
    db.prepare('UPDATE payout_requests SET driver=?,payout_fee=?,status=? WHERE id=?').run(
      quote ? quote.driver : 'manual',
      c.payout_fee,
      quote ? 'processing' : 'requested',
      id,
    );
    if (quote)
      db.prepare('INSERT INTO payout_jobs (payout_id,quote_id) VALUES (?,?)').run(id, quote.id);
    db.prepare("UPDATE payout_challenges SET status='consumed' WHERE id=?").run(c.id);
    db.prepare('INSERT INTO payout_audit VALUES (?,?,?,?,?,?)').run(
      randomUUID(),
      id,
      user.id,
      'requested',
      `Account password and ${c.mode === 'nextsms' ? 'SMS' : 'email'} OTP verified.`,
      now,
    );
    return { payout: publicPayout(db.prepare('SELECT * FROM payout_requests WHERE id=?').get(id)) };
  });
  if (result.error) throw result.error;
  return result.payout;
}
export function cancelPayout(db, config, user, id) {
  organizer(user);
  return transaction(db, () => {
    const p = db
      .prepare('SELECT * FROM payout_requests WHERE id=? AND user_id=? AND mode=?')
      .get(id, user.id, demoMode(config) ? 'demo' : 'manual');
    if (!p) throw new HttpError(404, 'Payout request not found.');
    if (p.status === 'cancelled') return publicPayout(p);
    if (p.status !== 'requested')
      throw new HttpError(409, 'Only requests awaiting review can be cancelled.');
    const now = new Date().toISOString();
    db.prepare("UPDATE payout_requests SET status='cancelled',updated_at=? WHERE id=?").run(
      now,
      id,
    );
    db.prepare('INSERT INTO payout_audit VALUES (?,?,?,?,?,?)').run(
      randomUUID(),
      id,
      user.id,
      'cancelled',
      'Cancelled by organizer.',
      now,
    );
    return publicPayout(db.prepare('SELECT * FROM payout_requests WHERE id=?').get(id));
  });
}
export function reviewPayout(db, config, user, id, input) {
  administrator(user);
  const parsed = z
    .object({
      action: z.enum(['processing', 'paid', 'rejected']),
      note: z.string().trim().min(5).max(500),
      transfer_reference: z.string().trim().min(4).max(120).optional(),
      transfer_confirmed: z.boolean().optional(),
      confirmed_not_sent: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Choose an action and provide a review note.');
  return transaction(db, () => {
    const p = db
      .prepare('SELECT * FROM payout_requests WHERE id=? AND mode=?')
      .get(id, demoMode(config) ? 'demo' : 'manual');
    if (!p) throw new HttpError(404, 'Payout request not found.');
    const data = parsed.data;
    if (p.driver !== 'manual')
      throw new HttpError(
        409,
        'Provider payouts are reconciled automatically. Do not record a second manual transfer.',
      );
    if (
      p.status === data.action &&
      p.note === data.note &&
      (p.transfer_reference || undefined) === data.transfer_reference
    )
      return publicPayout(p);
    if (
      (data.action === 'processing' && p.status !== 'requested') ||
      (data.action === 'paid' && p.status !== 'processing') ||
      (data.action === 'rejected' && !['requested', 'processing'].includes(p.status))
    )
      throw new HttpError(409, 'This payout has already changed. Refresh before reviewing.');
    if (data.action === 'rejected' && p.status === 'processing' && !data.confirmed_not_sent)
      throw new HttpError(400, 'Confirm no transfer was sent before releasing reserved funds.');
    if (data.action === 'paid' && (!data.transfer_reference || !data.transfer_confirmed))
      throw new HttpError(400, 'Confirm the completed transfer and supply its provider reference.');
    if (data.action === 'processing') {
      const owner = db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
      if (organizerFinance(db, config, owner).shortfall > 0)
        throw new HttpError(
          409,
          'Funds are no longer sufficient. Resolve refunds or cancellations first.',
        );
    }
    if (data.action !== 'paid' && data.transfer_reference)
      throw new HttpError(400, 'A transfer reference belongs only to a completed payment.');
    if (
      data.transfer_reference &&
      db
        .prepare('SELECT id FROM payout_requests WHERE transfer_reference=? AND id!=?')
        .get(data.transfer_reference, id)
    )
      throw new HttpError(409, 'This transfer reference has already been recorded.');
    const now = new Date().toISOString();
    // Processing funds stay reserved until a definite transfer outcome is recorded.
    db.prepare(
      'UPDATE payout_requests SET status=?,updated_at=?,reviewed_by=?,note=?,transfer_reference=? WHERE id=?',
    ).run(data.action, now, user.id, data.note, data.transfer_reference || null, id);
    db.prepare('INSERT INTO payout_audit VALUES (?,?,?,?,?,?)').run(
      randomUUID(),
      id,
      user.id,
      data.action,
      `${data.note}${data.transfer_reference ? ` | Transfer: ${data.transfer_reference}` : ''}`,
      now,
    );
    return publicPayout(db.prepare('SELECT * FROM payout_requests WHERE id=?').get(id));
  });
}

function ownedQuote(db, config, user, id) {
  const q =
    typeof id === 'string' &&
    db
      .prepare('SELECT * FROM payout_quotes WHERE id=? AND user_id=? AND driver=?')
      .get(id, user.id, config.payoutDriver);
  if (!q) throw new HttpError(404, 'Payout quote not found.');
  if (q.status !== 'ready' || q.expires_at <= Date.now())
    throw new HttpError(
      409,
      'This quote expired. Get a new quote and check the name and fee again.',
    );
  if (
    db
      .prepare(
        `SELECT 1 FROM payout_challenges c JOIN payout_requests p ON p.challenge_id=c.id WHERE c.quote_id=?`,
      )
      .get(q.id)
  )
    throw new HttpError(409, 'This quote has already been used. Check your payout history.');
  return q;
}
function publicQuote(q) {
  return {
    id: q.id,
    amount: q.amount,
    fee: q.fee,
    total: q.total,
    account_name: q.account_name,
    account_last4: q.account.slice(-4),
    destination_type: q.destination_type,
    channel: q.channel,
    expires_at: q.expires_at,
    demo: q.driver === 'demo',
  };
}
export async function requestPayoutQuote(db, config, user, input) {
  organizer(user);
  if (!automatic(config)) throw new HttpError(409, 'Provider payout quotes are not enabled.');
  if (payoutVerificationMode(config) === 'disabled')
    throw new HttpError(
      503,
      'Configure payout verification delivery before requesting a withdrawal.',
    );
  if (payoutVerificationMode(config) === 'nextsms' && !verifiedPhone(db, user.id))
    throw new HttpError(
      409,
      'Verify your account phone in Settings before requesting a withdrawal.',
    );
  const parsed = z
    .object({
      amount: z.number().int().min(config.payoutMinimum).max(1000000000000),
      destination_type: z.enum(['mobile_money', 'bank']),
      channel: z.enum(['MPESA', 'AIRTELMONEY', 'CRDB', 'NMB']),
      account: z.string().trim().min(6).max(30),
      password: z.string().min(1).max(128),
      idempotency_key: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Check the amount, account, network and password.');
  const d = parsed.data,
    current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(d.password, current.password))
    throw new HttpError(401, 'Your account password is incorrect.');
  if ((d.destination_type === 'bank') !== ['CRDB', 'NMB'].includes(d.channel))
    throw new HttpError(400, 'Choose the matching bank or mobile-money network.');
  const account =
    d.destination_type === 'mobile_money' ? normalizePhone(d.account).slice(1) : d.account;
  if (!/^\d{6,30}$/.test(account)) throw new HttpError(400, 'Enter a valid account number.');
  const payloadHash = tokenHash(
    JSON.stringify([user.id, d.amount, d.destination_type, d.channel, account]),
  );
  const q = transaction(db, () => {
    let row = db
      .prepare('SELECT * FROM payout_quotes WHERE idempotency_key=?')
      .get(d.idempotency_key);
    if (row) {
      if (
        row.user_id !== user.id ||
        row.payload_hash !== payloadHash ||
        row.driver !== config.payoutDriver
      )
        throw new HttpError(409, 'This quote key was already used for different details.');
      if (row.status === 'ready') {
        ownedQuote(db, config, user, row.id);
        return row;
      }
      if (row.status === 'failed') throw new HttpError(409, 'Get a new quote.');
    } else {
      const n = db
        .prepare('SELECT COUNT(*) AS n FROM payout_quotes WHERE user_id=? AND created_at>?')
        .get(user.id, Date.now() - 900000).n;
      if (n >= 10) throw new HttpError(429, 'Too many account checks. Try again later.');
      if (d.amount > organizerFinance(db, config, current).available)
        throw new HttpError(409, 'The amount exceeds your available earnings.');
      const id = randomUUID();
      db.prepare(
        `INSERT INTO payout_quotes (id,user_id,driver,idempotency_key,payload_hash,amount,destination_type,channel,account,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'quoting',?)`,
      ).run(
        id,
        user.id,
        config.payoutDriver,
        d.idempotency_key,
        payloadHash,
        d.amount,
        d.destination_type,
        d.channel,
        account,
        Date.now(),
      );
      row = db.prepare('SELECT * FROM payout_quotes WHERE id=?').get(id);
    }
    if (row.next_attempt > Date.now())
      throw new HttpError(409, 'Your account check is still running. Retry shortly.');
    db.prepare('UPDATE payout_quotes SET next_attempt=? WHERE id=?').run(
      Date.now() + 60000,
      row.id,
    );
    return row;
  });
  if (q.status === 'ready') return publicQuote(q);
  try {
    const remote =
      q.driver === 'demo'
        ? {
            id: `pq_${q.id.replaceAll('-', '')}`,
            amount: q.amount,
            fee: 100,
            total: q.amount + 100,
            account_name: 'DEMO VERIFIED RECIPIENT',
            expires_at: Date.now() + 600000,
          }
        : await ecofyQuote(config, q);
    if (remote.expires_at <= Date.now())
      throw new HttpError(409, 'This quote expired. Start again.');
    if (remote.total > organizerFinance(db, config, current).available)
      throw new HttpError(
        409,
        'The amount plus withdrawal fee exceeds your earnings. Choose a smaller amount.',
      );
    if (q.driver === 'ecofy') {
      const wallet = await ecofyBalance(config);
      const uncertain = db
        .prepare(
          `SELECT COALESCE(SUM(p.amount+p.payout_fee),0) AS n FROM payout_requests p
        WHERE p.driver='ecofy' AND p.status='processing' AND p.provider_id IS NULL`,
        )
        .get().n;
      if (remote.total > wallet.available - uncertain)
        throw new HttpError(
          503,
          'Provider funds are not available yet. Your earnings remain held; no money was sent.',
        );
    }
    db.prepare(
      `UPDATE payout_quotes SET external_id=?,account_name=?,fee=?,total=?,expires_at=?,status='ready' WHERE id=? AND status='quoting'`,
    ).run(remote.id, remote.account_name, remote.fee, remote.total, remote.expires_at, q.id);
    return publicQuote(db.prepare('SELECT * FROM payout_quotes WHERE id=?').get(q.id));
  } catch (error) {
    db.prepare(
      "UPDATE payout_quotes SET status=?,next_attempt=0 WHERE id=? AND status='quoting'",
    ).run(error instanceof HttpError || error.definitive ? 'failed' : 'quoting', q.id);
    if (error instanceof HttpError) throw error;
    if (error.code === 'not_found')
      throw new HttpError(400, 'Ecofy could not find this account. Check the number and channel.');
    throw new HttpError(
      502,
      'The account check could not be confirmed. No money was sent. Retry the same quote request.',
    );
  }
}
function finishPayout(db, payout, status, note, providerId = null) {
  return transaction(db, () => {
    const result = db
      .prepare(
        `UPDATE payout_requests SET status=?,provider_id=COALESCE(?,provider_id),
      transfer_reference=?,updated_at=?,note=? WHERE id=? AND status='processing'`,
      )
      .run(
        status,
        providerId,
        status === 'paid' ? providerId : null,
        new Date().toISOString(),
        note,
        payout.id,
      );
    if (result.changes) {
      db.prepare('INSERT INTO payout_audit VALUES (?,?,?,?,?,?)').run(
        randomUUID(),
        payout.id,
        payout.user_id,
        status,
        note,
        new Date().toISOString(),
      );
      db.prepare('DELETE FROM payout_jobs WHERE payout_id=?').run(payout.id);
    }
  });
}
async function processOnePayout(db, config, id) {
  const lease = db
    .prepare(
      `UPDATE payout_jobs SET next_attempt=?,attempts=attempts+1 WHERE payout_id=? AND next_attempt<=?`,
    )
    .run(Date.now() + 60000, id, Date.now());
  if (!lease.changes) return;
  const payout = db.prepare('SELECT * FROM payout_requests WHERE id=?').get(id);
  const job = db.prepare('SELECT * FROM payout_jobs WHERE payout_id=?').get(id);
  if (!payout || !job) return;
  const quote = db.prepare('SELECT * FROM payout_quotes WHERE id=?').get(job.quote_id);
  if (payout.status !== 'processing') {
    db.prepare('DELETE FROM payout_jobs WHERE payout_id=?').run(id);
    return;
  }
  if (payout.driver !== config.payoutDriver) return;
  if (payout.driver === 'demo') {
    finishPayout(
      db,
      payout,
      'paid',
      'Simulated transfer completed. No real money moved.',
      `po_demo${id.replaceAll('-', '')}`,
    );
    return;
  }
  let providerId = payout.provider_id,
    submitted = false;
  try {
    if (!providerId && job.outcome_unknown) providerId = await findEcofyPayout(config, payout);
    if (!providerId) {
      if (!job.outcome_unknown) {
        if (quote.expires_at <= Date.now()) {
          finishPayout(
            db,
            payout,
            'rejected',
            'Quote expired before submission. No transfer sent.',
          );
          return;
        }
        const owner = db.prepare('SELECT * FROM users WHERE id=?').get(payout.user_id);
        if (organizerFinance(db, config, owner).shortfall > 0) {
          finishPayout(
            db,
            payout,
            'rejected',
            'Balance changed before submission. No transfer sent.',
          );
          return;
        }
        const wallet = await ecofyBalance(config);
        const other = db
          .prepare(
            `SELECT COALESCE(SUM(amount+payout_fee),0) AS n FROM payout_requests
          WHERE driver='ecofy' AND status='processing' AND provider_id IS NULL AND id!=?`,
          )
          .get(id).n;
        if (wallet.available < payout.amount + payout.payout_fee + other) {
          finishPayout(
            db,
            payout,
            'rejected',
            'Provider available funds are insufficient. No transfer sent.',
          );
          return;
        }
      }
      // This flag commits before the network call: a crash must not make funds spendable again.
      db.prepare('UPDATE payout_jobs SET outcome_unknown=1 WHERE payout_id=?').run(id);
      submitted = true;
      const response = await sendEcofyPayout(config, payout, quote);
      providerId = response.id;
    }
    db.prepare('UPDATE payout_requests SET provider_id=? WHERE id=? AND provider_id IS NULL').run(
      providerId,
      id,
    );
    const verified = await fetchEcofyPayout(
      config,
      { ...payout, provider_id: providerId },
      providerId,
    );
    if (verified.status === 'paid')
      finishPayout(db, payout, 'paid', 'Ecofy confirmed the payout was paid.', providerId);
    else if (verified.status === 'failed')
      finishPayout(
        db,
        payout,
        'rejected',
        'Ecofy confirmed failure; reserved funds released.',
        providerId,
      );
    else
      db.prepare('UPDATE payout_jobs SET next_attempt=?,error=NULL WHERE payout_id=?').run(
        Date.now() + 5000,
        id,
      );
  } catch (error) {
    // Only an explicit pre-transfer rejection of the FIRST submission can release funds without GET proof.
    if (
      submitted &&
      !providerId &&
      !job.outcome_unknown &&
      ['insufficient_balance', 'withdrawals_unavailable'].includes(error.code)
    ) {
      finishPayout(
        db,
        payout,
        'rejected',
        'Ecofy refused the withdrawal before sending money. Reserved funds released.',
      );
      return;
    }
    db.prepare('UPDATE payout_jobs SET next_attempt=?,error=? WHERE payout_id=?').run(
      Date.now() + Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 6)),
      'Payout outcome is being verified. Do not send another transfer.',
      id,
    );
  }
}
export async function submitPayout(db, config, user, challengeId, input) {
  const payout = confirmPayout(db, config, user, challengeId, input);
  if (payout.driver !== 'manual') await processOnePayout(db, config, payout.id);
  return publicPayout(db.prepare('SELECT * FROM payout_requests WHERE id=?').get(payout.id));
}
export async function processPayoutJobs(db, config) {
  if (!automatic(config)) return;
  const jobs = db
    .prepare(
      `SELECT j.payout_id FROM payout_jobs j JOIN payout_requests p ON p.id=j.payout_id
    WHERE p.driver=? AND j.next_attempt<=? ORDER BY j.next_attempt LIMIT 10`,
    )
    .all(config.payoutDriver, Date.now());
  for (const job of jobs) await processOnePayout(db, config, job.payout_id);
}
export async function syncEcofyFinance(db, config) {
  if (config.payoutDriver !== 'ecofy') return;
  const previous = db.prepare('SELECT * FROM ecofy_wallet WHERE id=1').get();
  if (previous && Date.now() - previous.checked_at < 30000) return;
  const wallet = await ecofyBalance(config);
  for (const order of db
    .prepare(
      `SELECT o.* FROM orders o LEFT JOIN ecofy_collection_finance f ON f.order_id=o.id
    WHERE o.provider='ecofy' AND o.status='paid' AND f.order_id IS NULL LIMIT 20`,
    )
    .all()) {
    try {
      await verifyEcofy(db, order, config, order.provider_id);
    } catch {
      /* Hold unverified funds. */
    }
  }
  const params = new URLSearchParams({
    limit: '100',
    ...(previous?.before_cursor ? { before: previous.before_cursor } : {}),
  });
  const statement = await ecofyRequest(config, `/v1/transactions?${params}`);
  if (!Array.isArray(statement.data) || typeof statement.has_more !== 'boolean')
    throw new Error('Invalid Ecofy statement.');
  const cursor = statement.has_more ? statement.next_before : null;
  if (
    statement.has_more &&
    (typeof cursor !== 'string' || !cursor || cursor === previous?.before_cursor)
  )
    throw new Error('Invalid Ecofy statement cursor.');
  transaction(db, () => {
    for (const movement of statement.data) {
      if (
        movement.type !== 'matured' ||
        !/^pay_[A-Za-z0-9]+$/.test(movement.reference || '') ||
        !Number.isSafeInteger(movement.amount) ||
        movement.amount < 0
      )
        continue;
      db.prepare('INSERT OR IGNORE INTO ecofy_maturations VALUES (?,?,?)').run(
        movement.reference,
        movement.amount,
        new Date().toISOString(),
      );
      db.prepare(
        `UPDATE ecofy_collection_finance SET matured_at=COALESCE(matured_at,?) WHERE net=? AND order_id IN
        (SELECT id FROM orders WHERE provider='ecofy' AND provider_id=?)`,
      ).run(new Date().toISOString(), movement.amount, movement.reference);
    }
    db.prepare(
      `INSERT INTO ecofy_wallet VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      available=excluded.available,pending=excluded.pending,reserved=excluded.reserved,checked_at=excluded.checked_at,before_cursor=excluded.before_cursor`,
    ).run(wallet.available, wallet.pending, wallet.reserved, Date.now(), cursor);
  });
}
