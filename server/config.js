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
    seedDemo:
      process.env.SEED_DEMO === 'true' || (!production && process.env.SEED_DEMO !== 'false'),
    deliveryDriver: process.env.DELIVERY_DRIVER || 'outbox',
    ...overrides,
  };
  if (!['demo', 'disabled', 'flutterwave'].includes(config.paymentDriver))
    throw new Error('Unknown payment driver');
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
  return config;
}

export function eventUrl(config, slug) {
  const origin = new URL(config.publicOrigin);
  return `${origin.protocol}//${slug}.${config.baseDomain}${origin.port ? `:${origin.port}` : ''}`;
}
