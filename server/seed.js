import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { saveEvent, reserveOrder, completeOrder } from './domain.js';

export const photos = {
  party:
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1600&q=85',
  music:
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85',
  community:
    'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=85',
  arts: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=1200&q=85',
};

export function seedDemo(db, config) {
  if (!config.seedDemo || db.prepare('SELECT id FROM users LIMIT 1').get()) return;
  const owner = randomUUID();
  db.prepare(
    'INSERT INTO users (id,name,email,password,role,phone,organization,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    owner,
    'Alex Morgan',
    process.env.DEMO_EMAIL || 'demo@goldencreation.events',
    hashPassword(process.env.DEMO_PASSWORD || 'GoldenDemo2026!'),
    'admin',
    '+255712345678',
    'Golden Creation',
    new Date().toISOString(),
  );
  const inDays = (n, hour = 18) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + n);
    date.setUTCHours(hour - 3, 0, 0, 0);
    return date.toISOString();
  };
  const seeds = [
    {
      name: 'Niffer Party',
      description:
        'A night for good music and your favorite people. Join Niffer and friends for live DJ sets, dancing, and a little Dar magic. Doors open at 8 PM. Bring your ticket and come ready for a good night.',
      starts_at: inDays(8, 20),
      venue: 'Warehouse 7, Masaki',
      city: 'Dar es Salaam',
      category: 'Nightlife',
      image: photos.party,
      status: 'published',
      tickets: [
        { name: 'Regular', price: 20000, capacity: 250 },
        { name: 'VIP', price: 50000, capacity: 50 },
      ],
    },
    {
      name: 'Sunset Sessions',
      description:
        'Live music by the ocean. An intimate evening of acoustic sets, local artists, and golden-hour conversations. Your ticket includes entry; refreshments are available at the venue.',
      starts_at: inDays(15, 17),
      venue: 'Coco Beach',
      city: 'Dar es Salaam',
      category: 'Music',
      image: photos.music,
      status: 'published',
      tickets: [{ name: 'General admission', price: 15000, capacity: 150 }],
    },
    {
      name: 'The Creative Table',
      description:
        'An afternoon of ideas, conversations, and new connections for artists, designers, and makers. Meet the people shaping our city over talks and an open studio session.',
      starts_at: inDays(22, 14),
      venue: 'Nafasi Art Space',
      city: 'Dar es Salaam',
      category: 'Arts',
      image: photos.arts,
      status: 'draft',
      tickets: [{ name: 'General admission', price: 10000, capacity: 80 }],
    },
  ];
  const events = seeds.map((data) => saveEvent(db, owner, data));
  for (let i = 0; i < 24; i++) {
    const event = events[i % 4 === 0 ? 1 : 0];
    const types = db
      .prepare('SELECT * FROM ticket_types WHERE event_id=? ORDER BY price')
      .all(event.id);
    const type = types[i % 7 === 0 && types.length > 1 ? 1 : 0];
    const { order } = reserveOrder(
      db,
      {
        event_id: event.id,
        ticket_type_id: type.id,
        quantity: i % 3 === 0 ? 2 : 1,
        phone: `+25571${String(1000000 + i).padStart(7, '0')}`,
        email: i % 4 === 0 ? `guest${i}@example.com` : '',
        whatsapp: i % 5 === 0,
        idempotency_key: randomUUID(),
      },
      config,
    );
    completeOrder(db, order.id, config);
    const date = new Date(Date.now() - (i % 7) * 86400000 - i * 400000).toISOString();
    db.prepare('UPDATE orders SET created_at=?,paid_at=? WHERE id=?').run(date, date, order.id);
  }
}
