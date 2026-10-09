import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { eventUrl } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const reservedSlugs = new Set([
  'app',
  'www',
  'admin',
  'api',
  'mail',
  'support',
  'tickets',
  'ticket',
  'dashboard',
  'uploads',
  'localhost',
]);
export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-$/, '');
}
export function availableSlug(db, name, excludeId = '') {
  const base = slugify(name) || 'event';
  let slug = reservedSlugs.has(base) ? `${base}-event` : base;
  let n = 2;
  while (db.prepare('SELECT id FROM events WHERE slug = ? AND id != ?').get(slug, excludeId))
    slug = `${base}-${n++}`;
  return slug;
}

export function normalizePhone(value) {
  let phone = String(value).replace(/[\s()-]/g, '');
  if (/^[67]\d{8}$/.test(phone)) phone = `+255${phone}`;
  if (/^0[67]\d{8}$/.test(phone)) phone = `+255${phone.slice(1)}`;
  if (/^255[67]\d{8}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+255[67]\d{8}$/.test(phone))
    throw new HttpError(400, 'Enter a valid Tanzanian mobile number, such as 0712 345 678.');
  return phone;
}

const ticketSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  price: z.number().int().min(100).max(10000000),
  capacity: z.number().int().min(1).max(100000),
});
export const eventSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(4000),
  starts_at: z.string().datetime({ offset: true }),
  venue: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  category: z.enum(['Music', 'Nightlife', 'Community', 'Business', 'Arts', 'Sports']),
  image: z
    .string()
    .max(1000)
    .refine(
      (v) =>
        v === '' ||
        /^\/uploads\/[a-zA-Z0-9-]+\.webp$/.test(v) ||
        /^https:\/\/images\.unsplash\.com\//.test(v),
      'Use an uploaded image.',
    ),
  status: z.enum(['draft', 'published', 'paused', 'cancelled']),
  tickets: z.array(ticketSchema).min(1).max(8),
});

export function cleanEvent(db, event, config, privateData = false) {
  const types = db
    .prepare('SELECT * FROM ticket_types WHERE event_id = ? ORDER BY price')
    .all(event.id)
    .map((type) => {
      const occupied = db
        .prepare(
          `SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND (status IN ('paid','review') OR (status='pending' AND expires_at>?))`,
        )
        .get(type.id, Date.now()).n;
      return { ...type, available: Math.max(0, type.capacity - occupied) };
    });
  const { owner_id, ...safe } = event;
  const stats = privateData
    ? db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN status='paid' THEN quantity ELSE 0 END),0) AS sold, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS revenue FROM orders WHERE event_id=?`,
        )
        .get(event.id)
    : {};
  return {
    ...safe,
    tickets: types,
    url: eventUrl(config, event.slug),
    ...stats,
    ...(privateData
      ? {
          checked_in: db
            .prepare(
              'SELECT COUNT(*) AS n FROM tickets WHERE event_id=? AND checked_in_at IS NOT NULL',
            )
            .get(event.id).n,
        }
      : {}),
  };
}

export function saveEvent(db, owner, input, eventId) {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpError(
      400,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const data = parsed.data;
  const old = eventId
    ? db.prepare('SELECT * FROM events WHERE id=? AND owner_id=?').get(eventId, owner)
    : null;
  if (eventId && !old) throw new HttpError(404, 'Event not found.');
  if (!old && new Date(data.starts_at).getTime() <= Date.now())
    throw new HttpError(400, 'Choose a future event date.');
  const id = old?.id || randomUUID();
  return transaction(db, () => {
    if (old) {
      db.prepare(
        'UPDATE events SET name=?, description=?, starts_at=?, venue=?, city=?, category=?, image=?, status=? WHERE id=?',
      ).run(
        data.name,
        data.description,
        data.starts_at,
        data.venue,
        data.city,
        data.category,
        data.image,
        data.status,
        id,
      );
      const existing = db.prepare('SELECT * FROM ticket_types WHERE event_id=?').all(id);
      const seen = new Set();
      for (const type of data.tickets) {
        const prev = type.id ? existing.find((t) => t.id === type.id) : undefined;
        if (type.id && (!prev || seen.has(type.id)))
          throw new HttpError(400, 'Invalid or duplicate ticket type.');
        if (prev) {
          seen.add(prev.id);
          const occupied = db
            .prepare(
              "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND (status IN ('paid','review') OR (status='pending' AND expires_at>?))",
            )
            .get(prev.id, Date.now()).n;
          if (type.capacity < occupied)
            throw new HttpError(
              400,
              `${type.name} capacity cannot be below sold and reserved tickets.`,
            );
          db.prepare('UPDATE ticket_types SET name=?,price=?,capacity=? WHERE id=?').run(
            type.name,
            type.price,
            type.capacity,
            prev.id,
          );
        } else
          db.prepare('INSERT INTO ticket_types VALUES (?,?,?,?,?)').run(
            randomUUID(),
            id,
            type.name,
            type.price,
            type.capacity,
          );
      }
      for (const type of existing.filter((t) => !seen.has(t.id))) {
        if (db.prepare('SELECT id FROM orders WHERE ticket_type_id=?').get(type.id))
          throw new HttpError(400, 'A ticket type with orders cannot be removed.');
        db.prepare('DELETE FROM ticket_types WHERE id=?').run(type.id);
      }
    } else {
      db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        id,
        owner,
        data.name,
        availableSlug(db, data.name),
        data.description,
        data.starts_at,
        data.venue,
        data.city,
        data.category,
        data.image,
        data.status,
        new Date().toISOString(),
      );
      for (const type of data.tickets)
        db.prepare('INSERT INTO ticket_types VALUES (?,?,?,?,?)').run(
          randomUUID(),
          id,
          type.name,
          type.price,
          type.capacity,
        );
    }
    return db.prepare('SELECT * FROM events WHERE id=?').get(id);
  });
}

export function reserveOrder(db, input, config) {
  const schema = z.object({
    event_id: z.string(),
    ticket_type_id: z.string(),
    quantity: z.number().int().min(1).max(10),
    phone: z.string(),
    email: z.union([z.email(), z.literal('')]).default(''),
    whatsapp: z.boolean().default(false),
    idempotency_key: z.string().min(20).max(100),
  });
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Check your ticket selection and contact details.');
  const data = result.data;
  const phone = normalizePhone(data.phone);
  if (config.paymentDriver === 'disabled')
    throw new HttpError(503, 'Ticket payments are not available yet.');
  if (config.paymentDriver === 'flutterwave' && !data.email)
    throw new HttpError(400, 'An email address is required by the payment provider.');
  return transaction(db, () => {
    const duplicate = db
      .prepare('SELECT * FROM orders WHERE idempotency_key=?')
      .get(data.idempotency_key);
    if (duplicate) {
      if (
        duplicate.phone !== phone ||
        duplicate.event_id !== data.event_id ||
        duplicate.ticket_type_id !== data.ticket_type_id ||
        duplicate.quantity !== data.quantity ||
        duplicate.email !== data.email ||
        !!duplicate.whatsapp !== data.whatsapp
      )
        throw new HttpError(409, 'This checkout was already used for another selection.');
      return { order: duplicate, created: false };
    }
    const event = db
      .prepare("SELECT * FROM events WHERE id=? AND status='published'")
      .get(data.event_id);
    if (!event || new Date(event.starts_at).getTime() <= Date.now())
      throw new HttpError(409, 'This event is not accepting ticket purchases.');
    const type = db
      .prepare('SELECT * FROM ticket_types WHERE id=? AND event_id=?')
      .get(data.ticket_type_id, data.event_id);
    if (!type) throw new HttpError(400, 'Ticket type not found.');
    const used = db
      .prepare(
        "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND (status IN ('paid','review') OR (status='pending' AND expires_at>?))",
      )
      .get(type.id, Date.now()).n;
    if (used + data.quantity > type.capacity)
      throw new HttpError(
        409,
        'There are not enough tickets left. Please choose a smaller quantity.',
      );
    const order = {
      id: randomUUID(),
      token: randomBytes(24).toString('hex'),
      reference: `GE-${randomBytes(6).toString('hex').toUpperCase()}`,
      idempotency_key: data.idempotency_key,
      event_id: event.id,
      ticket_type_id: type.id,
      quantity: data.quantity,
      unit_price: type.price,
      amount: type.price * data.quantity,
      currency: 'TZS',
      phone,
      email: data.email,
      whatsapp: Number(data.whatsapp),
      status: 'pending',
      provider: config.paymentDriver,
      provider_id: null,
      created_at: new Date().toISOString(),
      expires_at: Date.now() + 10 * 60 * 1000,
      paid_at: null,
    };
    db.prepare(
      `INSERT INTO orders (${Object.keys(order).join(',')}) VALUES (${Object.keys(order)
        .map(() => '?')
        .join(',')})`,
    ).run(...Object.values(order));
    return { order, created: true };
  });
}

export function completeOrder(db, orderId, config) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (['paid', 'refunded', 'review'].includes(order.status)) return order;
    // Late verified payments must not oversell stock: retain a review record for resolution.
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(order.event_id);
    const type = db.prepare('SELECT * FROM ticket_types WHERE id=?').get(order.ticket_type_id);
    const occupied = db
      .prepare(
        "SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_type_id=? AND id!=? AND (status IN ('paid','review') OR (status='pending' AND expires_at>?))",
      )
      .get(type.id, order.id, Date.now()).n;
    if (event.status === 'cancelled' || occupied + order.quantity > type.capacity) {
      db.prepare("UPDATE orders SET status='review', paid_at=? WHERE id=?").run(
        new Date().toISOString(),
        order.id,
      );
      return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    }
    db.prepare("UPDATE orders SET status='paid', paid_at=? WHERE id=?").run(
      new Date().toISOString(),
      order.id,
    );
    for (let i = 0; i < order.quantity; i++)
      db.prepare(
        'INSERT INTO tickets (id,order_id,event_id,token,code,created_at) VALUES (?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        order.id,
        order.event_id,
        randomBytes(24).toString('hex'),
        `GE-${randomBytes(4).toString('hex').toUpperCase()}`,
        new Date().toISOString(),
      );
    const link = `${config.publicOrigin}/order/${order.token}`;
    const body = `Your ${event.name} ticket${order.quantity > 1 ? 's' : ''}: ${link} | ${event.venue}, ${event.city}. Ref ${order.reference}`;
    const channels = [
      ['sms', order.phone],
      ...(order.email ? [['email', order.email]] : []),
      ...(order.whatsapp ? [['whatsapp', order.phone]] : []),
    ];
    for (const [channel, recipient] of channels)
      db.prepare(
        'INSERT OR IGNORE INTO deliveries (id,order_id,channel,recipient,body,created_at) VALUES (?,?,?,?,?,?)',
      ).run(randomUUID(), order.id, channel, recipient, body, new Date().toISOString());
    return db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  });
}

export function checkIn(db, user, eventId, rawCode) {
  const event = db.prepare('SELECT * FROM events WHERE id=? AND owner_id=?').get(eventId, user.id);
  if (!event) throw new HttpError(404, 'Event not found.');
  if (event.status === 'cancelled') throw new HttpError(409, 'This event is cancelled.');
  const code = String(rawCode || '')
    .trim()
    .split('/')
    .pop();
  return transaction(db, () => {
    const ticket = db
      .prepare(
        'SELECT t.*,o.status,o.phone,tt.name AS ticket_type FROM tickets t JOIN orders o ON o.id=t.order_id JOIN ticket_types tt ON tt.id=o.ticket_type_id WHERE t.token=? OR t.code=?',
      )
      .get(code, code?.toUpperCase());
    if (!ticket || ticket.event_id !== eventId)
      throw new HttpError(404, 'This ticket does not belong to this event.');
    if (ticket.status !== 'paid') throw new HttpError(409, 'This ticket is not valid for entry.');
    if (ticket.checked_in_at)
      throw new HttpError(
        409,
        `Already admitted at ${new Date(ticket.checked_in_at).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })}.`,
      );
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE tickets SET checked_in_at=?,checked_in_by=? WHERE id=? AND checked_in_at IS NULL',
    ).run(now, user.id, ticket.id);
    return {
      code: ticket.code,
      ticket_type: ticket.ticket_type,
      checked_in_at: now,
      phone: ticket.phone,
    };
  });
}
