import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'goldenevents.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'organizer',
      phone TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
      starts_at TEXT NOT NULL, venue TEXT NOT NULL, city TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Music', image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('draft','published','paused','cancelled')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_types (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
      name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0),
      capacity INTEGER NOT NULL CHECK(capacity > 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL REFERENCES events(id),
      ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id), quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'TZS',
      phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', whatsapp INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','expired','refunded','review')),
      provider TEXT NOT NULL, provider_id TEXT, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
      paid_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      event_id TEXT NOT NULL REFERENCES events(id), token TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, checked_in_at TEXT, checked_in_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      channel TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT, next_attempt INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE(order_id, channel)
    );
    CREATE TABLE IF NOT EXISTS webhook_jobs (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, reference TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
    CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(ticket_type_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
  `);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
