import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { installNextSms } from '../scripts/install-nextsms-config.js';

test('NextSMS installer activates only with explicit flag, preserves production settings, and backs up privately', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nextsms-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, '.env.production');
  const original =
    '# Provider settings\nPAYMENT_DRIVER=ecofy\nECOFY_API_KEY=fixture-secret\nSMTP_FROM="Golden Events <tickets@example.com>"\nexport NEXTSMS_ENABLED=false\nNEXTSMS_USERNAME=old\nNEXTSMS_USERNAME=duplicate\n';
  writeFileSync(target, original);
  const incoming =
    'NEXTSMS_BASE_URL=https://messaging-service.co.tz\nNEXTSMS_USERNAME=dedicated-fixture\nNEXTSMS_PASSWORD="fixture-p@ss#word"\nNEXTSMS_SENDER_ID=GoldenECARD\n';
  const result = installNextSms(incoming, target, true),
    merged = parseEnv(readFileSync(target, 'utf8'));
  assert.equal(merged.NEXTSMS_ENABLED, 'true');
  assert.equal(merged.PAYOUT_OTP_DRIVER, 'nextsms');
  assert.equal(merged.NEXTSMS_PASSWORD, 'fixture-p@ss#word');
  assert.equal(merged.NEXTSMS_USERNAME, 'dedicated-fixture');
  assert.equal(merged.PAYMENT_DRIVER, 'ecofy');
  assert.equal(merged.ECOFY_API_KEY, 'fixture-secret');
  assert.equal(merged.SMTP_FROM, 'Golden Events <tickets@example.com>');
  assert.equal(readFileSync(result.backup, 'utf8'), original);
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.equal(statSync(result.backup).mode & 0o777, 0o600);
  installNextSms(incoming, target);
  assert.equal(parseEnv(readFileSync(target, 'utf8')).NEXTSMS_ENABLED, 'false');
  chmodSync(target, 0o640);
  const previous = statSync(target);
  const shared = installNextSms(incoming, target, true);
  assert.equal(statSync(target).mode & 0o777, 0o640);
  assert.equal(statSync(target).uid, previous.uid);
  assert.equal(statSync(target).gid, previous.gid);
  assert.equal(statSync(shared.backup).mode & 0o777, 0o600);
});
test('invalid SMS input leaves target untouched and cannot inject environment settings', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nextsms-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, '.env.production'),
    original = 'PAYMENT_DRIVER=ecofy\n';
  writeFileSync(target, original);
  for (const input of [
    'NEXTSMS_USERNAME=only-key',
    'NEXTSMS_USERNAME=fixture\nNEXTSMS_PASSWORD="line\nbreak"\nNEXTSMS_SENDER_ID=GoldenECARD',
    'NEXTSMS_USERNAME=fixture\nNEXTSMS_PASSWORD=fixture\nNEXTSMS_SENDER_ID=SenderTooLongForSMS',
    'NEXTSMS_USERNAME=fixture\nNEXTSMS_PASSWORD=fixture\nNEXTSMS_SENDER_ID=GoldenECARD\nNEXTSMS_BASE_URL=http://example.com',
  ]) {
    assert.throws(() => installNextSms(input, target, true));
    assert.equal(readFileSync(target, 'utf8'), original);
  }
});
