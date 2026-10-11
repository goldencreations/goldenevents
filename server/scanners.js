import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, tokenHash } from './auth.js';
import { transaction } from './db.js';
import { HttpError } from './domain.js';

export function manageGate(db, user, eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
  if (!event || (event.owner_id !== user.id && user.role !== 'admin'))
    throw new HttpError(404, 'Event not found.');
  if (user.role === 'scanner') throw new HttpError(403, 'Scanner access only.');
  return event;
}

export function scannerEvents(db, user) {
  return db
    .prepare(
      `SELECT e.id,e.name,e.starts_at,e.venue,e.city,e.status,e.image,e.category
    FROM events e WHERE e.status!='cancelled' AND (e.owner_id=? OR EXISTS (
      SELECT 1 FROM event_scanners s WHERE s.event_id=e.id AND s.user_id=? AND s.revoked_at IS NULL
    )) ORDER BY e.starts_at`,
    )
    .all(user.id, user.id);
}

export function gateTeam(db, user, eventId) {
  manageGate(db, user, eventId);
  return {
    scanners: db
      .prepare(
        `SELECT u.id,u.name,u.email,s.source,s.created_at
      FROM event_scanners s JOIN users u ON u.id=s.user_id
      WHERE s.event_id=? AND s.revoked_at IS NULL ORDER BY s.created_at`,
      )
      .all(eventId),
    invites: db
      .prepare(
        `SELECT id,name,email,source,expires_at FROM scanner_invites
      WHERE event_id=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>?
      ORDER BY created_at`,
      )
      .all(eventId, Date.now()),
  };
}

export function inviteScanner(db, config, user, eventId, input) {
  const event = manageGate(db, user, eventId);
  if (event.status === 'cancelled') throw new HttpError(409, 'This event is cancelled.');
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), email: z.email().max(200) })
    .safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Enter a name and valid email.');
  const { name } = parsed.data,
    email = parsed.data.email.toLowerCase();
  const raw = randomBytes(32).toString('hex');
  const id = randomUUID(),
    now = new Date().toISOString();
  transaction(db, () => {
    if (
      db
        .prepare(
          `SELECT 1 FROM event_scanners s JOIN users u ON u.id=s.user_id
      WHERE s.event_id=? AND u.email=? AND s.revoked_at IS NULL`,
        )
        .get(eventId, email)
    )
      throw new HttpError(409, 'This account already has scanner access.');
    db.prepare(
      `UPDATE scanner_invites SET cancelled_at=? WHERE event_id=? AND email=?
      AND accepted_at IS NULL AND cancelled_at IS NULL`,
    ).run(now, eventId, email);
    db.prepare(
      `INSERT INTO scanner_invites
      (id,event_id,token_hash,name,email,created_by,source,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      eventId,
      tokenHash(raw),
      name,
      email,
      user.id,
      user.role === 'admin' ? 'golden' : 'organizer',
      Date.now() + 7 * 86400000,
      now,
    );
  });
  return { id, url: `${config.appOrigin}/scanner-invite/${raw}` };
}

export function scannerInvitation(db, raw) {
  const invite = db
    .prepare(
      `SELECT i.*,e.name AS event_name,e.status AS event_status
    FROM scanner_invites i JOIN events e ON e.id=i.event_id WHERE i.token_hash=?`,
    )
    .get(tokenHash(raw));
  if (!invite || invite.cancelled_at || invite.accepted_at || invite.expires_at <= Date.now())
    throw new HttpError(410, 'This scanner invitation has expired or is no longer available.');
  if (invite.event_status === 'cancelled') throw new HttpError(409, 'This event is cancelled.');
  return invite;
}

export function acceptScanner(db, raw, signedIn, input) {
  return transaction(db, () => {
    const invite = scannerInvitation(db, raw);
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(invite.email);
    if (signedIn && signedIn.email !== invite.email)
      throw new HttpError(403, 'Sign in with the email on this invitation.');
    if (user) {
      if (!signedIn || signedIn.id !== user.id)
        throw new HttpError(401, 'Sign in to your existing account to accept this invitation.');
    } else {
      const parsed = z.object({ password: z.string().min(10).max(128) }).safeParse(input);
      if (!parsed.success) throw new HttpError(400, 'Use a password of at least 10 characters.');
      user = {
        id: randomUUID(),
        name: invite.name,
        email: invite.email,
        password: hashPassword(parsed.data.password),
        role: 'scanner',
        phone: '',
        organization: '',
        created_at: new Date().toISOString(),
      };
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(user));
    }
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO event_scanners (event_id,user_id,assigned_by,source,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET
      assigned_by=excluded.assigned_by,source=excluded.source,created_at=excluded.created_at,revoked_at=NULL`,
    ).run(invite.event_id, user.id, invite.created_by, invite.source, now);
    db.prepare('UPDATE scanner_invites SET accepted_at=? WHERE id=?').run(now, invite.id);
    return user;
  });
}

export function revokeScanner(db, user, eventId, scannerId) {
  manageGate(db, user, eventId);
  const result = db
    .prepare(
      `UPDATE event_scanners SET revoked_at=?
    WHERE event_id=? AND user_id=? AND revoked_at IS NULL`,
    )
    .run(new Date().toISOString(), eventId, scannerId);
  if (!result.changes) throw new HttpError(404, 'Scanner assignment not found.');
}

export function cancelScannerInvite(db, user, eventId, id) {
  manageGate(db, user, eventId);
  const result = db
    .prepare(
      `UPDATE scanner_invites SET cancelled_at=? WHERE id=? AND event_id=?
    AND accepted_at IS NULL AND cancelled_at IS NULL`,
    )
    .run(new Date().toISOString(), id, eventId);
  if (!result.changes) throw new HttpError(404, 'Pending invitation not found.');
}
