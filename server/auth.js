import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function publicUser(user) {
  const { password, ...safe } = user;
  if ('must_change_password' in safe) safe.must_change_password = !!safe.must_change_password;
  return safe;
}
