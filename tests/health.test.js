import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';
import { createHealthMonitor, overallHealth } from '../server/health.js';
import { createApp } from '../server/app.js';

function fixture(t, patch = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-health-'));
  const db = openDatabase(dir);
  let now = Math.floor(Date.now() / 60000) * 60000 + 1000;
  const config = makeConfig({
    dataDir: dir,
    production: false,
    seedDemo: false,
    paymentDriver: 'ecofy',
    ecofyApiKey: 'sk_test_fixture',
    ecofyWebhookSecret: 'whsec_fixture',
    workerHealth: { startedAt: now - 10000, lastCompleted: now - 1000, lastFailed: null },
    ...patch,
  });
  let calls = 0,
    providerHealthy = true;
  const health = createHealthMonitor(db, config, {
    clock: () => now,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://ecofypay.ecofy.co.tz/healthz');
      assert.equal(options.method, undefined);
      assert.equal(options.headers.Authorization, undefined);
      return new Response(JSON.stringify({ status: providerHealthy ? 'ok' : 'unhealthy' }));
    },
    statfs: () => ({ bavail: 1_000_000, bsize: 4096 }),
  });
  t.after(() => {
    health.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    db,
    config,
    health,
    calls: () => calls,
    setProvider: (value) => (providerHealthy = value),
    advance: (ms) => {
      now += ms;
      config.workerHealth.lastCompleted = now - 1000;
    },
    now: () => now,
  };
}

test('deep health verifies database writes, worker, and provider without charging or exposing secrets', async (t) => {
  const { db, health } = fixture(t);
  const result = await health.collect();
  assert.equal(result.status, 'operational');
  assert.equal(result.external_monitoring, false);
  assert.equal(result.alerts, false);
  assert.equal(result.components.find((c) => c.id === 'database').status, 'operational');
  assert.ok(db.prepare('SELECT checked_at FROM health_probe WHERE id=1').get().checked_at);
  for (const id of ['sms', 'email', 'whatsapp'])
    assert.equal(result.components.find((c) => c.id === id).status, 'not_configured');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n, 0);
  const encoded = JSON.stringify(result);
  for (const secret of ['sk_test_fixture', 'whsec_fixture', 'password', 'dataDir', 'provider_id'])
    assert.equal(encoded.includes(secret), false);
  assert.equal(health.readiness().status, 'ready');
});

test('health caches concurrent checks and limits provider calls and recorded samples', async (t) => {
  const { db, health, calls, advance } = fixture(t);
  const a = health.collect(),
    b = health.collect();
  assert.deepEqual(await a, await b);
  assert.equal(calls(), 1);
  await health.collect();
  advance(16000);
  await health.collect();
  assert.equal(calls(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_samples').get().n, 1);
  advance(65000);
  await health.collect();
  assert.equal(calls(), 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_samples').get().n, 2);
});

test('provider failures create one persistent incident and recovery resolves it', async (t) => {
  const { db, health, advance, setProvider } = fixture(t);
  setProvider(false);
  assert.equal((await health.collect()).status, 'degraded');
  advance(65000);
  await health.collect();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_incidents').get().n, 1);
  setProvider(true);
  advance(65000);
  const recovered = await health.collect();
  assert.equal(recovered.status, 'operational');
  assert.ok(recovered.incidents[0].resolved_at);
});

test('worker heartbeat stalls and failed payment jobs are reported as degraded', async (t) => {
  const { db, config, health, now } = fixture(t);
  config.workerHealth.lastCompleted = now() - 130000;
  assert.equal(health.readiness().status, 'not_ready');
  assert.equal(
    (await health.collect()).components.find((c) => c.id === 'worker').status,
    'degraded',
  );
  db.prepare(
    "INSERT INTO webhook_jobs (id,transaction_id,reference,provider,status) VALUES ('test','pay_test','unused','ecofy','failed')",
  ).run();
  const other = createHealthMonitor(db, config, {
    fetch: async () => new Response('{"status":"ok"}'),
  });
  assert.equal(
    (await other.collect()).components.find((c) => c.id === 'payment_queue').status,
    'degraded',
  );
});

test('read-only database fails readiness and exposes no SQL error details', async (t) => {
  const { db, health } = fixture(t);
  db.exec('PRAGMA query_only=ON');
  assert.equal(health.readiness().status, 'not_ready');
  const result = await health.collect();
  assert.equal(result.status, 'down');
  assert.equal(JSON.stringify(result).includes('SQLITE'), false);
  db.exec('PRAGMA query_only=OFF');
});

test('unconfigured and unobserved health checks never masquerade as complete uptime', async (t) => {
  const { db, health, advance } = fixture(t, {
    paymentDriver: 'disabled',
    workerHealth: { startedAt: null },
  });
  const result = await health.collect();
  assert.equal(result.status, 'unknown');
  assert.equal(result.components.find((c) => c.id === 'payments').status, 'not_configured');
  advance(2 * 86400000);
  await health.collect();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM health_samples').get().n, 2);
  assert.equal((await health.collect()).days.length, 2);
  assert.equal(
    overallHealth([{ status: 'operational' }, { status: 'not_configured' }]),
    'operational',
  );
  assert.equal(overallHealth([{ status: 'unknown' }]), 'unknown');
});

test('public readiness returns 503 for failed writes while liveness still responds', async (t) => {
  const { db, config, health } = fixture(t);
  const server = createApp(db, config, health).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  db.exec('PRAGMA query_only=ON');
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  const response = await fetch(`${origin}/api/ready`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).status, 'not_ready');
  db.exec('PRAGMA query_only=OFF');
});
