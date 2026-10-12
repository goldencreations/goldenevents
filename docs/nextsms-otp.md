# NextSMS Verification

Golden Events generates and verifies its own OTPs; NextSMS transports SMS only.
This integration covers security-phone enrollment, organizer payouts and shared-ticket claims.
It does not add passwordless login, password reset or SMS delivery of purchased tickets.

## Live Setup

1. Obtain Golden Events' own NextSMS credential pair and approved transactional Sender ID. Do not reuse another product's credentials or a documentation example.
2. Fund the NextSMS account. Check sender approval and network coverage with the provider.
3. Set the protected VPS environment values from `deploy/production.env.example`:

```dotenv
NEXTSMS_ENABLED=true
NEXTSMS_BASE_URL=https://messaging-service.co.tz
NEXTSMS_API_VERSION=2
NEXTSMS_USERNAME=YOUR_OWN_KEY
NEXTSMS_PASSWORD=YOUR_OWN_SECRET
NEXTSMS_SENDER_ID=YOUR_APPROVED_SENDER
PAYOUT_OTP_DRIVER=nextsms
```

4. Restart the Node service after changing its environment. Keep credentials out of Git, shell history, screenshots and chat. The server validates HTTPS, sender format and bounded OTP settings; sender approval is a provider-side requirement.
5. Verify an organizer's security phone in Settings with their current password and received SMS. Ordinary contact-number edits do not change this verified number. Replacing a verified number is deliberately blocked pending a secure recovery/change-number workflow; support cannot replace it through the current UI.
6. Run an explicitly authorized staging smoke test on a dedicated number and save only a redacted provider response. Confirm reception on Vodacom, Airtel, Yas and Halotel before general release. This work has **not** performed a live SMS test or confirmed sender approval.

Both environment templates default to `NEXTSMS_ENABLED=false`. No credentials are bundled.
NextSMS-disabled enrollment fails closed, not through a mock success or log-only send.
Local demo/outbox ticket claims and payouts retain their explicitly labelled simulated codes;
these are separate from the NextSMS service and are forbidden in production.
`PAYOUT_OTP_DRIVER=nextsms` fails closed if NextSMS is disabled; it never silently falls back to email.
`auto` keeps existing local demo behavior, otherwise prefers configured NextSMS, then configured SMTP.
Shared claims prefer NextSMS outside local demo/outbox mode; legacy Twilio remains available if NextSMS is not configured.

### Private Configuration Installer

Once the OTP release is installed, run its installer with Node 24 (including inside a container):

```sh
node scripts/install-nextsms-config.js /path/to/private/nextsms.env /path/to/.env.production --enable
```

The incoming file must be private and outside Git. Use `-` as the incoming path to read encrypted
SSH-piped standard input instead. The installer updates only NextSMS and payout-OTP settings,
validates encoding, preserves unrelated provider settings and file ownership, and writes a private
rollback backup before atomically replacing the target. It preserves a trusted deployment group's
existing read-only access (0640), otherwise restricts the target to 0600; backups are always 0600.
No credentials are printed. Without `--enable`, live sending is disabled. The application must be
recreated/restarted to load the new environment; installing values alone does not test SMS delivery.

## Provider Contract

The current [official Postman reference](https://documenter.getpostman.com/view/1679195/2sAYkDP1XN) documents
`POST /api/sms/v2/text/single`, Basic/Bearer authentication and detailed message statuses.
The [NextSMS product example](https://www.nextsms.co.tz/service/sms) still uses v1 and a simplified success response.
This adapter uses the issued Basic credential pair, JSON `from`, canonical `255XXXXXXXXX` recipient, `text`,
and an application challenge ID as v2 `reference`. Version 1 is explicitly configurable if needed.
The reference is **not** assumed to be an idempotency key.

HTTP 200 alone is not success. Accepted responses require a provider message ID and either explicit
`success: true` or a documented v2 status: PENDING group 18 IDs 50/51/52/88, or DELIVERY group 20
IDs 73/77/109. Failed, rejected, expired, undeliverable, malformed and unknown statuses fail closed.
Legacy undocumented group 1 is not assumed successful. Numeric provider IDs are preserved without
floating-point rounding. Transport timeouts, redirects and malformed responses are generic failures;
upstream bodies and credentials are not exposed. No automatic retries are made after ambiguous SMS sends.
An SMS may still arrive after a network timeout, but that code is invalidated: request a fresh one after cooldown.
Provider acceptance means queued/sent, **not** proof that a handset received it.

## Security And Operations

- Cryptographically random six-digit codes; salted scrypt hashes; five-minute maximum TTL; five wrong guesses.
- Each code is bound to purpose, recipient, owner where applicable, and action context. Payout context includes the server-held quote, amount, destination, recipient and fee; enrollment includes the current password version.
- Sixty-second resend cooldown; five sends/hour/phone/purpose; durable three sends/minute/IP across purposes. Verification routes are rate limited; accumulated bad guesses across resends are bounded.
- Resends supersede older active codes. Unconfirmed SMS sends cannot verify or reserve money. No NextSMS code is returned in APIs, outbox, logs, errors or analytics.
- Verification and the protected action commit in the same SQLite `BEGIN IMMEDIATE` transaction. Wrong guesses commit; successful verification clears the hash. Two requests cannot consume one code twice.
- Payout money remains reserved according to the existing durable payout state machine. A short, authenticated repeat confirmation can retrieve the existing result; it cannot create a new payout or renew authorization. Shared-claim receipt recovery also requires the claimant's private retry key. These receipts expire after at most 15 minutes.
- Friends verify their invited phone and receive independent, rotated admission credentials. Buyer booking pages never receive a friend's new QR/token. Cancelled, refunded or already-admitted tickets cannot be claimed.
- Administrators can inspect masked activity, failures, locks and p95 request latency in Administration or `GET /api/admin/otp`. Public status shows configuration/recent provider acceptance, never private records. No paid SMS probes, delivery-receipt polling or external outage alerts are configured.

Enrollment API: authenticated `GET /api/settings/phone`, `POST /api/settings/phone/code`,
`POST /api/settings/phone/:id/resend`, `POST /api/settings/phone/:id/verify`.
Payout and shared-claim requests retain their existing action-specific routes. Successful NextSMS code
requests return 202 with masked recipient and expiry metadata, not the code. Purposes cannot be selected
arbitrarily by clients to turn ticket claims into account or payout authorization.

Tests use an isolated database and in-memory fake SMS transport, never paid messages or application logs.
Private credentials, live provider response validation, approved sender status and actual network delivery
remain deployment prerequisites.
