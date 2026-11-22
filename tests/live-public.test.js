import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLivePublicEvents } from '../server/live-public.js';
import { makeConfig } from '../server/config.js';

test('local mirroring reads public events and resolves live uploaded images', async (t) => {
  const config = { livePublicOrigin: 'https://goldencreations.events' };
  const event = {
    id: 'live-event',
    slug: 'party',
    image: '/uploads/poster.webp',
    url: 'https://party.goldencreations.events',
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/api/events') ? { events: [event] } : { event });
  });
  const listing = await readLivePublicEvents(config);
  assert.equal(listing.events[0].image, '/api/live-artwork/poster.webp');
  assert.equal(listing.events[0].readOnly, true);
  const detail = await readLivePublicEvents(config, 'party');
  assert.equal(detail.event.id, event.id);
  assert.equal(calls[1].url, 'https://goldencreations.events/api/events/party');
  assert.ok(
    calls.every(
      (call) => !call.options.method && !call.options.body && !call.options.headers.Authorization,
    ),
  );
});

test('live event errors are explicit rather than replaced by demo data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(
    readLivePublicEvents({ livePublicOrigin: 'https://goldencreations.events' }),
    { status: 502 },
  );
});

test('production cannot enable local live-data mirroring', () => {
  assert.throws(
    () => makeConfig({ production: true, livePublicOrigin: 'https://goldencreations.events' }),
    /local development only/,
  );
});
