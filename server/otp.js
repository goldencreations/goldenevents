import { randomInt, randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { hashPassword, verifyPassword, tokenHash } from './auth.js';
import { HttpError, normalizePhone } from './domain.js';
import { smsAvailable, smsGateway } from './sms.js';

const purposes = new Set(['phone_verification', 'payout', 'ticket_claim']);
export const otpBinding = (value) => tokenHash(JSON.stringify(value));
export const maskOtpPhone = (phone) => `+255 *** *** ${phone.slice(-4)}`;
export function publicOtp(row) {
  return {
    challenge_id: row.id,
    phone: maskOtpPhone(row.phone),
    expires_at: row.expires_at,
    expires_in: Math.max(0, Math.ceil((row.expires_at - Date.now()) / 1000)),
  };
}
export async function issueOtp(db, config, context, options = {}) {
  if (!purposes.has(context.purpose)) throw new HttpError(400, 'Unsupported verification purpose.');
  if (!smsAvailable(config)) throw new HttpError(503, 'SMS verification is not configured.');
  const phone = normalizePhone(context.phone),
    now = Date.now(),
    id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  const hash = hashPassword(`${id}:${context.purpose}:${context.binding}:${code}`);
  const ipHash = tokenHash(context.ip || 'internal');
  const expires = Math.min(now + config.otpTtlMinutes * 60000, options.expiresAt || Infinity);
  if (expires <= now) throw new HttpError(409, 'Verification authorization has expired.');
  const row = transaction(db, () => {
    const sends = db
      .prepare(
        `SELECT COUNT(*) AS n,MAX(created_at) AS last_sent,SUM(attempts) AS guesses
      FROM otp_challenges WHERE phone=? AND purpose=? AND created_at>?`,
      )
      .get(phone, context.purpose, now - 3600000);
    if (
      (sends.last_sent && now - sends.last_sent < config.otpResendCooldownSeconds * 1000) ||
      sends.n >= config.otpSendLimitPerHour ||
      sends.guesses >= 10
    )
      throw new HttpError(429, 'Wait before requesting another verification code.');
    const ipSends = db
      .prepare(
        'SELECT COUNT(*) AS n FROM otp_challenges WHERE requester_ip_hash=? AND created_at>?',
      )
      .get(ipHash, now - 60000).n;
    if (ipSends >= 3)
      throw new HttpError(429, 'Too many verification requests. Try again shortly.');
    db.prepare(
      "UPDATE otp_challenges SET status='superseded',code_hash=NULL WHERE phone=? AND purpose=? AND status IN ('pending','sent')",
    ).run(phone, context.purpose);
    db.prepare(
      `INSERT INTO otp_challenges (id,user_id,phone,purpose,binding_hash,code_hash,status,created_at,expires_at,requester_ip_hash)
      VALUES (?,?,?,?,?,?,'pending',?,?,?)`,
    ).run(
      id,
      context.userId || null,
      phone,
      context.purpose,
      context.binding,
      hash,
      now,
      expires,
      ipHash,
    );
    const created = db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(id);
    options.afterCreate?.(created);
    return created;
  });
  const label = {
    phone_verification: 'phone verification',
    payout: `payout${options.amount ? ` TZS ${options.amount}` : ''}`,
    ticket_claim: 'ticket claim',
  }[context.purpose];
  const minutes = Math.max(1, Math.ceil((expires - now) / 60000));
  const body = `Golden Events: ${label} code ${code}. Expires in ${minutes} min. Do not share this code.`;
  try {
    const accepted = await smsGateway(config).send(phone, body, id);
    if (!accepted || !['accepted', 'delivered'].includes(accepted.status))
      throw new Error('No SMS acceptance');
    transaction(db, () => {
      const sent = db
        .prepare(
          `UPDATE otp_challenges SET status='sent',provider_message_id=?,sent_at=?,latency_ms=?
        WHERE id=? AND status='pending' AND expires_at>?`,
        )
        .run(
          accepted.messageId ? String(accepted.messageId) : null,
          Date.now(),
          Date.now() - now,
          id,
          Date.now(),
        );
      if (!sent.changes)
        throw new HttpError(409, 'This code was replaced or expired. Request a new code.');
      options.afterSent?.(row);
    });
  } catch (error) {
    const failureCode =
      /^(http_\d{3}|provider_\d{1,2}_\d{1,4}|invalid_response|invalid_json|transport_error|timeout)$/.test(
        error?.smsFailureCode || '',
      )
        ? error.smsFailureCode
        : 'send_unconfirmed';
    db.prepare(
      "UPDATE otp_challenges SET status='delivery_failed',code_hash=NULL,error_code=?,latency_ms=? WHERE id=? AND status='pending'",
    ).run(failureCode, Date.now() - now, id);
    options.afterFailed?.(row);
    if (error instanceof HttpError && error.status === 409) throw error;
    throw new HttpError(
      502,
      'The SMS could not be confirmed. Request a new code after the cooldown.',
    );
  }
  return { ...publicOtp(row), resend_after: config.otpResendCooldownSeconds };
}
// Caller commits the OTP result and the protected action in the same transaction.
export function consumeOtp(db, config, id, context, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code))
    return { ok: false, status: 400, error: 'Enter the six-digit verification code.' };
  const row = db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(id);
  if (
    !row ||
    row.user_id !== (context.userId || null) ||
    row.purpose !== context.purpose ||
    row.binding_hash !== context.binding ||
    row.phone !== normalizePhone(context.phone)
  )
    return { ok: false, status: 404, error: 'Verification request not found.' };
  if (row.status === 'locked')
    return { ok: false, status: 429, error: 'Too many incorrect codes. Request a new code.' };
  if (row.status !== 'sent')
    return { ok: false, status: 409, error: 'This code is no longer active.' };
  if (row.expires_at <= Date.now()) {
    db.prepare("UPDATE otp_challenges SET status='expired',code_hash=NULL WHERE id=?").run(id);
    return { ok: false, status: 409, error: 'Your code expired. Request a new code.' };
  }
  if (row.attempts >= config.otpMaxAttempts)
    return { ok: false, status: 429, error: 'Too many incorrect codes.' };
  if (
    !row.code_hash ||
    !verifyPassword(`${id}:${row.purpose}:${row.binding_hash}:${code}`, row.code_hash)
  ) {
    const attempts = row.attempts + 1,
      locked = attempts >= config.otpMaxAttempts;
    db.prepare('UPDATE otp_challenges SET attempts=?,status=?,code_hash=? WHERE id=?').run(
      attempts,
      locked ? 'locked' : 'sent',
      locked ? null : row.code_hash,
      id,
    );
    return { ok: false, status: locked ? 429 : 400, error: 'The verification code is incorrect.' };
  }
  db.prepare(
    "UPDATE otp_challenges SET status='verified',verified_at=?,code_hash=NULL WHERE id=? AND status='sent'",
  ).run(Date.now(), id);
  return { ok: true, row };
}
export function verifiedPhone(db, userId) {
  return db.prepare('SELECT * FROM verified_phones WHERE user_id=?').get(userId)?.phone || null;
}
export function otpReceiptProof(db, config, id, context) {
  const row = db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(id);
  return (
    !!row &&
    row.status === 'verified' &&
    row.user_id === (context.userId || null) &&
    row.purpose === context.purpose &&
    row.binding_hash === context.binding &&
    row.phone === normalizePhone(context.phone) &&
    Date.now() - row.verified_at <= config.otpVerificationTtlMinutes * 60000
  );
}
function phoneBinding(user, phone) {
  return otpBinding(['phone_verification', user.id, phone, tokenHash(user.password)]);
}
export async function requestPhoneCode(db, config, user, input, ip) {
  if (!['organizer', 'admin'].includes(user.role))
    throw new HttpError(403, 'Organizer access required.');
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (
    typeof input?.password !== 'string' ||
    input.password.length > 128 ||
    !verifyPassword(input.password, current.password)
  )
    throw new HttpError(401, 'Your account password is incorrect.');
  const phone = normalizePhone(input.phone),
    existing = verifiedPhone(db, user.id);
  if (existing && existing !== phone)
    throw new HttpError(
      409,
      'A verified security number cannot be replaced through profile editing. Contact support.',
    );
  return issueOtp(db, config, {
    userId: user.id,
    phone,
    purpose: 'phone_verification',
    binding: phoneBinding(current, phone),
    ip,
  });
}
export function verifyPhoneCode(db, config, user, id, code) {
  if (!['organizer', 'admin'].includes(user.role))
    throw new HttpError(403, 'Organizer access required.');
  const result = transaction(db, () => {
    const row = db
      .prepare(
        "SELECT * FROM otp_challenges WHERE id=? AND user_id=? AND purpose='phone_verification'",
      )
      .get(id, user.id);
    if (!row) return { ok: false, status: 404, error: 'Verification request not found.' };
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const existing = verifiedPhone(db, user.id);
    if (existing && existing !== row.phone)
      return { ok: false, status: 409, error: 'Security phone changed. Start again.' };
    const verified = consumeOtp(
      db,
      config,
      id,
      {
        userId: user.id,
        phone: row.phone,
        purpose: 'phone_verification',
        binding: phoneBinding(current, row.phone),
      },
      code,
    );
    if (!verified.ok) return verified;
    db.prepare(
      `INSERT INTO verified_phones VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at`,
    ).run(user.id, row.phone, new Date().toISOString());
    db.prepare('UPDATE users SET phone=? WHERE id=?').run(row.phone, user.id);
    return { ok: true };
  });
  if (!result.ok) throw new HttpError(result.status, result.error);
  return { verified: true };
}
export function otpOverview(db) {
  const since = Date.now() - 3600000;
  const counts = Object.fromEntries(
    db
      .prepare('SELECT status,COUNT(*) AS n FROM otp_challenges WHERE created_at>? GROUP BY status')
      .all(since)
      .map((r) => [r.status, r.n]),
  );
  const latencies = db
    .prepare(
      'SELECT latency_ms FROM otp_challenges WHERE created_at>? AND latency_ms IS NOT NULL ORDER BY latency_ms',
    )
    .all(since)
    .map((r) => r.latency_ms);
  const recent = db
    .prepare(
      `SELECT id,phone,purpose,status,attempts,provider_message_id,created_at,latency_ms,error_code
    FROM otp_challenges ORDER BY created_at DESC LIMIT 20`,
    )
    .all()
    .map((r) => ({ ...r, phone: maskOtpPhone(r.phone) }));
  return {
    window_minutes: 60,
    counts,
    p95_latency_ms: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
    recent,
  };
}
