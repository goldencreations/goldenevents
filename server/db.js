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
    CREATE TABLE IF NOT EXISTS event_scanners (
      event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id),
      assigned_by TEXT NOT NULL REFERENCES users(id), source TEXT NOT NULL,
      created_at TEXT NOT NULL, revoked_at TEXT, PRIMARY KEY(event_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scanner_user ON event_scanners(user_id,revoked_at);
    CREATE TABLE IF NOT EXISTS scanner_invites (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
      token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id), source TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL,
      accepted_at TEXT, cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scanner_invites_event ON scanner_invites(event_id,email);
    CREATE TABLE IF NOT EXISTS scanner_bootstrap (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
  `);
  // Additive migrations preserve tickets already issued by older versions.
  transaction(db, () => {
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(tickets)')
        .all()
        .map((c) => c.name),
    );
    for (const name of ['holder_name', 'holder_phone', 'claimed_at']) {
      if (!columns.has(name)) db.exec(`ALTER TABLE tickets ADD COLUMN ${name} TEXT`);
    }
    const jobColumns = new Set(
      db
        .prepare('PRAGMA table_info(webhook_jobs)')
        .all()
        .map((c) => c.name),
    );
    if (!jobColumns.has('provider'))
      db.exec("ALTER TABLE webhook_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'flutterwave'");
    const orderColumns = new Set(
      db
        .prepare('PRAGMA table_info(orders)')
        .all()
        .map((c) => c.name),
    );
    if (!orderColumns.has('provider_status'))
      db.exec('ALTER TABLE orders ADD COLUMN provider_status TEXT');
    if (!orderColumns.has('platform_fee_bps'))
      db.exec('ALTER TABLE orders ADD COLUMN platform_fee_bps INTEGER');
    if (!orderColumns.has('platform_fee'))
      db.exec('ALTER TABLE orders ADD COLUMN platform_fee INTEGER');
    db.exec(`
      CREATE TABLE IF NOT EXISTS verified_phones (
        user_id TEXT PRIMARY KEY REFERENCES users(id), phone TEXT NOT NULL, verified_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS otp_challenges (
        id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), phone TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('phone_verification','payout','ticket_claim')),
        binding_hash TEXT NOT NULL, code_hash TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','sent','verified','expired','locked','superseded','delivery_failed')),
        attempts INTEGER NOT NULL DEFAULT 0, provider_message_id TEXT,
        created_at INTEGER NOT NULL, sent_at INTEGER, expires_at INTEGER NOT NULL, verified_at INTEGER,
        requester_ip_hash TEXT NOT NULL, error_code TEXT, latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_challenges(phone,purpose,created_at);
      CREATE INDEX IF NOT EXISTS idx_otp_ip ON otp_challenges(requester_ip_hash,created_at);
      CREATE INDEX IF NOT EXISTS idx_otp_owner ON otp_challenges(user_id,purpose,created_at);
      CREATE TABLE IF NOT EXISTS ecofy_collection_finance (
        order_id TEXT PRIMARY KEY REFERENCES orders(id), fee INTEGER NOT NULL CHECK(fee >= 0),
        net INTEGER NOT NULL CHECK(net >= 0), matured_at TEXT, verified_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ecofy_maturations (
        payment_id TEXT PRIMARY KEY, net INTEGER NOT NULL CHECK(net >= 0), observed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ecofy_wallet (
        id INTEGER PRIMARY KEY CHECK(id=1), available INTEGER NOT NULL,
        pending INTEGER NOT NULL, reserved INTEGER NOT NULL, checked_at INTEGER NOT NULL,
        before_cursor TEXT
      );
      CREATE TABLE IF NOT EXISTS payout_quotes (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), driver TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0), destination_type TEXT NOT NULL,
        channel TEXT NOT NULL, account TEXT NOT NULL, account_name TEXT, external_id TEXT UNIQUE,
        fee INTEGER, total INTEGER, expires_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('quoting','ready','failed')),
        next_attempt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payout_quote_user ON payout_quotes(user_id,created_at);
      CREATE TABLE IF NOT EXISTS order_settlements (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        provider_fee INTEGER NOT NULL CHECK(provider_fee >= 0),
        net INTEGER NOT NULL CHECK(net >= 0),
        reference TEXT NOT NULL, settled_by TEXT NOT NULL REFERENCES users(id),
        settled_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payout_challenges (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0), phone TEXT NOT NULL,
        network TEXT NOT NULL, recipient_name TEXT NOT NULL, email TEXT NOT NULL,
        password_fingerprint TEXT NOT NULL, otp_hash TEXT NOT NULL, mode TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('sending','ready','failed','superseded','consumed')),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payout_challenges_user ON payout_challenges(user_id,created_at);
      CREATE TABLE IF NOT EXISTS payout_requests (
        id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id),
        challenge_id TEXT NOT NULL UNIQUE REFERENCES payout_challenges(id),
        amount INTEGER NOT NULL CHECK(amount > 0), currency TEXT NOT NULL CHECK(currency='TZS'),
        phone TEXT NOT NULL, network TEXT NOT NULL, recipient_name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('demo','manual')),
        status TEXT NOT NULL CHECK(status IN ('requested','processing','paid','rejected','cancelled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        reviewed_by TEXT REFERENCES users(id), note TEXT NOT NULL DEFAULT '',
        transfer_reference TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_payout_user ON payout_requests(user_id,status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_transfer ON payout_requests(transfer_reference)
        WHERE transfer_reference IS NOT NULL;
      CREATE TABLE IF NOT EXISTS payout_audit (
        id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES payout_requests(id),
        actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
        note TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payout_jobs (
        payout_id TEXT PRIMARY KEY REFERENCES payout_requests(id), quote_id TEXT NOT NULL REFERENCES payout_quotes(id),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        outcome_unknown INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_job_quote ON payout_jobs(quote_id);
      CREATE TABLE IF NOT EXISTS health_probe (
        id INTEGER PRIMARY KEY CHECK(id=1), checked_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS whatsapp_ticket_messages (
        delivery_id TEXT NOT NULL REFERENCES deliveries(id),
        ticket_id TEXT NOT NULL REFERENCES tickets(id), ticket_token TEXT NOT NULL,
        media_id TEXT, message_id TEXT, PRIMARY KEY(delivery_id,ticket_id)
      );
      CREATE TABLE IF NOT EXISTS health_samples (
        checked_at INTEGER PRIMARY KEY, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS health_incidents (
        id TEXT PRIMARY KEY, component TEXT NOT NULL, label TEXT NOT NULL,
        started_at INTEGER NOT NULL, resolved_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_health_incident_open
        ON health_incidents(component) WHERE resolved_at IS NULL;
      CREATE TABLE IF NOT EXISTS ecofy_jobs (
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ecofy_jobs_due ON ecofy_jobs(next_attempt);
      CREATE TABLE IF NOT EXISTS ticket_invites (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id),
        token TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','claimed','cancelled')),
        expires_at INTEGER NOT NULL, otp_hash TEXT, otp_expires_at INTEGER, otp_mode TEXT,
        otp_attempts INTEGER NOT NULL DEFAULT 0, total_attempts INTEGER NOT NULL DEFAULT 0,
        last_sent INTEGER, claim_key TEXT, claimed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_pending
        ON ticket_invites(ticket_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS ticket_verification_sends (
        id TEXT PRIMARY KEY, phone_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_verification_phone
        ON ticket_verification_sends(phone_hash, created_at);
    `);
    for (const [table, fields] of Object.entries({
      payout_challenges: {
        quote_id: 'TEXT REFERENCES payout_quotes(id)',
        payout_fee: 'INTEGER NOT NULL DEFAULT 0',
        otp_challenge_id: 'TEXT REFERENCES otp_challenges(id)',
        otp_phone: 'TEXT',
      },
      ticket_invites: { otp_challenge_id: 'TEXT REFERENCES otp_challenges(id)' },
      payout_requests: {
        driver: "TEXT NOT NULL DEFAULT 'manual'",
        payout_fee: 'INTEGER NOT NULL DEFAULT 0',
        provider_id: 'TEXT',
      },
    })) {
      const present = new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((c) => c.name),
      );
      for (const [name, type] of Object.entries(fields))
        if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_provider_id ON payout_requests(provider_id) WHERE provider_id IS NOT NULL',
    );
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_consumed_quote ON payout_challenges(quote_id) WHERE status='consumed' AND quote_id IS NOT NULL",
    );
  });
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
