import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function prepareEcofy(env) {
  const origin = new URL(env.ECOFY_BASE_URL || 'https://ecofypay.ecofy.co.tz');
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('Ecofy requires an HTTPS origin without credentials or a path.');
  if (!env.ECOFY_API_KEY?.startsWith('sk_live_'))
    throw new Error('Enter your live key privately as ECOFY_API_KEY before running setup.');
  const publicOrigin = new URL(env.PUBLIC_ORIGIN);
  if (
    publicOrigin.protocol !== 'https:' ||
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== '/' ||
    publicOrigin.search ||
    publicOrigin.hash
  )
    throw new Error('The webhook needs a public HTTPS origin.');
  const call = async (pathname, options = {}) => {
    const response = await fetch(`${origin.origin}${pathname}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${env.ECOFY_API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new Error(
        'Ecofy rejected setup. Check account activation and credentials; no payments were created.',
      );
    return response.json();
  };
  const merchant = await call('/v1/merchant');
  if (merchant.status !== 'active' || merchant.mode !== 'live')
    throw new Error('Ecofy must confirm an active live merchant before setup can continue.');
  const callback = `${publicOrigin.origin}/api/webhooks/ecofy`;
  let secret = env.ECOFY_WEBHOOK_SECRET;
  if (!secret) {
    const endpoint = await call('/v1/webhook-endpoints', {
      method: 'POST',
      headers: {
        'Idempotency-Key': `goldenevents-webhook-${createHash('sha256').update(callback).digest('hex').slice(0, 32)}`,
      },
      body: JSON.stringify({ url: callback }),
    });
    if (
      endpoint.url !== callback ||
      endpoint.enabled !== true ||
      typeof endpoint.secret !== 'string' ||
      !endpoint.secret.startsWith('whsec_')
    )
      throw new Error(
        'Ecofy did not return the webhook signing secret. Contact Ecofy before enabling payments.',
      );
    secret = endpoint.secret;
  }
  return { ECOFY_BASE_URL: origin.origin, ECOFY_WEBHOOK_SECRET: secret };
}

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node scripts/configure-ecofy.js /setup/.env.production');
  const stat = statSync(filename);
  if ((stat.mode & 0o077) !== 0)
    throw new Error('The environment file must be private (chmod 600).');
  const original = readFileSync(filename, 'utf8');
  const env = parseEnv(original);
  const values = await prepareEcofy(env);
  let updated = original;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    if ([...updated.matchAll(pattern)].length > 1)
      throw new Error('Remove duplicate Ecofy settings before setup.');
    const line = `${key}=${JSON.stringify(value)}`;
    updated = pattern.test(updated)
      ? updated.replace(pattern, () => line)
      : `${updated.trimEnd()}\n${line}\n`;
  }
  const temporary = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(temporary, updated, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, filename);
  console.log(
    'Active live merchant verified; webhook signing secret saved privately. No payments were created. PAYMENT_DRIVER was not changed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Ecofy setup did not complete. Check the private environment file and merchant activation; retry with the same configuration. No payments were created.',
    );
    process.exitCode = 1;
  });
