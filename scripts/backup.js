import { backup } from 'node:sqlite';
import { mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/db.js';

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(dataDir, 'backups', stamp);
mkdirSync(destination, { recursive: true });
const db = openDatabase(dataDir);
await backup(db, path.join(destination, 'goldenevents.sqlite'));
db.close();
try {
  cpSync(path.join(dataDir, 'uploads'), path.join(destination, 'uploads'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log(`Backup saved: ${destination}`);
