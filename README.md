# Golden Events

An event-ticketing platform for Golden Creation: one form to publish an event,
one mobile-money number to start buying a ticket. Built for
`goldencreations.events`, `app.goldencreations.events`, and event subdomains.

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
- Individual ticket invitations with phone verification, recipient-only credentials, and independent admission.
- Phone-camera QR scanner, manual admission, duplicate-admission rejection.
- Sales dashboard, orders, guests, CSV exports, revenue history, platform administration.
- Durable SMS/email/WhatsApp outbox and configurable SMTP/Twilio delivery.
- Docker, Nginx wildcard configuration, database backup command, automated checks.

## Payment and delivery modes

Copy `.env.example` to `.env` when you need configuration. Secrets stay out of Git.

`PAYMENT_DRIVER=demo` is the local default. Checkout offers explicit demo approve
and decline buttons. `disabled` prevents purchases. `flutterwave` requires
`FLW_SECRET_KEY` and `FLW_SECRET_HASH` and an approved provider account. Configure
the provider webhook at `https://goldencreations.events/api/webhooks/flutterwave`.

Flutterwave's Tanzania endpoint requires customer email, so this driver requests
an email at checkout. The phone-only design remains the default demo experience;
Ecofy supports phone-only charging without requiring an email.
No PIN is ever collected by this website. Payment initiation does not issue a
ticket: transaction reference, provider ID, currency, amount, and successful status
must pass server-side verification. A late payment that cannot be fulfilled is
recorded as `review`, with no ticket issued, for organizer resolution.

Official integration references:
- [Tanzania mobile money](https://developer.flutterwave.com/docs/tanzania)
- [Transaction verification](https://developer.flutterwave.com/docs/transaction-verification)
- [Webhooks](https://developer.flutterwave.com/docs/webhooks)

### Ecofy Mobile Money

`PAYMENT_DRIVER=ecofy` requires `ECOFY_API_KEY` and `ECOFY_WEBHOOK_SECRET`.
`ECOFY_BASE_URL` defaults to `https://ecofypay.ecofy.co.tz`, the current origin
provided by the merchant. The supplied [Collection API contract](https://claude.ai/code/artifact/6fd4d5ae-3f52-41bd-a529-1354659dfb67)
shows an older origin; confirm the contract with Ecofy before public sales.
Production requires an activated account and `sk_live_` key; local integration
testing can use a test key. Never expose either secret to the frontend or Git.

Register `https://goldencreations.events/api/webhooks/ecofy` using Ecofy's
`POST /v1/webhook-endpoints` with a stable `Idempotency-Key`. Save the returned
one-time `secret` privately as `ECOFY_WEBHOOK_SECRET`. The app validates HMAC on
the raw bytes with a five-minute timestamp tolerance, queues duplicate-safe jobs,
and confirms each notification with `GET /v1/payments/{id}` before issuing tickets.
Live callbacks observed on 2026-10-09 use `{ id, type, created_at, data }`, with
the payment in `data`. The handler accepts that signed event envelope and the
bare payment format described in the supplied contract. Event type and payment
status must match; signed non-payment events are acknowledged without fulfilment.

Amounts are whole TZS, never multiplied by 100. Each booking has one stable
reference and provider idempotency key. Persistent jobs retry unclear requests
with exactly the same payload and key, surviving server restarts. The checkout
countdown uses the provider's `expires_at` once known. Only `succeeded` fulfils;
failed/cancelled payments do not issue tickets. Retries never create a new attempt.
Missing responses remain uncertain, not failed. After the local reservation ends,
recovery uses read-only paginated payment lookup rather than initiating a new
charge. Automatic reconciliation covers the first 24 hours and at most 1,000
listed payments per lookup; unresolved bookings need provider/manual review.

This integration handles mobile-money collections only, not QR payment checkout,
refunds, organizer payouts, or wallet withdrawals. Payment keys can move money:
keep them only in the mode-600 VPS environment file. Do not enable public sales
until a small authorized payment, decline, timeout/retry, and webhook delivery
have been tested against Ecofy. Mock tests do not certify the live payment rail.

On the VPS, enter only the API key privately in `.env.production` using `nano`.
Keep `PAYMENT_DRIVER=disabled`. Then prepare the webhook without printing secrets:

```sh
docker compose --project-directory /opt/goldenevents run --rm --no-deps --user root \
  -v /opt/goldenevents:/setup events \
  node scripts/configure-ecofy.js /setup/.env.production
```

This verifies the active live merchant, registers an all-events webhook, and
atomically saves its one-time secret to the private environment file. It creates
no payments and does not enable checkout. Repeating setup uses a stable webhook
idempotency key. If interrupted after registration, retry with the same settings.

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
order URLs as private: possession grants access to tickets still held by the buyer.

## Buy Together, Arrive Separately

Buy four tickets in one checkout, keep your own, and use the send icon beside each
remaining ticket to create an invitation with a friend's name and Tanzania mobile
number. Copy the invitation link or share it on WhatsApp. The recipient verifies
their number and claims just that ticket, without an organizer account. Their QR
and manual admission code are replaced atomically; the buyer's old link, saved
image, and code stop working. The booking page shows claim status but never exposes
the recipient's new admission credentials. Each friend can arrive independently.
The gate scanner and guest list show the recipient and original booking reference.

Invitations expire after 48 hours. Pending invitations can be cancelled or replaced;
claimed or admitted tickets cannot be taken back or handed over again. Scanning an
unclaimed ticket prevents a later claim. Refunded orders and cancelled events cannot
be claimed or admitted. Verification codes expire after five minutes, have bounded
attempts, and are rate limited by invitation, phone number, and request IP.

Local demo checkout plus outbox mode displays an explicitly labelled test code on
the recipient's claim page; this does **not** prove phone ownership. Live handover
requires `DELIVERY_DRIVER=live` and `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_SMS_FROM`. Missing SMS configuration disables handover, rather than accepting
unverified claims. Codes are not placed in the organizer outbox or booking response.
Invitation links are shared manually; verification SMS is sent on recipient request.
Confirm the sending provider's Tanzania support and delivery using real devices
before launch. Names are supplied by the buyer, not independently verified identities.
After claiming, keep the private ticket link; cross-device ticket recovery and
re-entry are not part of this feature yet.

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
verification mismatches, secure ticket handover, cancelled events, duplicate admissions, demo refunds,
outbox delivery, publishing, successful/failed purchases, and desktop/mobile layout.

## Deploy to Contabo

1. Install Docker and Nginx on your VPS. Point DNS `@`, `app`, and `*` to its IP.
2. Clone this repository. Copy `deploy/production.env.example` to `.env.production`.
   Configure `goldencreations.events` and keep `PAYMENT_DRIVER=disabled` until integration is ready.
3. Run `docker compose up -d --build`. Only localhost port 3001 is exposed.
4. Install a certificate covering `goldencreations.events` and `*.goldencreations.events`.
   The Nginx template uses Certbot's live certificate paths. Enable it only after
   issuance. Install `deploy/cloudflare-realip.conf` as
   `/etc/nginx/snippets/goldenevents-cloudflare-realip.conf`, validate Nginx, and reload it.
5. Create an administrator in the container. Set `ADMIN_PASSWORD` securely in the
   container's environment and invoke `node scripts/create-admin.js`; it prompts
   for name and email. No default production administrator is created.
6. Connect provider accounts and test the real checkout, callbacks, notification
   delivery, scanning, and reconciliation before enabling public sales.

Production startup rejects demo payments, demo seeding, and non-HTTPS origins.
Use a fresh production volume; never copy the demo database onto the VPS.
SQLite suits the initial single-VPS deployment. Use one application instance with
one durable local database; concurrent replicas need a different database/job setup.

### Cloudflare DNS and Wildcard HTTPS

Keep the domain registered at Namecheap, add it to Cloudflare, and replace its
Namecheap nameservers with the two nameservers Cloudflare assigns. Set DNS-only
A records for `@`, `app`, `www`, and `*` to the VPS address. Preserve existing mail
records. If DNSSEC was enabled, remove the old delegation before switching and
enable Cloudflare DNSSEC after activation.

Install Certbot's Cloudflare DNS plugin. Create a token restricted to DNS editing
for `goldencreations.events`, and put it in `/root/.secrets/certbot/cloudflare.ini`
using `deploy/cloudflare.ini.example` as the format. Keep the directory mode 700
and credentials file mode 600. Never commit or send the real token in chat.
Request both names with Certbot's DNS-01 authenticator and a real operator email:

```sh
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  --cert-name goldencreations.events \
  -d goldencreations.events -d '*.goldencreations.events'
```

Install `deploy/certbot-renew-hook.sh` as an executable file under
`/etc/letsencrypt/renewal-hooks/deploy/`, enable `certbot.timer`, and test with
`certbot renew --dry-run`. Leave DNS-only records initially; proxying is optional.
When enabling Cloudflare's proxy later, use Full (strict), not Flexible, TLS mode.
Do not cache private ticket, booking, claim, dashboard, or API responses.
The real-IP snippet trusts only Cloudflare's published proxy networks so rate
limits use the visitor's IP. Keep its network list current using Cloudflare's
official IPv4/IPv6 lists; do not trust forwarded headers from arbitrary sources.

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
