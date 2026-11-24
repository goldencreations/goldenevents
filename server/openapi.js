const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const str = (extra = {}) => ({ type: 'string', ...extra });
const integer = (extra = {}) => ({ type: 'integer', ...extra });
const bool = { type: 'boolean' };
const money = integer({ minimum: 0, description: 'Whole Tanzanian shillings (TZS), not cents.' });
const timestamp = integer({ format: 'int64', description: 'Unix time in milliseconds.' });
const date = str({ format: 'date-time' });
const uuid = str({ format: 'uuid' });
const password = str({ minLength: 1, maxLength: 128, format: 'password', writeOnly: true });
const phone = str({
  example: '0712345678',
  description: 'Tanzanian mobile number; 0, 255 and +255 prefixes are accepted.',
});
const code = str({
  pattern: '^\\d{6}$',
  description: 'Fresh six-digit OTP. Keep it a string, including leading zeros.',
});
const list = (items) => ({ type: 'array', items });
const obj = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const envelope = (key, schema) => obj({ [key]: schema }, [key]);
const ok = obj({ ok: { type: 'boolean', enum: [true] } }, ['ok']);
const json = (schema) => ({ 'application/json': { schema } });
const authenticated = [{ mobileToken: [] }, { browserSession: [] }];
const optionalAuthentication = [...authenticated, {}];
const roles = {
  Public: 'No account required. Private link tokens are credentials, not public identifiers.',
  Account: 'Any signed-in account. Temporary scanner accounts must first change their password.',
  Organizer: 'Organizer or administrator; organizer data remains scoped to the account owner.',
  Gate: 'Event owner or administrator for team management; scanners cannot manage teams.',
  Scanner:
    'Assigned scanner or event owner. Administrators do not automatically have entry permission.',
  Admin: 'Administrator only.',
  Provider: 'Payment-provider callback only. Never call this endpoint from a mobile app.',
};

const schemas = {
  Error: obj(
    {
      error: str(),
      token: str({
        description: 'Private order token, present for an uncertain checkout initiation.',
      }),
      payout_adjustment: obj({
        quoted_fee: money,
        allowance_applied: money,
        suggested_amount: money,
        minimum: money,
      }),
    },
    ['error'],
  ),
  User: obj(
    {
      id: str(),
      name: str(),
      email: str({ format: 'email' }),
      role: str({ enum: ['organizer', 'scanner', 'admin'] }),
      phone: str(),
      organization: str(),
      created_at: date,
      must_change_password: bool,
    },
    ['id', 'name', 'email', 'role'],
  ),
  Login: obj({ email: str({ format: 'email' }), password }, ['email', 'password']),
  Register: obj(
    {
      name: str({ minLength: 2, maxLength: 80 }),
      email: str({ format: 'email', maxLength: 200 }),
      password: { ...password, minLength: 10 },
    },
    ['name', 'email', 'password'],
  ),
  Token: obj(
    {
      access_token: str({
        description: 'Opaque ge_mobile_ token. Store in Keychain/Keystore, not logs or URLs.',
      }),
      token_type: str({ enum: ['Bearer'] }),
      expires_in: integer({
        example: 604800,
        description: 'Lifetime in seconds. No refresh-token endpoint; sign in again after expiry.',
      }),
      expires_at: timestamp,
      user: ref('User'),
    },
    ['access_token', 'token_type', 'expires_in', 'expires_at', 'user'],
  ),
  TicketTypeInput: obj(
    {
      id: str({
        description: 'Existing ticket type ID on edits only. Never invent IDs for new types.',
      }),
      name: str({ minLength: 1, maxLength: 40 }),
      price: { ...money, minimum: 100, maximum: 10000000 },
      capacity: integer({ minimum: 1, maximum: 100000 }),
    },
    ['name', 'price', 'capacity'],
  ),
  EventInput: obj(
    {
      name: str({ minLength: 3, maxLength: 100, example: 'Friday Live' }),
      description: str({ minLength: 10, maxLength: 4000 }),
      starts_at: {
        ...date,
        description: 'ISO 8601 with timezone; new events must start in the future.',
      },
      venue: str({ minLength: 2, maxLength: 120 }),
      city: str({ minLength: 2, maxLength: 80 }),
      category: str({ enum: ['Music', 'Nightlife', 'Community', 'Business', 'Arts', 'Sports'] }),
      image: str({
        maxLength: 1000,
        description:
          'Empty, /uploads/<id>.webp from upload response, or an https://images.unsplash.com/ URL.',
      }),
      status: str({ enum: ['draft', 'published', 'paused', 'cancelled'] }),
      tickets: { ...list(ref('TicketTypeInput')), minItems: 1, maxItems: 8 },
    },
    ['name', 'description', 'starts_at', 'venue', 'city', 'category', 'image', 'status', 'tickets'],
  ),
  TicketType: obj({
    id: str(),
    event_id: str(),
    name: str(),
    price: money,
    capacity: integer(),
    available: integer({
      description: 'Capacity minus paid/review orders and active reservations.',
    }),
  }),
  Event: obj(
    {
      id: str(),
      name: str(),
      slug: str(),
      description: str(),
      starts_at: date,
      venue: str(),
      city: str(),
      category: str(),
      image: str(),
      status: str({ enum: ['draft', 'published', 'paused', 'cancelled'] }),
      created_at: date,
      url: str({ format: 'uri' }),
      tickets: list(ref('TicketType')),
      sold: integer(),
      revenue: money,
      checked_in: integer(),
      readOnly: bool,
    },
    ['id', 'name', 'slug', 'tickets', 'url'],
  ),
  OrderInput: obj(
    {
      event_id: str(),
      ticket_type_id: str(),
      quantity: integer({ minimum: 1, maximum: 10 }),
      phone,
      email: str({
        default: '',
        description: 'Valid email or empty string. Required for Flutterwave.',
      }),
      whatsapp: { ...bool, default: false },
      idempotency_key: str({
        minLength: 20,
        maxLength: 100,
        example: '00000000-0000-4000-8000-000000000001',
        description:
          'Generate once per checkout; reuse on network retries with exactly the same details.',
      }),
    },
    ['event_id', 'ticket_type_id', 'quantity', 'phone', 'idempotency_key'],
  ),
  OrderStarted: obj(
    {
      token: str(),
      reference: str(),
      status: str({ enum: ['pending', 'paid', 'failed', 'expired', 'refunded', 'review'] }),
    },
    ['token', 'reference', 'status'],
  ),
  Order: obj({
    id: str(),
    token: str(),
    reference: str(),
    event_id: str(),
    ticket_type_id: str(),
    quantity: integer(),
    unit_price: money,
    amount: money,
    currency: str({ enum: ['TZS'] }),
    phone: str(),
    email: str(),
    whatsapp: integer({ enum: [0, 1] }),
    status: str({ enum: ['pending', 'paid', 'failed', 'expired', 'refunded', 'review'] }),
    provider: str(),
    provider_status: str({ nullable: true }),
    created_at: date,
    expires_at: timestamp,
    paid_at: { ...date, nullable: true },
    platform_fee_bps: integer({ nullable: true }),
    platform_fee: { ...money, nullable: true },
    payment_uncertain: bool,
  }),
  BookingTicket: obj({
    id: str(),
    token: str({ description: 'Absent after a friend claims the ticket.' }),
    code: str({ description: 'Absent after a friend claims the ticket.' }),
    checked_in_at: { ...date, nullable: true },
    holder_name: str(),
    holder_phone: str({ description: 'Masked.' }),
    claimed: bool,
    invite: {
      ...obj({ name: str(), phone: str(), expires_at: timestamp, url: str() }),
      nullable: true,
    },
  }),
  PublicTicket: obj({
    code: str(),
    token: str(),
    checked_in_at: { ...date, nullable: true },
    ticket_type: str(),
    holder_name: str(),
    holder_phone: str({ description: 'Masked.' }),
    valid: bool,
  }),
  CheckInInput: obj(
    {
      event_id: str(),
      code: str({
        minLength: 1,
        maxLength: 512,
        description: 'Ticket code, token or full ticket URL read by the camera.',
      }),
    },
    ['event_id', 'code'],
  ),
  Admission: obj({
    code: str(),
    checked_in_at: date,
    ticket_type: str(),
    phone: str(),
    holder_name: str(),
  }),
  PersonInput: obj(
    { name: str({ minLength: 2, maxLength: 80 }), email: str({ format: 'email', maxLength: 200 }) },
    ['name', 'email'],
  ),
  PhoneCodeInput: obj({ phone, password }, ['phone', 'password']),
  Otp: obj(
    {
      challenge_id: str(),
      phone: str({ description: 'Masked verification destination.' }),
      expires_at: timestamp,
      expires_in: integer({ description: 'Seconds.' }),
      resend_after: integer({ description: 'Minimum seconds before requesting another code.' }),
    },
    ['challenge_id', 'phone', 'expires_at'],
  ),
  PayoutQuoteInput: obj(
    {
      amount: {
        ...money,
        minimum: 1,
        maximum: 1000000000000,
        description: 'Recipient amount; minimum is configurable, read finance.minimum.',
      },
      destination_type: str({ enum: ['mobile_money', 'bank'] }),
      channel: str({ enum: ['MPESA', 'AIRTELMONEY', 'CRDB', 'NMB'] }),
      account: str({
        minLength: 6,
        maxLength: 30,
        description:
          'Mobile number or bank-account string. Preserve leading zeros. Mobile channels must use mobile_money; banks must use bank.',
      }),
      account_name: str({
        minLength: 2,
        maxLength: 100,
        description: 'Name entered by organizer, not necessarily independently verified.',
      }),
      password,
      idempotency_key: uuid,
    },
    [
      'amount',
      'destination_type',
      'channel',
      'account',
      'account_name',
      'password',
      'idempotency_key',
    ],
  ),
  PayoutQuote: obj({
    id: str(),
    amount: money,
    fee: money,
    total: money,
    account_name: str(),
    account_name_source: str({ enum: ['rail', 'cache', 'merchant'], nullable: true }),
    destination_verification_required: bool,
    account_last4: str(),
    destination_type: str({ enum: ['mobile_money', 'bank'] }),
    channel: str(),
    expires_at: timestamp,
    demo: bool,
  }),
  DestinationCodeInput: obj({ quote_id: str(), password }, ['quote_id', 'password']),
  DestinationVerifyInput: obj({ quote_id: str(), challenge_id: str(), code }, [
    'quote_id',
    'challenge_id',
    'code',
  ]),
  PayoutCodeInput: obj(
    {
      quote_id: str(),
      account_name_confirmed: { type: 'boolean', enum: [true] },
      password,
      idempotency_key: uuid,
    },
    ['quote_id', 'account_name_confirmed', 'password', 'idempotency_key'],
  ),
  ManualPayoutCodeInput: obj(
    {
      amount: money,
      phone,
      network: str({ enum: ['mpesa', 'airtel', 'mixx', 'halopesa'] }),
      recipient_name: str({ minLength: 2, maxLength: 100 }),
      password,
      idempotency_key: uuid,
    },
    ['amount', 'phone', 'network', 'recipient_name', 'password', 'idempotency_key'],
  ),
  PayoutChallenge: obj(
    {
      challenge_id: str(),
      email: str(),
      mode: str({ enum: ['nextsms', 'email', 'demo'] }),
      expires_at: timestamp,
      amount: money,
      phone: str(),
      network: str(),
      recipient_name: str(),
      payout_fee: money,
      total: money,
      verification_phone: str({ nullable: true }),
      delivery_channel: str({ enum: ['sms', 'email'] }),
      expires_in: integer(),
      resend_after: integer(),
      demo_code: str({ description: 'Development demo only. Never present for production SMS.' }),
    },
    ['challenge_id', 'mode', 'expires_at'],
  ),
  Payout: obj({
    id: str(),
    user_id: str(),
    reference: str(),
    amount: money,
    payout_fee: money,
    currency: str(),
    phone: str(),
    network: str(),
    recipient_name: str(),
    status: str({ enum: ['requested', 'processing', 'paid', 'rejected', 'cancelled'] }),
    driver: str(),
    mode: str(),
    provider_id: str({ nullable: true }),
    transfer_reference: str({ nullable: true }),
    note: str({ nullable: true }),
    created_at: date,
  }),
  WithdrawalPreview: {
    oneOf: [
      obj({ status: str({ enum: ['destination_required', 'below_minimum', 'unavailable'] }) }, [
        'status',
      ]),
      obj(
        {
          status: str({ enum: ['quoted'] }),
          amount: money,
          fee: money,
          total: money,
          remaining: money,
          combined_fees: money,
          expires_at: timestamp,
          account: str(),
          account_name: str(),
          destination_type: str(),
          channel: str(),
        },
        ['status', 'amount', 'fee', 'total'],
      ),
    ],
  },
  Finance: obj({
    currency: str({ enum: ['TZS'] }),
    fee_bps: integer({
      description: 'Basis points; 300 is 3%. Actual historical fee snapshots remain authoritative.',
    }),
    minimum: money,
    demo: bool,
    payout_mode: str({ enum: ['manual_review', 'ecofy', 'demo'] }),
    automatic_disbursement: bool,
    verification: str({ enum: ['nextsms', 'email', 'demo', 'disabled'] }),
    verification_phone_ready: bool,
    verification_phone: str({ nullable: true }),
    gross: money,
    platform_fee: money,
    provider_fees: money,
    payout_fees: money,
    payout_fees_reserved: money,
    provider_fee_allowance_bps: integer(),
    provider_fee_reserve: money,
    provider_fees_pending: integer(),
    net_estimate: integer(),
    held: integer(),
    released: money,
    reserved: money,
    paid_out: money,
    available: money,
    withdrawal_capacity: money,
    shortfall: money,
    refunded: money,
    legacy_orders: integer(),
    withdrawal_preview: { allOf: [ref('WithdrawalPreview')], nullable: true },
    orders: list({
      allOf: [
        ref('Order'),
        obj({
          event_name: str(),
          provider_fee: { ...money, nullable: true },
          net: integer(),
          released: bool,
          legacy: bool,
        }),
      ],
    }),
    payouts: list(ref('Payout')),
  }),
  Delivery: obj({
    id: str(),
    order_id: str(),
    channel: str(),
    recipient: str(),
    body: str(),
    status: str(),
    attempts: integer(),
    error: str({ nullable: true }),
    next_attempt: timestamp,
    provider_message_id: str({ nullable: true }),
    provider_status: str({
      nullable: true,
      description: 'SMS provider acknowledgment, not proof of reading or admission.',
    }),
    created_at: date,
    reference: str(),
    event_name: str(),
  }),
  Guest: obj({
    code: str(),
    checked_in_at: { ...date, nullable: true },
    event_id: str(),
    admitted_by: str(),
    phone: str(),
    holder_name: str(),
    email: str(),
    reference: str(),
    event_name: str(),
    ticket_type: str(),
  }),
  Stats: obj({
    revenue: money,
    sold: integer(),
    paid_orders: integer(),
    pending: integer(),
    review: integer(),
    events: integer(),
    live_events: integer(),
    checked_in: integer(),
    chart: list(obj({ date: str({ format: 'date' }), revenue: money, tickets: integer() })),
  }),
  Settlement: obj({
    order_id: str(),
    provider_fee: money,
    net: money,
    reference: str(),
    actor_id: str(),
    settled_at: date,
  }),
  HealthComponent: obj({ id: str(), label: str(), status: str(), detail: str(), checked_at: date }),
  Readiness: obj({
    status: str({ enum: ['ready', 'not_ready'] }),
    checked_at: date,
    components: list(ref('HealthComponent')),
  }),
  ServiceStatus: obj({
    status: str(),
    checked_at: date,
    components: list(ref('HealthComponent')),
    monitor: str({ enum: ['on_server'] }),
    external_monitoring: bool,
    alerts: bool,
    incidents: list(
      obj({
        component: str(),
        label: str(),
        started_at: timestamp,
        resolved_at: { ...timestamp, nullable: true },
      }),
    ),
    days: list(
      obj({
        day: str({ format: 'date' }),
        checks: integer(),
        operational: integer(),
        degraded: integer(),
        down: integer(),
        unknown: integer(),
      }),
    ),
  }),
};

export function createOpenApiSpec(config) {
  const paths = {};
  const add = (method, path, tag, summary, response, options = {}) => {
    const access = options.access || 'Public';
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      description:
        name === 'token'
          ? 'Private link token; never log, index or share beyond its intended recipient.'
          : 'Resource identifier.',
      schema: str(),
    }));
    parameters.push(...(options.parameters || []));
    const responses = {
      [options.status || 200]: {
        description: options.success || 'Success.',
        content: options.content || json(response),
      },
    };
    for (const status of [400, 401, 403, 404, 409, 410, 429, 500, 502, 503])
      responses[status] = { $ref: '#/components/responses/ApiError' };
    for (const status of options.extraSuccess || [])
      responses[status] = responses[options.status || 200];
    Object.assign(responses, options.responses);
    paths[path] ||= {};
    paths[path][method] = {
      tags: [tag],
      summary,
      operationId: `${method}_${path
        .replace(/[{}]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')}`,
      description: `${roles[access]}${options.description ? `\n\n${options.description}` : ''}`,
      security: options.security || (access === 'Public' ? [] : authenticated),
      ...(parameters.length ? { parameters } : {}),
      ...(options.body
        ? { requestBody: { required: true, content: options.bodyContent || json(options.body) } }
        : {}),
      responses,
      'x-access-role': access,
      ...(options.sideEffect ? { 'x-side-effect': options.sideEffect } : {}),
    };
  };
  const account = { access: 'Account' },
    owner = { access: 'Organizer' },
    gate = { access: 'Gate' },
    admin = { access: 'Admin' };
  const mutation =
    'Browser requests require a same-origin Origin header, or an explicitly configured APP_SHELL_ORIGINS entry for a bundled Capacitor shell. Other cross-origin access stays blocked. Native requests without a mobile token must also supply Origin matching the API host (or a configured shell origin); this includes public checkout, registration and ticket-claim requests.';
  add('get', '/health', 'Service', 'Liveness', obj({ status: str({ enum: ['ok'] }) }));
  add('get', '/ready', 'Service', 'Readiness', ref('Readiness'), {
    description: 'Returns HTTP 503 if readiness fails. Does not send money or SMS.',
    responses: { 503: { description: 'Service not ready.', content: json(ref('Readiness')) } },
  });
  add(
    'get',
    '/status',
    'Service',
    'Service components, observed history and incidents',
    ref('ServiceStatus'),
    { description: 'Runs on the same VPS, not an independent uptime guarantee.' },
  );
  add(
    'get',
    '/config',
    'Service',
    'Public client configuration',
    obj({
      baseDomain: str(),
      appOrigin: str(),
      publicOrigin: str(),
      paymentDriver: str(),
      deliveryDriver: str(),
      ticketSmsDriver: str({ enum: ['outbox', 'twilio', 'nextsms'] }),
      whatsappDriver: str(),
      ticketSharing: str(),
      platformFeeBps: integer(),
      payoutDriver: str(),
      demo: bool,
    }),
  );
  add('get', '/openapi.json', 'Service', 'Download this OpenAPI contract', { type: 'object' });
  add('get', '/docs', 'Service', 'Interactive API documentation', str(), {
    content: { 'text/html': { schema: str() } },
    description:
      'Try it out is disabled in production. JavaScript and CSS assets are documentation infrastructure, not application API operations.',
  });
  add(
    'post',
    '/auth/register',
    'Authentication',
    'Register an organizer and start a browser session',
    envelope('user', ref('User')),
    {
      body: ref('Register'),
      description: `${mutation} Roles are server-assigned. For a native app, register here then call /auth/token with the same email and password. Do not use the returned browser cookie as a bearer token.`,
      sideEffect: 'Creates account and session',
    },
  );
  add(
    'post',
    '/auth/login',
    'Authentication',
    'Start a browser session',
    envelope('user', ref('User')),
    {
      body: ref('Login'),
      description:
        'Sets HttpOnly ge_session cookie for seven days. Native apps should use /auth/token instead.',
      sideEffect: 'Creates session',
    },
  );
  add('post', '/auth/token', 'Authentication', 'Sign in a native app', ref('Token'), {
    body: ref('Login'),
    description:
      'Send JSON with email/password and no Cookie or Origin for a native client. A supplied Origin must match the host or an explicitly configured app-shell origin. Returns an opaque seven-day token, not a JWT; no Set-Cookie or refresh token. Include Authorization: Bearer <access_token> thereafter. All permissions, password-change requirements and OTP rules remain enforced.',
    sideEffect: 'Creates mobile session',
  });
  add(
    'get',
    '/auth/me',
    'Authentication',
    'Read current account or null',
    obj({ user: { ...schemas.User, nullable: true } }),
    {
      security: optionalAuthentication,
      description:
        'Anonymous requests return user:null. Invalid explicit bearer tokens return 401, even if a valid cookie is also present.',
    },
  );
  add('post', '/auth/logout', 'Authentication', 'Revoke the current session or mobile token', ok, {
    security: optionalAuthentication,
    description:
      'A mobile bearer token takes precedence over a cookie. Other devices remain signed in.',
    sideEffect: 'Revokes session',
  });
  add(
    'post',
    '/auth/demo',
    'Development',
    'Open the seeded local demo workspace',
    envelope('user', ref('User')),
    { description: 'Local demo only. Production always returns 404.' },
  );
  add('put', '/settings', 'Account', 'Update profile', envelope('user', ref('User')), {
    ...account,
    body: obj(
      {
        name: str({ minLength: 2, maxLength: 80 }),
        organization: str({ maxLength: 100 }),
        phone: str({ maxLength: 30 }),
      },
      ['name', 'organization', 'phone'],
    ),
    description:
      'Editing the profile phone does not verify or change the verified payout security phone.',
  });
  add('put', '/settings/password', 'Account', 'Change password and revoke every session', ok, {
    ...account,
    body: obj({ current: password, newPassword: { ...password, minLength: 10 } }, [
      'current',
      'newPassword',
    ]),
    description:
      'Allowed during scanner first-login lock. Revokes all browser and mobile sessions, including the current one; sign in again. A temporary password must actually change.',
  });
  add(
    'get',
    '/settings/phone',
    'Account',
    'Read verified payout security-phone status',
    obj({ available: bool, verified: bool, phone: str({ nullable: true }) }),
    owner,
  );
  add('post', '/settings/phone/code', 'Account', 'Send phone verification SMS', ref('Otp'), {
    ...owner,
    body: ref('PhoneCodeInput'),
    status: 202,
    sideEffect: 'Sends SMS',
  });
  add(
    'post',
    '/settings/phone/{id}/resend',
    'Account',
    'Resend phone verification SMS',
    ref('Otp'),
    { ...owner, body: obj({ password }, ['password']), status: 202, sideEffect: 'Sends SMS' },
  );
  add(
    'post',
    '/settings/phone/{id}/verify',
    'Account',
    'Verify security phone',
    obj({ verified: bool, user: ref('User') }),
    { ...owner, body: obj({ code }, ['code']) },
  );
  add(
    'get',
    '/events',
    'Events',
    'List published future events',
    envelope('events', list(ref('Event'))),
  );
  add(
    'get',
    '/events/{slug}',
    'Events',
    'Read published, paused or cancelled event',
    envelope('event', ref('Event')),
  );
  add(
    'get',
    '/live-artwork/{filename}',
    'Development',
    'Read artwork for a mirrored live event',
    str({ format: 'binary' }),
    {
      content: Object.fromEntries(
        ['image/webp', 'image/png', 'image/jpeg'].map((type) => [
          type,
          { schema: str({ format: 'binary' }) },
        ]),
      ),
      description:
        'Local read-only preview only when LIVE_PUBLIC_ORIGIN is configured. Production returns 404. Filename must be a simple WebP/PNG/JPG/JPEG basename; never a URL or path. Live-mirrored events have readOnly=true and local checkout returns 403.',
    },
  );
  add(
    'get',
    '/organizer/events',
    'Organizer events',
    'List your events and private totals',
    envelope('events', list(ref('Event'))),
    owner,
  );
  add(
    'get',
    '/organizer/events/{id}',
    'Organizer events',
    'Read your event',
    envelope('event', ref('Event')),
    owner,
  );
  add(
    'get',
    '/organizer/slug',
    'Organizer events',
    'Suggest a unique event slug',
    obj({ slug: str() }),
    { ...owner, parameters: [{ name: 'name', in: 'query', schema: str({ default: 'event' }) }] },
  );
  add(
    'post',
    '/organizer/events',
    'Organizer events',
    'Create an event and shareable link',
    envelope('event', ref('Event')),
    { ...owner, body: ref('EventInput'), status: 201 },
  );
  add(
    'put',
    '/organizer/events/{id}',
    'Organizer events',
    'Edit your event and ticket types',
    envelope('event', ref('Event')),
    {
      ...owner,
      body: ref('EventInput'),
      description:
        'Send the full event form, including ticket types. Retain existing ticket-type IDs. Cannot remove types with orders or lower capacity below occupied tickets.',
    },
  );
  add(
    'post',
    '/uploads',
    'Organizer events',
    'Upload an event image',
    obj({ url: str({ example: '/uploads/example.webp' }) }),
    {
      ...account,
      status: 201,
      body: obj({ image: str({ format: 'binary' }) }, ['image']),
      bodyContent: {
        'multipart/form-data': { schema: obj({ image: str({ format: 'binary' }) }, ['image']) },
      },
      description:
        'Single JPG, PNG or WebP, maximum 5 MiB. Re-encoded to WebP up to 1600x1600; response URL is used as event.image.',
    },
  );
  add(
    'post',
    '/orders',
    'Checkout',
    'Reserve tickets and initiate mobile-money payment',
    ref('OrderStarted'),
    {
      status: 201,
      extraSuccess: [200],
      body: ref('OrderInput'),
      description: `${mutation} May charge real money. A 201 means initiated, not paid. Poll GET /orders/{token}. Reuse the same idempotency_key after a network failure; never create a new checkout blindly. A provider failure can return an error plus token; retain it and inspect that order.`,
      sideEffect: 'Initiates payment',
    },
  );
  add(
    'get',
    '/orders/{token}',
    'Checkout',
    'Read payment status and booking tickets',
    obj({ order: ref('Order'), event: ref('Event'), tickets: list(ref('BookingTicket')) }),
    {
      description:
        'Private booking link is the credential; no buyer account needed. Tickets appear only after verified payment. After a claim, that ticket no longer exposes its admission token/code to the buyer. payment_uncertain means check status/support rather than paying again.',
    },
  );
  add('post', '/orders/{token}/demo', 'Development', 'Approve or decline a demo order', ok, {
    body: obj({ action: str({ enum: ['approve', 'decline'] }) }, ['action']),
    description: 'Unavailable in production; returns 404. Never confirms a real payment.',
  });
  add(
    'post',
    '/orders/{token}/tickets/{id}/invite',
    'Ticket sharing',
    'Invite one friend to claim one ticket',
    obj({ url: str(), phone: str(), name: str() }),
    {
      body: obj({ name: str({ minLength: 2, maxLength: 80 }), phone }, ['name', 'phone']),
      status: 201,
      description:
        'Use the booking token and ticket ID. One invitation per ticket; four tickets can be distributed independently. Cannot transfer admitted, refunded or previously claimed tickets.',
    },
  );
  add(
    'delete',
    '/orders/{token}/tickets/{id}/invite',
    'Ticket sharing',
    'Cancel an unclaimed ticket invitation',
    ok,
  );
  add(
    'get',
    '/claims/{token}',
    'Ticket sharing',
    'Read a private claim invitation',
    obj({
      name: str(),
      phone: str(),
      ticket_type: str(),
      event: ref('Event'),
      expires_at: timestamp,
    }),
  );
  add(
    'post',
    '/claims/{token}/code',
    'Ticket sharing',
    'Send claim OTP to the invited friend',
    obj({
      phone: str(),
      expires_at: timestamp,
      resend_after: integer(),
      verification_mode: str(),
      demo_code: str({ description: 'Local demo only.' }),
    }),
    {
      status: 202,
      extraSuccess: [200],
      description:
        'No arbitrary destination accepted. OTP goes only to the invited phone. 202 for NextSMS, 200 for legacy SMS/demo. Respect resend cooldown; do not poll this endpoint.',
      sideEffect: 'Sends SMS',
    },
  );
  add(
    'post',
    '/claims/{token}/accept',
    'Ticket sharing',
    'Verify OTP and rotate ticket admission credentials',
    obj({ token: str({ description: 'New recipient-only ticket token.' }) }),
    {
      body: obj({ code, claim_key: uuid }, ['code', 'claim_key']),
      description:
        "Generate one private claim_key UUID and keep it for retries. Success invalidates the buyer's old ticket token. Only the same private claim_key can recover the successful result; do not forward it or log it.",
    },
  );
  add(
    'get',
    '/tickets/{token}',
    'Tickets',
    'Read ticket and QR image',
    obj({
      ticket: ref('PublicTicket'),
      event: ref('Event'),
      qr: str({ description: 'PNG data URL containing the private ticket link.' }),
    }),
    {
      description:
        'Private ticket token is the credential. valid describes payment/event state; checked_in_at determines prior admission. No re-entry or offline scan acceptance.',
    },
  );
  add(
    'get',
    '/tickets/{token}/image',
    'Tickets',
    'Download branded ticket PNG',
    str({ format: 'binary' }),
    {
      content: { 'image/png': { schema: str({ format: 'binary' }) } },
      description:
        'Attachment response. Rejects revoked tokens, unpaid/refunded orders and cancelled events.',
    },
  );
  add(
    'get',
    '/scanner/events',
    'Scanning',
    'List events this account may scan',
    envelope(
      'events',
      list(
        obj({
          id: str(),
          name: str(),
          starts_at: date,
          venue: str(),
          city: str(),
          status: str(),
          image: str(),
          category: str(),
        }),
      ),
    ),
    { access: 'Scanner' },
  );
  add(
    'post',
    '/scanner/check-in',
    'Scanning',
    'Validate ticket and admit once',
    envelope('ticket', ref('Admission')),
    {
      access: 'Scanner',
      body: ref('CheckInInput'),
      description:
        'Requires online server validation. First admission returns 200; duplicates return 409, revoked assignments block immediately. Scanner response masks buyer phone. Do not infer authenticity by rendering the QR locally.',
      sideEffect: 'Admits attendee',
    },
  );
  add(
    'post',
    '/organizer/check-in',
    'Scanning',
    'Owner admission endpoint',
    envelope('ticket', ref('Admission')),
    { ...owner, body: ref('CheckInInput'), sideEffect: 'Admits attendee' },
  );
  add(
    'get',
    '/gate/events',
    'Gate team',
    'List events you can manage',
    obj({
      events: list(obj({ id: str(), name: str(), starts_at: date, status: str() })),
      email_available: bool,
    }),
    gate,
  );
  add(
    'get',
    '/gate/events/{id}/team',
    'Gate team',
    'List assigned scanners and pending invites',
    obj({
      scanners: list(
        obj({ id: str(), name: str(), email: str(), source: str(), created_at: date }),
      ),
      invites: list(
        obj({ id: str(), name: str(), email: str(), source: str(), expires_at: timestamp }),
      ),
    }),
    gate,
  );
  add(
    'post',
    '/gate/events/{id}/scanners',
    'Gate team',
    'Create or assign a scanner account',
    obj({
      account: obj({ id: str(), name: str(), email: str() }),
      created: bool,
      temporary_password: str({
        description:
          'Returned once for new accounts only. Share privately; forced password change on first sign-in.',
      }),
      login_url: str(),
    }),
    {
      ...gate,
      body: ref('PersonInput'),
      status: 201,
      description:
        'Existing accounts retain their role and password; no credentials returned for existing accounts.',
    },
  );
  add(
    'post',
    '/gate/events/{id}/invites',
    'Gate team',
    'Create scanner invitation',
    obj({ id: str(), url: str(), email_delivery: str({ enum: ['sent', 'failed'] }) }),
    {
      ...gate,
      status: 201,
      body: {
        allOf: [
          ref('PersonInput'),
          obj({ delivery: str({ enum: ['link', 'email'], default: 'link' }) }),
        ],
      },
      description:
        'Seven-day, single-use link. Email is optional and must be configured. A failed email leaves a usable manual link.',
      sideEffect: 'May send email',
    },
  );
  add(
    'delete',
    '/gate/events/{id}/scanners/{userId}',
    'Gate team',
    'Revoke event scanner assignment immediately',
    ok,
    gate,
  );
  add(
    'delete',
    '/gate/events/{id}/invites/{inviteId}',
    'Gate team',
    'Cancel a pending scanner invitation',
    ok,
    gate,
  );
  add(
    'get',
    '/scanner-invites/{token}',
    'Gate team',
    'Read scanner invitation',
    obj({
      name: str(),
      email: str(),
      event_name: str(),
      expires_at: timestamp,
      existing_account: bool,
    }),
  );
  add(
    'post',
    '/scanner-invites/{token}/accept',
    'Gate team',
    'Accept scanner invitation and start browser session',
    envelope('user', ref('User')),
    {
      body: obj({ password: { ...password, minLength: 10 } }),
      security: optionalAuthentication,
      description:
        'New accounts set a password. Existing accounts must authenticate with the invitation email before acceptance; use cookie or mobile token. Native clients then sign in with /auth/token if needed.',
    },
  );
  add(
    'get',
    '/organizer/orders',
    'Organizer reports',
    'List orders for owned events',
    envelope(
      'orders',
      list({ allOf: [ref('Order'), obj({ event_name: str(), slug: str(), ticket_type: str() })] }),
    ),
    owner,
  );
  add(
    'get',
    '/organizer/guests',
    'Organizer reports',
    'List paid attendees and admission operators',
    envelope('guests', list(ref('Guest'))),
    owner,
  );
  add(
    'get',
    '/organizer/stats',
    'Organizer reports',
    'Sales totals and seven-day chart',
    ref('Stats'),
    { ...owner, description: 'Chart day boundaries use Africa/Dar_es_Salaam.' },
  );
  add(
    'get',
    '/organizer/deliveries',
    'Organizer reports',
    'List ticket message deliveries',
    envelope('deliveries', list(ref('Delivery'))),
    owner,
  );
  add(
    'post',
    '/organizer/deliveries/{id}/retry',
    'Organizer reports',
    'Queue a ticket message retry',
    ok,
    { ...owner, sideEffect: 'Queues message' },
  );
  add(
    'post',
    '/organizer/orders/{id}/refund',
    'Organizer reports',
    'Refund a demo order only',
    ok,
    {
      ...owner,
      description:
        'Real provider refunds are NOT implemented: production returns 503 and does not refund money. Demo refunds reject admitted tickets, released settlements or sales backing a payout.',
    },
  );
  add(
    'get',
    '/organizer/finance',
    'Payouts',
    'Earnings, actual fees, take-home preview and payout history',
    ref('Finance'),
    {
      ...owner,
      description:
        'Read withdrawal_preview.amount only when status=quoted, otherwise show unavailable/destination required. available is an allowance-based cap, NOT guaranteed take-home. Preview is non-authorizing and expires; get a fresh quote for a withdrawal. GET may request cached non-transferring provider quotes. The separate platform cut plus combined collection/payout charges plus net earnings must reconcile; never deduct the allowance twice.',
    },
  );
  add(
    'post',
    '/organizer/payouts/quote',
    'Payouts',
    'Quote a withdrawal without sending money',
    envelope('quote', ref('PayoutQuote')),
    {
      ...owner,
      body: ref('PayoutQuoteInput'),
      description:
        'Requires account password and verified security phone in production. Use a new UUID for a changed amount/destination, same UUID on identical retries. No external recipient lookup; merchant-supplied name is not independent identity verification. On 409, payout_adjustment can suggest a smaller amount; obtain a NEW quote before authorization.',
    },
  );
  add(
    'post',
    '/organizer/payouts/destination/code',
    'Payouts',
    'Send OTP to a different mobile payout destination',
    ref('Otp'),
    {
      ...owner,
      body: ref('DestinationCodeInput'),
      status: 202,
      description:
        'Only when quote.destination_verification_required is true. This does not replace organizer authorization or update the security phone.',
      sideEffect: 'Sends SMS',
    },
  );
  add(
    'post',
    '/organizer/payouts/destination/verify',
    'Payouts',
    'Verify destination-only OTP',
    obj({ verified: bool }),
    { ...owner, body: ref('DestinationVerifyInput') },
  );
  add(
    'post',
    '/organizer/payouts/code',
    'Payouts',
    'Send fresh organizer authorization code for this withdrawal',
    ref('PayoutChallenge'),
    {
      ...owner,
      body: { oneOf: [ref('PayoutCodeInput'), ref('ManualPayoutCodeInput')] },
      status: 202,
      extraSuccess: [200],
      description:
        'Automatic mode uses PayoutCodeInput. Complete separate destination proof first if required. Send a fresh idempotency_key for this authorization; reuse it only for identical retries. Fresh organizer OTP is required EVERY withdrawal. 202 for NextSMS, 200 for demo/email; manual_review uses ManualPayoutCodeInput.',
      sideEffect: 'Sends OTP',
    },
  );
  add(
    'post',
    '/organizer/payouts/{id}/confirm',
    'Payouts',
    'Authorize transfer using the fresh organizer OTP',
    envelope('payout', ref('Payout')),
    {
      ...owner,
      body: obj({ code }, ['code']),
      description:
        'id is challenge_id from /payouts/code, not a quote or payout ID. In automatic mode this endpoint sends real money. On timeout or unreadable response, inspect finance.payouts; processing is NOT paid or failed. Never create a new withdrawal to compensate for an uncertain one. Provider completion is reconciled server-side.',
      sideEffect: 'Transfers real money in automatic production mode',
    },
  );
  add(
    'post',
    '/organizer/payouts/{id}/cancel',
    'Payouts',
    'Cancel a review-stage payout request',
    envelope('payout', ref('Payout')),
    {
      ...owner,
      description:
        'id is the payout request ID. Processing/completed transfers cannot be cancelled here.',
    },
  );
  add(
    'get',
    '/admin',
    'Administration',
    'Platform accounts, events and orders needing review',
    obj({
      users: list(ref('User')),
      events: list(ref('Event')),
      review: list(obj({ reference: str(), amount: money, phone: str(), event_name: str() })),
    }),
    admin,
  );
  add(
    'get',
    '/admin/otp',
    'Administration',
    'Redacted OTP diagnostics',
    obj({
      available: bool,
      window_minutes: integer(),
      counts: { type: 'object', additionalProperties: integer() },
      p95_latency_ms: { ...integer(), nullable: true },
      recent: list(
        obj({
          id: str(),
          phone: str(),
          purpose: str(),
          status: str(),
          attempts: integer(),
          provider_message_id: str({ nullable: true }),
          created_at: timestamp,
          latency_ms: integer({ nullable: true }),
          error_code: str({ nullable: true }),
        }),
      ),
    }),
    admin,
  );
  add(
    'get',
    '/admin/finance',
    'Administration',
    'Settlements, payout requests and audit history',
    obj({
      demo: bool,
      automatic_disbursement: bool,
      settlements: list({
        allOf: [ref('Order'), obj({ event_name: str(), owner_name: str(), owner_email: str() })],
      }),
      payouts: list(ref('Payout')),
      audit: list(
        obj({
          id: str(),
          payout_id: str(),
          actor_id: str(),
          actor_name: str(),
          action: str(),
          note: str(),
          created_at: date,
        }),
      ),
    }),
    admin,
  );
  add(
    'post',
    '/admin/finance/orders/{id}/reconcile',
    'Administration',
    'Record actually received manual settlement funds',
    envelope('settlement', ref('Settlement')),
    {
      ...admin,
      body: obj(
        {
          provider_fee: money,
          reference: str({ minLength: 4, maxLength: 120 }),
          funds_received: { type: 'boolean', enum: [true] },
        },
        ['provider_fee', 'reference', 'funds_received'],
      ),
      description:
        'Records reconciliation, not a payment collection. Requires actual funds received; automatic Ecofy reconciliation is server-owned.',
    },
  );
  add(
    'post',
    '/admin/payouts/{id}/review',
    'Administration',
    'Review a manual payout',
    envelope('payout', ref('Payout')),
    {
      ...admin,
      body: obj(
        {
          action: str({ enum: ['processing', 'paid', 'rejected'] }),
          note: str({ minLength: 5, maxLength: 500 }),
          transfer_reference: str({ minLength: 4, maxLength: 120 }),
          transfer_confirmed: bool,
          confirmed_not_sent: bool,
        },
        ['action', 'note'],
      ),
      description:
        'Manual-mode bookkeeping only. Marking paid requires a transfer reference and transfer_confirmed=true; rejecting after processing requires confirmed_not_sent=true. Cannot force automatic provider payouts into paid.',
    },
  );
  add('post', '/admin/events/{id}/status', 'Administration', 'Moderate an event', ok, {
    ...admin,
    body: obj({ status: str({ enum: ['paused', 'published', 'cancelled'] }) }, ['status']),
  });
  add('post', '/webhooks/ecofy', 'Provider webhooks', 'Receive signed Ecofy payment callback', ok, {
    access: 'Provider',
    security: [{ ecofySignature: [] }],
    body: {
      type: 'object',
      description:
        'Provider payment object or signed payment.<status> envelope; exact raw JSON bytes are signed.',
    },
    description:
      'Server-to-server only. ecofy-signature is checked on raw bytes; event data is queued and payment verified with provider before ticket issuance. Mobile clients cannot use callbacks to mark orders paid.',
  });
  add('post', '/webhooks/flutterwave', 'Provider webhooks', 'Receive Flutterwave callback', ok, {
    access: 'Provider',
    security: [{ flutterwaveSignature: [] }],
    body: obj({
      event: str(),
      data: obj({ id: { oneOf: [str(), integer()] }, tx_ref: str(), status: str() }),
    }),
    description:
      'Server-to-server only. Requires configured verif-hash. Does not trust a mobile success screen as payment proof.',
  });
  return {
    openapi: '3.0.3',
    info: {
      title: 'Golden Events API',
      version: '1.0.0',
      description: `Developer contract for the existing Golden Events backend.\n\nBase URL: ${config.appOrigin}/api. Amounts are whole TZS; integer timestamps are milliseconds, ISO dates include timezone. Roles: organizer, scanner, admin. Attendees use private booking/ticket/claim tokens, not account login.\n\nNative login: POST /auth/token with email/password; securely store the opaque seven-day token and send Authorization: Bearer <access_token>. Password changes revoke all sessions; logout revokes the current session. No refresh tokens or JWT decoding. Browser sessions keep HttpOnly cookies and same-origin checks. ${mutation}\n\nWorkflows and runnable examples are in docs/mobile-api.md in the repository. Checkout and payout confirmation can move real money. Never put Ecofy or NextSMS keys in an app. Production Swagger is read-only; use an isolated local demo for interactive tests.`,
    },
    servers: [
      { url: '/api', description: 'This host (Swagger)' },
      { url: `${config.appOrigin}/api`, description: 'Configured application API' },
    ],
    tags: [
      'Authentication',
      'Account',
      'Events',
      'Organizer events',
      'Checkout',
      'Tickets',
      'Ticket sharing',
      'Scanning',
      'Gate team',
      'Organizer reports',
      'Payouts',
      'Administration',
      'Service',
      'Development',
      'Provider webhooks',
    ].map((name) => ({ name })),
    paths,
    components: {
      schemas,
      securitySchemes: {
        mobileToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque',
          description:
            'Obtain with POST /auth/token. Never use a browser cookie value or provider API key.',
        },
        browserSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'ge_session',
          description:
            'Set by browser login/register. Browser writes require a same-origin Origin header or a configured app-shell origin. Bundled shell cookie clients use credentials: include; production cookies are Secure with SameSite=None.',
        },
        ecofySignature: {
          type: 'apiKey',
          in: 'header',
          name: 'ecofy-signature',
          description: 'Provider-only signature of the exact raw callback body.',
        },
        flutterwaveSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'verif-hash',
          description: 'Provider-only webhook secret. Not a mobile credential.',
        },
      },
      responses: {
        ApiError: {
          description:
            'JSON error. 400 validation; 401 sign-in/password/token; 403 role/origin; 404 missing/not owned; 409 state, balance or expiry conflict; 410 expired invitation; 429 rate limit; 500 internal; 502/503 provider or configuration unavailable. Not every operation emits every status. Check history before retrying uncertain financial operations.',
          content: json(ref('Error')),
        },
      },
    },
  };
}
