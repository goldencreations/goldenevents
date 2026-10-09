import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { tokenHash, safeEqual } from './auth.js';
import { HttpError, normalizePhone } from './domain.js';
import { sendTwilio } from './providers.js';

export function sharingMode(config) {
  if (!config.production && config.paymentDriver === 'demo' && config.deliveryDriver === 'outbox')
    return 'demo';
  return config.deliveryDriver !== 'outbox' &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_SMS_FROM
    ? 'sms'
    : 'disabled';
}

export const maskedPhone = (phone) => `+255 *** **${phone.slice(-3)}`;

function assertAvailable(ticket) {
  if (ticket.order_status !== 'paid' || ticket.event_status === 'cancelled')
    throw new HttpError(409, 'This ticket is no longer available.');
  if (ticket.checked_in_at) throw new HttpError(409, 'An admitted ticket cannot be handed over.');
}

function buyerTicket(db, orderToken, ticketId) {
  const row = db
    .prepare(
      `SELECT t.*,o.status AS order_status,e.status AS event_status
    FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id
    WHERE o.token=? AND t.id=?`,
    )
    .get(orderToken, ticketId);
  if (!row) throw new HttpError(404, 'Ticket not found in this booking.');
  assertAvailable(row);
  if (row.claimed_at) throw new HttpError(409, 'This ticket already belongs to its recipient.');
  return row;
}

export function bookingTickets(db, orderId, config) {
  return db
    .prepare('SELECT * FROM tickets WHERE order_id=? ORDER BY created_at,id')
    .all(orderId)
    .map((ticket) => {
      const invite = db
        .prepare(
          `SELECT * FROM ticket_invites
        WHERE ticket_id=? AND status='pending' AND expires_at>?`,
        )
        .get(ticket.id, Date.now());
      return {
        id: ticket.id,
        checked_in_at: ticket.checked_in_at,
        holder_name: ticket.holder_name || '',
        holder_phone: ticket.holder_phone ? maskedPhone(ticket.holder_phone) : '',
        claimed: !!ticket.claimed_at,
        // The booking owner must never receive a recipient's new admission credentials.
        ...(!ticket.claimed_at ? { token: ticket.token, code: ticket.code } : {}),
        invite: invite
          ? {
              name: invite.name,
              phone: maskedPhone(invite.phone),
              expires_at: invite.expires_at,
              url: `${config.publicOrigin}/claim/${invite.token}`,
            }
          : null,
      };
    });
}

export function createInvite(db, config, orderToken, ticketId, input) {
  if (sharingMode(config) === 'disabled')
    throw new HttpError(
      503,
      'Ticket handover needs SMS verification. Messaging is not configured yet.',
    );
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), phone: z.string().max(30) })
    .safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Enter your friend's name and mobile number.");
  const phone = normalizePhone(parsed.data.phone);
  return transaction(db, () => {
    const ticket = buyerTicket(db, orderToken, ticketId);
    db.prepare(
      "UPDATE ticket_invites SET status='cancelled',otp_hash=NULL WHERE ticket_id=? AND status='pending'",
    ).run(ticket.id);
    const token = randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
    db.prepare(
      `INSERT INTO ticket_invites
      (id,ticket_id,token,name,phone,status,expires_at,created_at) VALUES (?,?,?,?,?,'pending',?,?)`,
    ).run(
      randomUUID(),
      ticket.id,
      token,
      parsed.data.name,
      phone,
      expiresAt,
      new Date().toISOString(),
    );
    return { url: `${config.publicOrigin}/claim/${token}`, phone, name: parsed.data.name };
  });
}

export function cancelInvite(db, orderToken, ticketId) {
  transaction(db, () => {
    buyerTicket(db, orderToken, ticketId);
    db.prepare(
      "UPDATE ticket_invites SET status='cancelled',otp_hash=NULL WHERE ticket_id=? AND status='pending'",
    ).run(ticketId);
  });
}

export function pendingInvite(db, token) {
  const row = db
    .prepare(
      `SELECT i.*,t.checked_in_at,t.event_id,t.token AS ticket_token,
    o.status AS order_status,e.status AS event_status,e.name AS event_name,
    tt.name AS ticket_type FROM ticket_invites i JOIN tickets t ON t.id=i.ticket_id
    JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id
    JOIN ticket_types tt ON tt.id=o.ticket_type_id WHERE i.token=?`,
    )
    .get(token);
  if (!row) throw new HttpError(404, 'Invitation not found.');
  if (row.status !== 'pending')
    throw new HttpError(410, 'This invitation has already been claimed or cancelled.');
  if (row.expires_at <= Date.now())
    throw new HttpError(410, 'This invitation has expired. Ask the buyer for a new one.');
  assertAvailable(row);
  return row;
}

export async function requestClaimCode(db, config, token) {
  const mode = sharingMode(config);
  if (mode === 'disabled')
    throw new HttpError(503, 'SMS verification is unavailable. Please try again later.');
  const code = String(randomInt(100000, 1000000));
  const hash = tokenHash(`${token}:${code}`);
  const invite = transaction(db, () => {
    const row = pendingInvite(db, token);
    const now = Date.now();
    if (row.total_attempts >= 10)
      throw new HttpError(429, 'Too many incorrect codes. Ask the buyer for a new invitation.');
    if (row.last_sent && now - row.last_sent < 60000)
      throw new HttpError(429, 'Wait one minute before requesting another code.');
    const phoneHash = tokenHash(row.phone);
    const recent = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ticket_verification_sends
      WHERE phone_hash=? AND created_at>?`,
      )
      .get(phoneHash, now - 15 * 60000).count;
    const daily = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ticket_verification_sends
      WHERE phone_hash=? AND created_at>?`,
      )
      .get(phoneHash, now - 86400000).count;
    if (recent >= 3 || daily >= 10)
      throw new HttpError(429, 'Too many verification messages. Please try again later.');
    db.prepare(
      `UPDATE ticket_invites SET otp_hash=?,otp_expires_at=?,otp_mode=?,otp_attempts=0,last_sent=? WHERE id=?`,
    ).run(hash, now + 5 * 60000, mode, now, row.id);
    db.prepare('INSERT INTO ticket_verification_sends VALUES (?,?,?)').run(
      randomUUID(),
      phoneHash,
      now,
    );
    db.prepare('DELETE FROM ticket_verification_sends WHERE created_at<?').run(now - 86400000);
    return row;
  });
  if (mode === 'sms') {
    try {
      await sendTwilio({
        channel: 'sms',
        recipient: invite.phone,
        body: `Your Golden Events ticket claim code is ${code}. It expires in 5 minutes. Never share this code.`,
      });
    } catch {
      db.prepare('UPDATE ticket_invites SET otp_hash=NULL WHERE id=? AND otp_hash=?').run(
        invite.id,
        hash,
      );
      throw new HttpError(
        502,
        'Could not send the verification code. Please try again in a minute.',
      );
    }
  }
  return { phone: maskedPhone(invite.phone), ...(mode === 'demo' ? { demo_code: code } : {}) };
}

export function claimTicket(db, config, token, input) {
  const parsed = z
    .object({ code: z.string().regex(/^\d{6}$/), claim_key: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Enter the six-digit verification code.');
  const result = transaction(db, () => {
    const existing = db.prepare('SELECT * FROM ticket_invites WHERE token=?').get(token);
    if (existing?.otp_mode === 'demo' && sharingMode(config) !== 'demo')
      throw new HttpError(410, 'Request a new verification code.');
    // A lost HTTP response can be retried by the same claimant without rotating again.
    if (
      existing?.status === 'claimed' &&
      existing.otp_expires_at > Date.now() &&
      safeEqual(existing.claim_key, tokenHash(parsed.data.claim_key)) &&
      safeEqual(existing.otp_hash, tokenHash(`${token}:${parsed.data.code}`))
    ) {
      const ticket = db.prepare('SELECT token FROM tickets WHERE id=?').get(existing.ticket_id);
      return { token: ticket.token };
    }
    const invite = pendingInvite(db, token);
    if (!invite.otp_hash || invite.otp_expires_at <= Date.now())
      throw new HttpError(410, 'Your verification code has expired. Request a new code.');
    if (invite.otp_attempts >= 5 || invite.total_attempts >= 10)
      throw new HttpError(429, 'Too many incorrect codes. Request a new code or invitation.');
    if (!safeEqual(invite.otp_hash, tokenHash(`${token}:${parsed.data.code}`))) {
      db.prepare(
        'UPDATE ticket_invites SET otp_attempts=otp_attempts+1,total_attempts=total_attempts+1 WHERE id=?',
      ).run(invite.id);
      return { error: 'That verification code is incorrect.' };
    }
    const ticketToken = randomBytes(24).toString('hex');
    const code = `GE-${randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE tickets SET token=?,code=?,holder_name=?,holder_phone=?,claimed_at=? WHERE id=?`,
    ).run(ticketToken, code, invite.name, invite.phone, now, invite.ticket_id);
    db.prepare(
      "UPDATE ticket_invites SET status='claimed',claim_key=?,claimed_at=? WHERE id=?",
    ).run(tokenHash(parsed.data.claim_key), now, invite.id);
    return { token: ticketToken };
  });
  if (result.error) throw new HttpError(400, result.error);
  return result;
}
