import {
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  copyFileSync,
  statSync,
  chownSync,
  constants,
} from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { makeConfig } from '../server/config.js';

const keys = [
  'NEXTSMS_ENABLED',
  'NEXTSMS_BASE_URL',
  'NEXTSMS_API_VERSION',
  'NEXTSMS_USERNAME',
  'NEXTSMS_PASSWORD',
  'NEXTSMS_SENDER_ID',
  'PAYOUT_OTP_DRIVER',
];

export function installNextSms(incoming, target, enable = false) {
  const supplied = parseEnv(incoming);
  const settings = {
    NEXTSMS_ENABLED: enable ? 'true' : 'false',
    NEXTSMS_BASE_URL: supplied.NEXTSMS_BASE_URL || 'https://messaging-service.co.tz',
    NEXTSMS_API_VERSION: supplied.NEXTSMS_API_VERSION || '2',
    NEXTSMS_USERNAME: supplied.NEXTSMS_USERNAME || '',
    NEXTSMS_PASSWORD: supplied.NEXTSMS_PASSWORD || '',
    NEXTSMS_SENDER_ID: supplied.NEXTSMS_SENDER_ID || '',
    PAYOUT_OTP_DRIVER: 'nextsms',
  };
  for (const [key, value] of Object.entries(settings)) {
    if (!value || /[\r\n\0]/.test(value) || value.includes('"'))
      throw new Error(`Invalid or missing ${key}.`);
  }
  makeConfig({
    production: false,
    paymentDriver: 'demo',
    payoutDriver: 'demo',
    seedDemo: false,
    nextsmsEnabled: true,
    nextsmsBaseUrl: settings.NEXTSMS_BASE_URL,
    nextsmsApiVersion: settings.NEXTSMS_API_VERSION,
    nextsmsUsername: settings.NEXTSMS_USERNAME,
    nextsmsPassword: settings.NEXTSMS_PASSWORD,
    nextsmsSenderId: settings.NEXTSMS_SENDER_ID,
  });

  const current = readFileSync(target, 'utf8'),
    parsed = parseEnv(current);
  // Preserve unrelated credentials and formatting; refuse multiline managed entries.
  if (keys.some((key) => /[\r\n]/.test(parsed[key] || '')))
    throw new Error('Multiline NextSMS settings require manual review.');
  const retained = current
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !keys.includes(match[1]);
    })
    .join('\n')
    .trimEnd();
  const merged = `${retained}\n${Object.entries(settings)
    .map(([key, value]) => `${key}="${value}"`)
    .join('\n')}\n`;
  const verified = parseEnv(merged);
  for (const [key, value] of Object.entries(parsed)) {
    if (!keys.includes(key) && verified[key] !== value)
      throw new Error('Unrelated environment settings would change. Installation stopped.');
  }
  for (const [key, value] of Object.entries(settings)) {
    if (verified[key] !== value) throw new Error(`Could not safely encode ${key}.`);
  }
  const suffix = randomUUID(),
    backup = `${target}.nextsms-backup-${suffix}`,
    temporary = `${target}.nextsms-tmp-${suffix}`;
  const owner = statSync(target),
    mode = (owner.mode & 0o777) === 0o640 ? 0o640 : 0o600;
  chmodSync(target, mode);
  copyFileSync(target, backup, constants.COPYFILE_EXCL);
  chmodSync(backup, 0o600);
  writeFileSync(temporary, merged, { mode: 0o600, flag: 'wx' });
  chownSync(temporary, owner.uid, owner.gid);
  chmodSync(temporary, mode);
  renameSync(temporary, target);
  return { backup, enabled: enable };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [incoming, target, flag] = process.argv.slice(2);
    if (!incoming || !target || (flag && flag !== '--enable'))
      throw new Error(
        'Provide incoming and target paths, optionally --enable. Use - for private standard input.',
      );
    const result = installNextSms(
      readFileSync(incoming === '-' ? 0 : incoming, 'utf8'),
      target,
      flag === '--enable',
    );
    console.log(JSON.stringify({ ...result, credentials: 'installed; not printed' }));
  } catch (error) {
    // Only our validation messages are safe; never print input or provider credentials.
    console.error(
      error.code ? 'NextSMS environment installation failed; check file access.' : error.message,
    );
    process.exitCode = 1;
  }
}
