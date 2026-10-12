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
- Independent scanner accounts, event-scoped crew invitations, revocation, and admission operator records.
- Sales dashboard, orders, guests, CSV exports, revenue history, platform administration.
- Durable SMS/email/WhatsApp outbox and configurable SMTP/Twilio delivery.
- Docker, Nginx wildcard configuration, database backup command, automated checks.

## Gate Teams

Open **Gate team**, choose an event, and enter the scanner's name and email.
**Create account** immediately assigns the scanner and displays a generated
temporary password once. Share those credentials privately; the scanner must
change the password before accessing any protected endpoint or scanning. Only
the password hash is stored. Changing it invalidates all existing sessions.
Existing accounts are assigned without changing their name, password, or role;
no credentials are returned for existing accounts.

**Invite** creates a single-use link that expires after seven days. New staff
set their own password and get a scanner-only account. Existing users must sign
in with the invited email before accepting. Links can be shared manually, or
emailed by selecting **Send by email** when `DELIVERY_DRIVER=live`, `SMTP_HOST`
and `SMTP_FROM` are configured (with `SMTP_PASSWORD` if `SMTP_USER` is set).
The email option is disabled otherwise. SMTP acceptance is reported as sent,
not proof of delivery. Failed sending leaves a usable manual invitation link.

Platform administrators use the same screen to assign Golden Creations staff to
any organizer's event. A staff member can be assigned to multiple events
using one account. Assignments created by administrators are labeled Golden
Creations; assignments created by owners are labeled Organizer crew. This is a
permission workflow, not a staffing marketplace or automatic staff booking.

Scanners use `/dashboard/scan` after signing in. `/api/scanner/events` exposes
only their assigned events (and any events they own), without sales figures,
orders, or buyer exports. Admission is verified on the server against current
assignments on every request. Revoking one assignment immediately blocks new
scans for that event, including in an already-open browser, while preserving
other assignments. Scanner-only accounts cannot access organizer endpoints or
administration. They can manage their own profile and password under Settings.

Only one successful admission is allowed per paid ticket. Each admission stores
the operator's account ID, and the organizer's guest list/export shows the name.
Scanning requires internet and a camera-capable HTTPS browser, with a manual
code fallback. Ticket authenticity is not proof of the holder's identity;
re-entry, offline check-in, and phone-device binding are not implemented.

Ticket PNG downloads and Meta WhatsApp delivery use the same private server
renderer. Claimed tickets retain their holder's name; revoked ticket credentials
cannot download a valid image. No ticket images are published into public uploads.

## Service Status

`/status` is a public, login-independent service page. `/api/health` remains a
minimal liveness check; `/api/ready` tests database reads/writes and the worker
heartbeat, returning 503 for failed readiness. Docker uses the readiness endpoint.
`/api/status` adds storage, Ecofy's unauthenticated health endpoint, payment queues,
and delivery configuration. No health check creates a payment, sends a message,
or exposes customer records, credentials, queue errors, or infrastructure paths.

Snapshots are coalesced/cached, provider health is checked at most once a minute,
and one-minute samples plus observed incidents are retained for 30 days in SQLite.
Times use Africa/Dar_es_Salaam. Messaging is `not_configured` in outbox mode;
configured messaging without delivery confirmation is `unknown`, not green.
Provider API reachability does not certify the underlying payment rail.

This first monitor runs on the same VPS. It cannot observe or serve a status page
during a complete VPS/network outage. Gaps mean no recorded checks, not uptime.
External monitoring and outage alerts are not connected. Host the status page and
observer separately before relying on it for independent downtime reporting.

## Payment and Delivery Configuration

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

The integration handles mobile-money collections and optional quoted withdrawals,
not QR payment checkout or refunds. Payment keys can move money:
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

### Meta WhatsApp Ticket Images

Set `WHATSAPP_DRIVER=meta`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_TEMPLATE_NAME`, and `WHATSAPP_TEMPLATE_LANGUAGE`
in the private environment file after Meta approves the template. The
`golden_event_ticket` utility template has an IMAGE header and a fixed confirmation
body, without body variables or buttons. Buyers explicitly opt in at checkout.
Each valid, unclaimed, unused ticket is rendered as a private PNG in memory,
uploaded to Meta, and sent in a separate template message using the media ID.
The PNG includes event artwork, event details, QR and manual admission code.
`GET /api/tickets/:token/image` provides the same PNG through a private bearer URL
with no caching. No admission images are placed in public uploads.

Meta approval is checked once a minute while sending queued messages. Pending
review holds messages without consuming retries; sending starts after approval.
Meta sending operates independently of `DELIVERY_DRIVER`, so SMS/email can stay
in outbox mode. Existing outbox records are not automatically replayed. Per-ticket
provider acknowledgements persist across retries, preventing acknowledged tickets
from being resent when a later ticket fails. An ambiguous timeout or crash after
Meta accepts a message can still cause a duplicate on retry. `sent` means accepted
by Meta, not confirmed delivery or read; delivery-status webhooks are not connected.
The webhook verify token is not needed for outbound sending. Ticket handover still
requires separately configured verification SMS.
For a live sample test, use a different recipient from the business sender number;
Meta rejects messages sent to the sender itself.

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

## Organizer earnings and payout requests

For SMS verification setup and security-phone enrollment, see [NextSMS OTP](docs/nextsms-otp.md).

Revenue shows paid ticket sales, Golden Events fees, confirmed provider fees,
estimated organizer earnings, held funds, reserved requests, and completed payouts.
`PLATFORM_FEE_BPS=500` means 5%, deducted from the sale rather than added to the
buyer's total. The rate and whole-TZS fee are snapshotted when checkout is reserved;
rounding is nearest shilling, half up, per order. Later rate changes do not reprice
existing orders. Older orders without snapshots are treated as zero platform fee,
explicitly labelled legacy, and are not charged retroactively.

With `PAYOUT_DRIVER=manual`, verified collections are **not** automatically spendable wallet funds. An admin
must reconcile each paid sale against funds actually received and enter the actual
provider fee and statement reference in Administration. Reconciliation is immutable
and idempotent. Both pre-event and post-event releases require a review of refund
exposure; cancelled events are held. This is a manual records workflow, not provider
balance verification or automated settlement.

Organizers request at least `PAYOUT_MINIMUM_TZS=1000` to a Tanzanian mobile-money
number. The account password is required; a five-minute OTP is bound to that exact
amount, recipient and number. NextSMS sends it to the organizer's separately verified
security phone, never to an arbitrary payout destination. The legacy email option
requires SMTP with TLS and `DELIVERY_DRIVER=live`.
No live verification code is returned or placed in the delivery outbox. Codes are
hashed, limited to five guesses, throttled across resends, invalidated on password
changes, and replaced by a newer challenge. OTP confirms account control, **not**
the beneficiary's legal identity. Manual-mode admins must independently check recipient ownership.
Local demo/outbox mode displays a clearly labelled simulated code and never sends money.

Confirmation reserves the amount atomically. Retries are idempotent; other users
and scanners cannot view or confirm requests. Organizers can cancel only requests
awaiting review. Admins approve for manual transfer, then record a completed transfer
with a unique provider reference and explicit confirmation that the full requested
amount was received. A processing request remains reserved until a definite outcome
is known; rejecting it requires confirmation that no transfer was sent. Review
actions are audited. Refunds of released demo sales are blocked pending reconciliation.

### Ecofy withdrawals

`PROVIDER_FEE_ALLOWANCE_BPS=250` reserves a conservative 2.5% of matured ticket
sales for collection and withdrawal fees combined, separately from the platform
fee. This is an allowance, not a claimed provider tariff or platform revenue.
Verified collection fees and pending/paid withdrawal fees consume the allowance;
the same fee is never deducted both as an allowance and as an actual cost.
Only the remaining allowance reduces the amount available to request. A payout's
principal must fit that amount, and principal plus the authoritative quoted fee
must fit actual unreserved funds. Higher provider fees require a smaller payout.
Rejected withdrawals restore the unused allowance. The default is zero unless
explicitly configured; manual reconciliation and local demo behavior are unchanged.

`PAYOUT_DRIVER=ecofy` explicitly enables real transfers using the existing server-only
Ecofy credentials. Production templates default to `manual`; local demo payments
default to `demo`, which simulates a TZS 100 withdrawal fee and a recipient name,
never calls Ecofy, and never sends money. No live withdrawals are enabled by this
change and no VPS settings are modified. The implementation follows section 13
of the [supplied API contract](https://claude.ai/artifact/EowsphkAJWdRyDswcY2yze);
the production API origin remains `https://ecofypay.ecofy.co.tz`, not the older
origin printed in the document. Live merchant permissions and the rail have not
been certified by these mocked tests.

The worker reads authoritative succeeded collections for `fee` and `net`, and
matches each payment to its owning organizer. An authenticated `matured` movement
in `GET /v1/transactions` must match the payment ID and collected net before funds
are released. A future timestamp or an aggregate merchant balance alone does not
credit an organizer. Missing, invalid or changed fees are held. Statement pages
are scanned incrementally, with a persisted cursor; a scan restarts at the newest
page after reaching the end. Historical payments are backfilled read-only in
batches. Cancelled events are held, and Golden Events' snapshotted cut is excluded
from organizer credit. `GET /v1/balance` is checked separately to cap transfers to
available provider funds. No other organizer can spend the merchant's shared cash.

The organizer enters amount and destination (documented channels: MPESA,
AIRTELMONEY, CRDB, NMB) and reauthenticates with their password. A durable,
idempotent `POST /v1/payouts/quote` resolves the account name, last four digits,
fee and total. No money is moved by quoting. The organizer must recognize and
confirm that name and fee before an OTP can be sent. The OTP binds the
quote, verified name, destination, amount and withdrawal fee. Expired quotes require
a new quote and fresh confirmation; they are never silently replaced. Bank account
numbers preserve leading zeroes. NextSMS (or the explicit legacy SMTP option) is required for live OTPs.

OTP confirmation atomically reserves **amount + withdrawal fee**, consumes the
quote once, and creates a durable transfer job. `POST /v1/payouts` always uses the
same quote, reference and idempotency key for that logical withdrawal. A confirmed
GET matching ID, reference, amount, fee, total and final status is required to mark
it paid or release a failed transfer. A lost POST response triggers lookup by
reference, then GET reconciliation or a retry with the identical key. Unknown
outcomes remain reserved, including after quote expiry or a restart; they cannot
be cancelled or manually recorded as another transfer. Jobs retry every 5 seconds
to 5 minutes and never release money simply because retries were exhausted.

Organizer history shows recipient amount and withdrawal fee separately; payout
debits and reservations include both. Manual administration remains available for
manual requests only. Audit records, consumed quotes and fee snapshots survive
job cleanup and repeated database migrations. Demo refunds that would consume
already reserved or withdrawn funds are rejected atomically. Real refunds still
require provider handling and ledger reconciliation.

## What is not live yet

This is a working local first version, not an approved payment business.
Provider integration code is covered with mocked verification tests but has not
been exercised against a merchant account. Before live sales, complete a provider
sandbox and real-device trial. Automatic organizer transfers require explicit activation and an authorized live trial. Live refunds
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
