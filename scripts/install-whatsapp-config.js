import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [incoming, target] = process.argv.slice(2);
if (!incoming || !target) throw new Error('Provide incoming and production environment paths.');
const incomingSettings = parseEnv(readFileSync(incoming, 'utf8'));
const keys = [
  'WHATSAPP_DRIVER',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_GRAPH_API_VERSION',
  'WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_TEMPLATE_LANGUAGE',
];
const settings = keys.map((key) => {
  const value = incomingSettings[key];
  if (!value || !/^[a-zA-Z0-9_.-]+$/.test(value)) throw new Error(`Invalid or missing ${key}.`);
  return `${key}=${value}`;
});
const existing = readFileSync(target, 'utf8')
  .split(/\r?\n/)
  .filter((line) => !keys.includes(line.split('=')[0].trim()));
const temporary = `${target}.whatsapp-tmp`;
writeFileSync(temporary, `${existing.join('\n').trimEnd()}\n${settings.join('\n')}\n`, {
  mode: 0o600,
});
chmodSync(temporary, 0o600);
renameSync(temporary, target);
console.log('WhatsApp settings installed; credentials were not printed.');
