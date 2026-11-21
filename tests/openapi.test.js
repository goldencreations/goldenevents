import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { createApp } from '../server/app.js';
import { createOpenApiSpec } from '../server/openapi.js';
import { openDatabase } from '../server/db.js';
import { makeConfig } from '../server/config.js';

function fixture(t, production = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'golden-openapi-'));
  const db = openDatabase(dir);
  const config = makeConfig({
    dataDir: dir,
    production,
    paymentDriver: 'disabled',
    payoutDriver: 'manual',
    seedDemo: false,
    publicOrigin: 'https://goldenevents.example',
    appOrigin: 'https://app.goldenevents.example',
  });
  const app = createApp(db, config);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, config };
}

test('OpenAPI is valid, operation IDs are unique, and all registered application routes are documented', async (t) => {
  const { app, config } = fixture(t);
  const spec = createOpenApiSpec(config);
  await SwaggerParser.validate(structuredClone(spec));
  const registered = new Set();
  for (const layer of app.router.stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    const path = layer.route.path;
    if (!path.startsWith('/api/') || path === '/api/docs/init.js') continue;
    const normalized = path.slice(4).replace(/:(\w+)/g, '{$1}');
    for (const method of Object.keys(layer.route.methods))
      registered.add(`${method} ${normalized}`);
  }
  const documented = new Set();
  const ids = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      documented.add(`${method} ${path}`);
      assert.ok(!ids.has(operation.operationId), operation.operationId);
      ids.add(operation.operationId);
      assert.ok(operation.summary && operation.description);
      assert.ok(operation.responses && operation.security);
      assert.ok(operation['x-access-role']);
      if (
        ['post', 'put'].includes(method) &&
        ![
          '/auth/logout',
          '/auth/demo',
          '/claims/{token}/code',
          '/organizer/deliveries/{id}/retry',
          '/organizer/payouts/{id}/cancel',
          '/organizer/orders/{id}/refund',
        ].includes(path)
      )
        assert.ok(operation.requestBody, `${method} ${path}`);
    }
  }
  assert.deepEqual([...documented].sort(), [...registered].sort());
  assert.equal(spec.components.securitySchemes.mobileToken.scheme, 'bearer');
  assert.equal(spec.components.securitySchemes.browserSession.in, 'cookie');
  assert.match(spec.paths['/organizer/payouts/{id}/confirm'].post['x-side-effect'], /real money/);
  const serialized = JSON.stringify(spec);
  assert.equal(serialized.includes('NEXTSMS_PASSWORD'), false);
  assert.equal(serialized.includes('ECOFY_API_KEY'), false);
});

test('docs, spec and self-hosted assets work with production CSP, without enabling live execution', async (t) => {
  const { app, config } = fixture(t, true);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route) =>
    fetch(`${base}${route}`, { headers: { 'X-Forwarded-Host': config.baseDomain } });
  const html = await request('/api/docs');
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('x-robots-tag'), 'noindex');
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  assert.match(await html.text(), /swagger-ui-bundle.js/);
  const init = await request('/api/docs/init.js');
  const script = await init.text();
  assert.match(script, /supportedSubmitMethods: \[\]/);
  assert.match(script, /persistAuthorization: false/);
  assert.match(script, /validatorUrl: null/);
  for (const filename of ['swagger-ui.css', 'swagger-ui-bundle.js', 'favicon-32x32.png']) {
    const response = await request(`/api/docs/assets/${filename}`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.equal((await request('/api/docs/assets/swagger-initializer.js')).status, 404);
  const spec = await request('/api/openapi.json');
  assert.equal(spec.status, 200);
  assert.deepEqual(await spec.json(), createOpenApiSpec(config));
});
