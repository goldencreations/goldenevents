# Golden Events

An event-ticketing platform for Golden Creation: one form to publish an event,
one mobile-money number to start buying a ticket. Built for
`goldencreation.events`, `app.goldencreation.events`, and event subdomains.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open <http://localhost:5173/login> and choose **Open demo workspace**, or create
an organizer account. The demo account is `demo@goldencreation.events` with
password `GoldenDemo2026!`. It exists only when demo seeding is enabled.

- Dashboard: <http://app.goldencreation.localhost:5173>
- Event directory: <http://goldencreation.localhost:5173>
- Sample event: <http://niffer-party.goldencreation.localhost:5173>
- Subdomain fallback: <http://localhost:5173/e/niffer-party>

Chromium-based browsers resolve `*.localhost` to loopback without DNS changes.
Use the fallback route if your browser does not. The API runs on port 3001.
If Vite selects a different port, set `PUBLIC_ORIGIN` and `APP_ORIGIN` accordingly.
API edits require restarting `npm run dev`; frontend edits update automatically.

Data and uploads persist under `data/`, excluded from Git. Demo records are
seeded once into an empty database. Sample event names, customers, and sales are
fictional. Demo approvals never charge money. A live database must be separate
from the demo database.

## Included

- Organizer registration, login, hashed passwords, sessions, profile, password changes.
- One-page event creation/editing, draft/live/paused/cancelled states, image uploads.
- Automatic unique event names, wildcard hostname routing, public event directory.
- Ticket types, pricing, quantity controls, capacity reservations, idempotent orders.
- Demo payment approval/decline and a configurable Flutterwave Tanzania adapter.
- Server-verified payment completion, durable webhook jobs, periodic reconciliation.
- Unique QR tickets, complete event-branded PNG downloads, print, public bearer ticket and order links.
- Phone-camera QR scanner, manual admission, duplicate-admission rejection.
- Sales dashboard, orders, guests, CSV exports, revenue history, platform administration.
- Durable SMS/email/WhatsApp outbox and configurable SMTP/Twilio delivery.
- Docker, Nginx wildcard configuration, database backup command, automated checks.

## Payment and delivery modes

Copy `.env.example` to `.env` when you need configuration. Secrets stay out of Git.

`PAYMENT_DRIVER=demo` is the local default. Checkout offers explicit demo approve
and decline buttons. `disabled` prevents purchases. `flutterwave` requires
`FLW_SECRET_KEY` and `FLW_SECRET_HASH` and an approved provider account. Configure
the provider webhook at `https://goldencreation.events/api/webhooks/flutterwave`.

Flutterwave's Tanzania endpoint requires customer email, so this driver requests
an email at checkout. The phone-only design remains the default demo experience;
a provider that allows phone-only charging can be added behind the same interface.
No PIN is ever collected by this website. Payment initiation does not issue a
ticket: transaction reference, provider ID, currency, amount, and successful status
must pass server-side verification. A late payment that cannot be fulfilled is
recorded as `review`, with no ticket issued, for organizer resolution.

Official integration references:
- [Tanzania mobile money](https://developer.flutterwave.com/docs/tanzania)
- [Transaction verification](https://developer.flutterwave.com/docs/transaction-verification)
- [Webhooks](https://developer.flutterwave.com/docs/webhooks)

`DELIVERY_DRIVER=outbox` records messages locally and never claims to send them.
Set `DELIVERY_DRIVER=live` with SMTP settings for email and Twilio credentials and
senders for SMS/WhatsApp. WhatsApp is opt-in at checkout and requires an approved
template (`TWILIO_WHATSAPP_CONTENT_SID`) with variable `1` containing the ticket
notification body. Configure the template and sender in your provider account.
Missing credentials cause visible delivery failures with bounded retries; they
never silently count as successful delivery. `sent` means the sending provider
accepted the message, not that the recipient read it. Retry sends can produce a
duplicate notification if a provider accepted an earlier timed-out request.

Ticket pages remain available even if message delivery fails. Treat ticket and
order URLs as private: possession grants access to the purchased tickets.

## What is not live yet

This is a working local first version, not an approved payment business.
Provider integration code is covered with mocked verification tests but has not
been exercised against a merchant account. Before live sales, complete a provider
sandbox and real-device trial. Organizer payouts are not implemented. Live refunds
must be handled with the provider; the application refuses to mark them refunded
or claim money was returned. Demo refunds invalidate all tickets in an unused order.
Cancelled events stop admission but require separate refunds for paid orders.

Camera scanning requires HTTPS or localhost, camera permission, and a supported
device. Admission requires a connection to the server; this version does not
provide multi-device offline scanning. No account recovery or dedicated gate-staff
roles are implemented yet. Administrators can view users/events and moderate
publication; organizers only access their own events and customers.

## Verify

```sh
npm run check
npm run test:e2e
```

Browser tests use installed Google Chrome by default. To use Playwright Chromium:

```sh
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:e2e
```

The browser suite starts isolated test servers on ports 5181 and 3101, with its own
database at `data/e2e/`. It does not modify the normal development database.
Set `E2E_BASE_URL` to test an already-running server instead. Screenshots and traces
are saved under `test-results/` and excluded from Git.

Tests cover authentication/ownership, cross-origin rejection, stock reservations,
duplicate checkout/payment notifications, late payment stock conflicts, rejected
verification mismatches, cancelled events, duplicate admissions, demo refunds,
outbox delivery, publishing, successful/failed purchases, and desktop/mobile layout.

## Deploy to Contabo

1. Install Docker and Nginx on your VPS. Point DNS `@`, `app`, and `*` to its IP.
2. Clone this repository. Copy `deploy/production.env.example` to `.env.production`.
   Configure your domain and keep `PAYMENT_DRIVER=disabled` until integration is ready.
3. Run `docker compose up -d --build`. Only localhost port 3001 is exposed.
4. Install a certificate covering `goldencreation.events` and `*.goldencreation.events`.
   Configure `deploy/nginx.conf` with its paths, validate Nginx, and reload it.
   Cloudflare Origin CA certificates require proxied records and Full (strict) mode.
5. Create an administrator in the container. Set `ADMIN_PASSWORD` securely in the
   container's environment and invoke `node scripts/create-admin.js`; it prompts
   for name and email. No default production administrator is created.
6. Connect provider accounts and test the real checkout, callbacks, notification
   delivery, scanning, and reconciliation before enabling public sales.

Production startup rejects demo payments, demo seeding, and non-HTTPS origins.
Use a fresh production volume; never copy the demo database onto the VPS.
SQLite suits the initial single-VPS deployment. Use one application instance with
one durable local database; concurrent replicas need a different database/job setup.

`npm run backup` uses SQLite's backup API and copies uploaded pictures into
`data/backups/<timestamp>/`. In Docker, run `node scripts/backup.js` inside the
container. Copy backups off the VPS and verify a restore. A backup stored only on
the same VPS is not disaster recovery. Uploaded pictures are immutable, but the
file copy and database backup are not one atomic snapshot; pause uploads if you
need exact synchronization.

## Structure

`src/` contains the React/TypeScript interface; `server/` contains Express,
SQLite, authentication, event/order logic, provider adapters, and the worker.
`tests/` contains Node API/domain tests and Playwright browser flows.
`deploy/` contains VPS configuration, and `scripts/` contains operational tools.

Demo photos are downloaded from Unsplash image sources:
- `photo-1470229722913-7c0e2dbbafd3` (Niffer Party)
- `photo-1501386761578-eac5c94b800a` (Sunset Sessions)
- `photo-1513364776144-60967b0f800f` (The Creative Table)

The DM Sans font is bundled through `@fontsource-variable/dm-sans` with its
included license. Demo photos and fonts load locally rather than contacting a
third-party host during normal browsing.
