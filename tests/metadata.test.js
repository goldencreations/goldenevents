import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../server/metadata.js';

const template = '<html><head><title>Golden Events</title></head><body></body></html>';
const config = {
  publicOrigin: 'https://goldencreation.events',
  baseDomain: 'goldencreation.events',
};
test('event share metadata escapes user text and uses the configured event origin', () => {
  const event = {
    name: 'Niffer <script> $&',
    description: 'Meet "friends" & enjoy',
    slug: 'niffer-party',
    image: '/uploads/picture.webp',
  };
  const html = renderPage(template, event, config);
  assert.ok(html.includes('<title>Niffer &lt;script&gt; $&amp; | Golden Events</title>'));
  assert.ok(html.includes('https://niffer-party.goldencreation.events'));
  assert.ok(html.includes('https://goldencreation.events/uploads/picture.webp'));
  assert.ok(!html.includes('<script>'));
});
test('private ticket and order pages are excluded from indexing', () => {
  assert.ok(renderPage(template, null, config, true).includes('noindex, nofollow'));
});
