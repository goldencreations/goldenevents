import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const [major, minor, patch] = version
  .split('-')[0]
  .split('.')
  .map((n) => Number(n) || 0);
const build = Number(process.env.VERSION_BUILD || 0);
const versionCode =
  Number(process.env.VERSION_CODE) || major * 100000 + minor * 1000 + patch * 10 + build;

const patchFile = (file, replacements) => {
  const target = path.join(root, file);
  let text = readFileSync(target, 'utf8');
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(text)) throw new Error(`Expected pattern not found in ${file}: ${pattern}`);
    text = text.replace(pattern, replacement);
  }
  writeFileSync(target, text);
};

patchFile(path.join('android', 'app', 'build.gradle'), [
  [/versionCode \d+/, `versionCode ${versionCode}`],
  [/versionName "[^"]*"/, `versionName "${version}"`],
]);

patchFile(path.join('ios', 'App', 'App.xcodeproj', 'project.pbxproj'), [
  [/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`],
  [/MARKETING_VERSION = [\d.]+;/g, `MARKETING_VERSION = ${version};`],
]);

console.log(`Native versions set to ${version} (build ${versionCode}).`);
