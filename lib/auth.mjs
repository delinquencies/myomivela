// Accounts, password hashing, sessions and sign-in rate limiting.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { config, isSecure } from './config.mjs';
import { get, run } from './db.mjs';
import { requireThat, email } from './validate.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
// Asynchronous so password checks run on the libuv thread pool and cannot stall every other request.
const derive = (password, salt) => new Promise((done, fail) => scrypt(password, salt, 64, (error, key) => error ? fail(error) : done(key)));
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + (await derive(password, salt)).toString('hex');
}
// Compares in constant time. Unknown accounts still pay for a hash so timing does not reveal which emails exist.
export async function passwordMatches(user, password) {
  const candidate = await passwordHash(password, user?.password.split(':')[0] || 'no-account');
  return Boolean(user) && timingSafeEqual(Buffer.from(candidate), Buffer.from(user.password));
}

// Creates the single staff account from MYO_ADMIN_EMAIL / MYO_ADMIN_PASSWORD on first start.
export async function ensureAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  const address = email(config.adminEmail);
  requireThat(config.adminPassword.length >= 12 && config.adminPassword.length <= 128, 'Use an admin password of 12–128 characters.');
  const existing = get('SELECT admin FROM users WHERE email=?', address);
  requireThat(!existing || existing.admin, 'The configured admin email is already registered as a customer.');
  if (!existing) run('INSERT INTO users(email,name,password,admin) VALUES(?,?,?,1)', address, 'Myomi', await passwordHash(config.adminPassword));
}
export const isAdminEmail = address => address === config.adminEmail.toLowerCase();

// Sessions: a random token in an HttpOnly cookie; only its SHA-256 is stored.
// `ctx.cookies` collects Set-Cookie values for the response; `ctx.url` decides whether they carry Secure.
const cookieName = 'myo_session';
export function sessionToken(request) {
  return request.headers.get('cookie')?.match(/(?:^|; )myo_session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
function setSession(ctx, token, age) {
  ctx.cookies.push(cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (isSecure(ctx.url) ? '; Secure' : ''));
}
export function currentUser(request) {
  const token = sessionToken(request);
  return token && get('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user WHERE token=? AND expires>?', hash(token), Date.now());
}
export const publicUser = user => ({ id:user.id, name:user.name, email:user.email, admin:Boolean(user.admin) });
export function signIn(ctx, user) {
  const token = randomBytes(32).toString('hex');
  const seconds = 60 * 60 * 24 * 7;
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + seconds * 1000);
  setSession(ctx, token, seconds);
  return publicUser(user);
}
export function signOut(ctx) {
  run('DELETE FROM sessions WHERE token=?', hash(sessionToken(ctx.request)));
  setSession(ctx, '', 0);
}

// Rate limiting. Counters are in memory: on Cloudflare they live in the single Durable Object, so every request
// shares them; they reset when it restarts. `ctx.clientAddress` is set by the runtime (socket or CF-Connecting-IP).
export function clientAddress(request, socketAddress) {
  if (config.trustProxy === 'cloudflare') return request.headers.get('cf-connecting-ip')?.trim() || socketAddress;
  if (config.trustProxy === '1') return request.headers.get('x-forwarded-for')?.split(',').pop().trim() || socketAddress;
  return socketAddress;
}
const attempts = new Map();
function bucket(key, limit, windowMs, message, now = Date.now()) {
  for (const [name, entry] of attempts) if (entry.until <= now) attempts.delete(name);
  const entry = attempts.get(key) || { count:0, until:now + windowMs };
  requireThat(entry.count < limit, message, 429);
  return entry;
}
// Per-address cap on all sign-in and registration requests.
export function limitLogin(ctx) {
  const key = 'ip:' + ctx.clientAddress;
  const entry = bucket(key, 30, 60_000, 'Too many attempts. Try again in a minute.');
  entry.count++;
  attempts.set(key, entry);
}
// Per-account cap on failed sign-ins, so one address rotating cannot guess a single password list.
const accountKey = address => 'account:' + address;
export const checkAccountLock = address => bucket(accountKey(address), 8, 15 * 60_000, 'Too many failed attempts for this account. Try again in 15 minutes.');
export function failedSignIn(address) {
  const entry = checkAccountLock(address);
  entry.count++;
  attempts.set(accountKey(address), entry);
}
export const clearFailures = address => attempts.delete(accountKey(address));
