import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const terminal = createInterface({ input: stdin, output: stdout });
const name = (await terminal.question('Administrator name: ')).trim();
const email = (await terminal.question('Administrator email: ')).trim().toLowerCase();
// Supply ADMIN_PASSWORD through the environment rather than a visible CLI argument.
const password = process.env.ADMIN_PASSWORD;
terminal.close();
if (name.length < 2 || !email.includes('@') || !password || password.length < 12) {
  console.error(
    'Use a name and email, and set ADMIN_PASSWORD to at least 12 characters in the environment.',
  );
  process.exit(1);
}
const db = openDatabase(path.resolve(process.env.DATA_DIR || 'data'));
if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
  console.error('This account already exists. Nothing was changed.');
  db.close();
  process.exit(1);
}
db.prepare('INSERT INTO users (id,name,email,password,role,created_at) VALUES (?,?,?,?,?,?)').run(
  randomUUID(),
  name,
  email,
  hashPassword(password),
  'admin',
  new Date().toISOString(),
);
db.close();
console.log(`Administrator created: ${email}`);
