# Mobile Developer Handoff

Golden Events already owns event inventory, payment verification, ticket issuance,
sharing, gate access, messaging and payouts. Build the mobile interface against
this backend. Do not reimplement payment confirmation or give the app Ecofy,
NextSMS, webhook or database credentials.

## Documentation And Environments

- Swagger: `/api/docs`
- OpenAPI JSON: `/api/openapi.json` (download or import this URL into Postman)
- Local example: `http://localhost:5173/api/docs` after `npm run dev`
- Production location after deploying this release:
  `https://app.goldencreations.events/api/docs`
- Production API base: `https://app.goldencreations.events/api`

`npm run api:export` creates a portable `openapi.json` and this guide under
`output/api-handoff/` for sharing without repository access. The exported contract
targets the production hostname; deploying this release is a separate step.

The spec describes **all registered application API operations**, including
provider-only callbacks and development-only endpoints. Swagger assets are not
application endpoints. Each operation includes access requirements, request and
response schemas, errors, and side-effect warnings. CI verifies route coverage
and validates the OpenAPI document. When adding a route, update `server/openapi.js`.

Production Swagger deliberately has no **Try it out** controls. Its downloads
and schemas contain no credentials. Local Swagger allows execution: use a
separate demo database, not live money or messaging configuration.

Use `npm run dev` for a local demo. Never test a production withdrawal just to
check connectivity. `/api/health`, `/api/ready` and `/api/status` do not charge or
send messages. Local `.localhost` domains need the correct local port; a physical
phone cannot reach the developer computer through the phone's own `localhost`.
Use a separately configured HTTPS staging host for device testing.

## Authentication

### Native Sign-In

```sh
API=http://localhost:5173/api
curl "$API/auth/token" \
  -H 'Content-Type: application/json' \
  --data '{"email":"your-account@example.com","password":"YOUR_ACCOUNT_PASSWORD"}'
```

This returns `access_token`, `token_type: "Bearer"`, `expires_in` (seconds),
`expires_at` (Unix milliseconds) and `user`. No browser cookie is set. Send:

```http
Authorization: Bearer <access_token>
```

Tokens are opaque, prefixed `ge_mobile_`, stored only as hashes on the server and
valid for seven days. Store them in iOS Keychain or Android Keystore-backed secure
storage. Do not put them in URLs, analytics, crash reports or ordinary preferences.
There is no refresh-token endpoint. On expiry or revocation, sign in again.

Native token login sends JSON without `Cookie` or `Origin`. If an `Origin` is
supplied, it must match the API host. Once authenticated, bearer requests can omit
`Origin`; a supplied foreign or malformed origin is still rejected. A browser
session value cannot be converted to a mobile token. Tokens in query parameters
or in the `ge_session` cookie are not accepted as mobile authentication.

- `GET /auth/me`: user or `null` when anonymous; explicit invalid bearer returns 401.
- `POST /auth/logout`: revokes the current mobile token, not other devices.
- `PUT /settings/password`: revokes **every** mobile and web session. Sign in again.
- An invalid explicit Authorization header never falls back to a browser cookie.
- Prefer sending only the credential transport appropriate to the client.
- No client-selected role: registration always creates an organizer.
- Scanners only see assigned events. Administrator status alone does not grant
  admission access. Owner, team and admin authorization is checked on the server.

### Registration And Public Mutations

Existing browser sessions remain HttpOnly cookies with same-origin protection.
No blanket CORS allowance or bypass was added. Browsers should use cookie login,
not the native credential flow.

For native **unauthenticated** writes (registration, checkout, ticket claim and
new scanner invitation acceptance), send an `Origin` equal to the API origin,
without `/api` or a trailing path. This preserves the existing website protection
while allowing native HTTP clients to use public workflows without buyer accounts.

```sh
curl "$API/auth/register" \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{"name":"Organizer Name","email":"new-owner@example.com","password":"CHOOSE_A_LONG_PRIVATE_PASSWORD"}'
```

Then sign in through `/auth/token`. The registration response's browser cookie is
not a bearer token. For production, the matching Origin is
`https://app.goldencreations.events` when calling that host.

Temporary scanner accounts receive `must_change_password: true`. Direct them to
`PUT /settings/password` with `current` and `newPassword`, then sign in again.
Protected operations remain locked until this is done. New scanner invitations
can be accepted with a chosen password; existing accounts must authenticate with
the invitation email before acceptance.

## Core Workflows

### Publish And Share

1. Optionally `POST /uploads` as multipart field `image` (JPG/PNG/WebP, at most
   5 MiB). Use the returned relative `url` as `image` in the event form.
2. `POST /organizer/events` with the full `EventInput` schema. Set `published`
   only when ready. New event dates must be in the future.
3. Share **the returned `event.url`**, not an invented subdomain or internal ID.
4. Updates use `PUT /organizer/events/{id}` with the complete form and existing
   ticket-type IDs. Do not remove a type with existing orders.

### Buy And Retrieve Tickets

1. List `/events`, open `/events/{slug}` and choose an available ticket type.
2. Generate one idempotency key (UUID recommended) for the checkout. Keep it
   across retries. `POST /orders` with event/type IDs, quantity, phone and the key.
3. Persist the returned private order `token` and `reference`. HTTP 201 means
   initiated, **not paid**. Let the buyer authorize mobile money on their phone.
4. Poll `GET /orders/{token}` with a modest interval and backoff. Stop frequent
   polling when the app backgrounds or reaches a terminal state. Respect 429s.
5. Display tickets only after server-confirmed payment. Use `/tickets/{token}`
   for QR data and `/tickets/{token}/image` for the branded PNG.

Provider errors can return an `error` plus a private order `token`. Keep that
token to check the existing order; do not blindly create another payment. If a
network request times out, repeat it using the **same** key and identical details.
`payment_uncertain` means confirmation is unresolved, not permission to charge
again. Expired/review orders may need support. Never mark a payment paid locally
or call a provider callback from the app.

Attendees do not need organizer accounts. Their private order and ticket links
are credentials. Encrypt locally stored links and exclude tokens from logs.
There is no "find all my tickets by phone number" endpoint; do not imply that
entering a phone number alone proves ownership.

### Four Friends Arriving Independently

1. Buy four tickets in one booking.
2. For each friend, call `/orders/{token}/tickets/{id}/invite` with name and phone.
   Share that invitation's returned `url` with only the intended friend.
3. Friend opens `/claims/{token}`, then requests `/claims/{token}/code`. OTP is
   sent to the invited phone, not a client-selected destination.
4. Create and preserve one private `claim_key` UUID. Accept with code and key at
   `/claims/{token}/accept`; store the new recipient-only ticket token securely.
5. Each person presents their own QR. The buyer loses the claimed ticket's old
   token/code. Retrying a successful claim requires the same private claim key.

Respect OTP expiry, attempt limits and resend cooldown. Do not poll code-send
endpoints. A claimed or admitted ticket cannot be transferred again.

### Gate Scanning

1. Organizer/admin creates scanners or invitations under `/gate/events/{id}`.
2. Scanner signs in and completes any required temporary-password change.
3. Read `/scanner/events`, select an assigned event and read a QR with the camera.
4. `POST /scanner/check-in` with `event_id` and scanned `code` (code, token or URL).
5. Only show an admission success after HTTP 200. Duplicate admission returns 409;
   invalid or unauthorized tickets must not show a green result.

Requires online validation. No offline acceptance, automatic re-entry, wristband
replacement or device binding is implemented. Revoked event assignments stop
working immediately even if a mobile token is still valid.

### Earnings And Withdrawals

1. Read `/organizer/finance`. Use `withdrawal_preview.amount` as take-home only
   when its status is `quoted`; otherwise show the appropriate unavailable or
   destination-required state. `available` is not a guaranteed recipient amount.
2. Verify the organizer's security phone via `/settings/phone` and its code/verify
   operations if necessary. Profile phone editing is not security verification.
3. Get a fresh `/organizer/payouts/quote` with amount, destination type, channel,
   account, entered account name, account password and a new idempotency UUID.
   Display `amount`, `fee`, `total`, destination and expiry. A merchant-supplied
   name is not independent verification of the bank/mobile account holder.
4. If `destination_verification_required`, send a fresh destination code with
   `/organizer/payouts/destination/code`, then verify via `/destination/verify`.
   This authorizes only that destination for this quote, not the organizer.
5. `/organizer/payouts/code` with quote ID, `account_name_confirmed: true`, account
   password and a separate authorization idempotency UUID. A **fresh organizer
   OTP is required for every withdrawal**, including to the usual saved number.
6. Confirm by POSTing `{ "code": "<fresh OTP>" }` to
   `/organizer/payouts/{challenge_id}/confirm`. This can send **real money**.
7. Read `finance.payouts` until a final state. A timeout or `processing` response
   is not a failure and must not trigger a second withdrawal.

Production automatic payouts require NextSMS. Alternate mobile destinations need
both OTP stages; bank destination OTP does not establish bank-account ownership.
OTP challenges bind account, amount, destination and current security state. If a
quote or proof expires or changes, restart with a new quote and fresh proofs.
Quote IDs, OTP challenge IDs and payout request IDs are different identifiers.

Fees are whole TZS. Platform cut, confirmed collection fees and quoted withdrawal
fee are distinct ledger entries. The display may group provider costs as
"Withdrawal fees". Never deduct both the allowance and the actual fee. Read the
quote; do not hard-code a provider percentage or invent a take-home amount.
If 409 includes `payout_adjustment`, offer its suggested amount, then obtain a
**new quote**; the adjustment itself never authorizes a transfer.

Manual-review mode uses a different code-request schema and submits a request for
admin review instead of sending immediately. Respect `payout_mode` and
`automatic_disbursement`, rather than assuming every environment has live payouts.

## Conventions And Limits

- JSON by default; image uploads use multipart, ticket downloads return PNG.
- Amounts are integer TZS, not cents. Account numbers and OTPs are strings.
- Integer timestamps are Unix milliseconds. ISO dates have timezone offsets;
  reports use Africa/Dar_es_Salaam.
- Errors normally contain `{ "error": "..." }`. Financial errors can additionally
  contain `payout_adjustment` or an uncertain checkout's `token`.
- Reverse proxies can return non-JSON errors. Handle those safely and check
  financial history before retrying, not by displaying raw HTML or assuming failure.
- 401: invalid session/password/token; 403: role or origin; 404: unavailable or not
  owned; 409: state/balance/conflict; 410: expired invitation; 429: rate limited;
  502/503: provider/configuration unavailable. Read the human-readable error too.
- Default API rate limit: 240 requests/minute/IP. Sign-in: 30/15 minutes;
  checkout: 12/minute; OTP send: 3/minute, verify: 10/minute, with additional
  per-phone/account cooldowns and attempt limits. Observe `Retry-After` and rate
  headers; multiple devices can share an IP.
- Lists currently have no pagination parameters. Do not invent `page` or cursor
  behavior; coordinate backend pagination before large-scale mobile releases.
- There is no dedicated device-push-notification API, buyer-account wallet,
  refresh-token flow or offline scanning protocol in this release.
- Live refunds are not implemented. The refund endpoint only simulates eligible
  demo refunds; production returns 503 and no money is refunded.

## Backend Verification

```sh
npm run check
npm run test:e2e
```

`tests/openapi.test.js` validates the spec, compares it with registered routes and
checks production-safe documentation serving. `tests/mobile-auth.test.js` checks
origin protections, token transport isolation, expiry/revocation and scanner
restrictions. Use the browser and integration suites alongside this contract.
