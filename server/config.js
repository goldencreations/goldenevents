import path from 'node:path';

export function makeConfig(overrides = {}) {
  const production = process.env.NODE_ENV === 'production';
  const config = {
    production,
    port: Number(process.env.PORT || 3001),
    dataDir: path.resolve(process.env.DATA_DIR || 'data'),
    baseDomain: process.env.BASE_DOMAIN || 'goldencreation.localhost',
    publicOrigin: process.env.PUBLIC_ORIGIN || 'http://goldencreation.localhost:5173',
    appOrigin: process.env.APP_ORIGIN || 'http://app.goldencreation.localhost:5173',
    paymentDriver: process.env.PAYMENT_DRIVER || (production ? 'disabled' : 'demo'),
    ecofyBaseUrl: process.env.ECOFY_BASE_URL || 'https://ecofypay.ecofy.co.tz',
    ecofyApiKey: process.env.ECOFY_API_KEY || '',
    ecofyWebhookSecret: process.env.ECOFY_WEBHOOK_SECRET || '',
    seedDemo:
      process.env.SEED_DEMO === 'true' || (!production && process.env.SEED_DEMO !== 'false'),
    deliveryDriver: process.env.DELIVERY_DRIVER || 'outbox',
    payoutDriver: process.env.PAYOUT_DRIVER || '',
    payoutOtpDriver: process.env.PAYOUT_OTP_DRIVER || 'auto',
    nextsmsEnabled: process.env.NEXTSMS_ENABLED === 'true',
    nextsmsBaseUrl: process.env.NEXTSMS_BASE_URL || 'https://messaging-service.co.tz',
    nextsmsApiVersion: process.env.NEXTSMS_API_VERSION || '1',
    nextsmsUsername: process.env.NEXTSMS_USERNAME || '',
    nextsmsPassword: process.env.NEXTSMS_PASSWORD || '',
    nextsmsSenderId: process.env.NEXTSMS_SENDER_ID || '',
    otpLength: Number(process.env.OTP_LENGTH || 6),
    otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60),
    otpSendLimitPerHour: Number(process.env.OTP_SEND_LIMIT_PER_HOUR || 5),
    otpVerificationTtlMinutes: Number(process.env.OTP_VERIFICATION_TTL_MINUTES || 15),
    platformFeeBps:
      process.env.PLATFORM_FEE_BPS === undefined ? 500 : Number(process.env.PLATFORM_FEE_BPS),
    payoutMinimum:
      process.env.PAYOUT_MINIMUM_TZS === undefined ? 1000 : Number(process.env.PAYOUT_MINIMUM_TZS),
    apiRateLimit: process.env.NODE_ENV === 'test' ? 1200 : 240,
    workerHealth: { startedAt: null, lastCompleted: null, lastFailed: null },
    ...overrides,
  };
  if (!['demo', 'disabled', 'flutterwave', 'ecofy'].includes(config.paymentDriver))
    throw new Error('Unknown payment driver');
  if (!['auto', 'email', 'nextsms'].includes(config.payoutOtpDriver))
    throw new Error('Unknown payout OTP driver.');
  const smsUrl = new URL(config.nextsmsBaseUrl);
  if (
    smsUrl.protocol !== 'https:' ||
    smsUrl.username ||
    smsUrl.password ||
    smsUrl.search ||
    smsUrl.hash ||
    smsUrl.pathname !== '/'
  )
    throw new Error('NextSMS base URL must be an HTTPS origin.');
  config.nextsmsBaseUrl = smsUrl.origin;
  if (!['1', '2'].includes(String(config.nextsmsApiVersion)))
    throw new Error('NextSMS API version must be 1 or 2.');
  if (
    config.nextsmsEnabled &&
    (!config.nextsmsUsername ||
      !config.nextsmsPassword ||
      !/^[A-Za-z0-9][A-Za-z0-9 ]{0,10}$/.test(config.nextsmsSenderId))
  )
    throw new Error(
      'NextSMS requires separate credentials and an approved Sender ID (1-11 characters).',
    );
  if (config.production && config.smsGateway)
    throw new Error('Test SMS gateways are forbidden in production.');
  if (
    config.otpLength !== 6 ||
    !Number.isInteger(config.otpTtlMinutes) ||
    config.otpTtlMinutes < 1 ||
    config.otpTtlMinutes > 5 ||
    !Number.isInteger(config.otpMaxAttempts) ||
    config.otpMaxAttempts < 1 ||
    config.otpMaxAttempts > 5 ||
    !Number.isInteger(config.otpResendCooldownSeconds) ||
    config.otpResendCooldownSeconds < 60 ||
    config.otpResendCooldownSeconds > 3600 ||
    !Number.isInteger(config.otpSendLimitPerHour) ||
    config.otpSendLimitPerHour < 1 ||
    config.otpSendLimitPerHour > 5 ||
    !Number.isInteger(config.otpVerificationTtlMinutes) ||
    config.otpVerificationTtlMinutes < 1 ||
    config.otpVerificationTtlMinutes > 15
  )
    throw new Error(
      'OTP settings must preserve six digits, five-minute expiry, five attempts, 60-second cooldown and bounded send limits.',
    );
  config.payoutDriver ||= !config.production && config.paymentDriver === 'demo' ? 'demo' : 'manual';
  if (!['manual', 'demo', 'ecofy'].includes(config.payoutDriver))
    throw new Error('Unknown payout driver.');
  if (config.payoutDriver === 'demo' && (config.production || config.paymentDriver !== 'demo'))
    throw new Error('Demo payouts require local demo payments.');
  if (config.payoutDriver === 'ecofy' && config.paymentDriver !== 'ecofy')
    throw new Error('Ecofy payouts require Ecofy collections and credentials.');
  if (
    !Number.isInteger(config.platformFeeBps) ||
    config.platformFeeBps < 0 ||
    config.platformFeeBps > 10000
  )
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 10000.');
  if (!Number.isSafeInteger(config.payoutMinimum) || config.payoutMinimum < 1)
    throw new Error('PAYOUT_MINIMUM_TZS must be a positive whole-shilling amount.');
  if (config.production && (config.paymentDriver === 'demo' || config.seedDemo))
    throw new Error('Demo payments and demo seeding are not allowed in production.');
  if (
    config.production &&
    ![config.publicOrigin, config.appOrigin].every((origin) => origin.startsWith('https://'))
  )
    throw new Error('Production origins must use HTTPS.');
  if (
    config.paymentDriver === 'flutterwave' &&
    (!process.env.FLW_SECRET_KEY || !process.env.FLW_SECRET_HASH)
  )
    throw new Error('Flutterwave credentials and webhook secret are required.');
  if (config.paymentDriver === 'ecofy') {
    const url = new URL(config.ecofyBaseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Ecofy base URL must be an HTTPS origin.');
    config.ecofyBaseUrl = url.origin;
    if (!config.ecofyApiKey || !config.ecofyWebhookSecret)
      throw new Error('Ecofy API key and webhook signing secret are required.');
    if (config.production && !config.ecofyApiKey.startsWith('sk_live_'))
      throw new Error('Production Ecofy payments require a live key.');
  }
  return config;
}

export function eventUrl(config, slug) {
  const origin = new URL(config.publicOrigin);
  return `${origin.protocol}//${slug}.${config.baseDomain}${origin.port ? `:${origin.port}` : ''}`;
}
