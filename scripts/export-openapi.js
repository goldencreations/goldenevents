import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOpenApiSpec } from '../server/openapi.js';

const directory = new URL('../output/api-handoff/', import.meta.url);
mkdirSync(directory, { recursive: true });
const spec = createOpenApiSpec({ appOrigin: 'https://app.goldencreations.events' });
writeFileSync(new URL('openapi.json', directory), `${JSON.stringify(spec, null, 2)}\n`);
copyFileSync(
  new URL('../docs/mobile-api.md', import.meta.url),
  new URL('mobile-api.md', directory),
);
copyFileSync(new URL('../docs/mobile.md', import.meta.url), new URL('mobile.md', directory));
console.log(`Developer handoff exported to ${fileURLToPath(directory)}`);
