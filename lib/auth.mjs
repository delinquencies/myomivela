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
  return token && get('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user WHERE token=? AND expires>? AND users.disabled=0', hash(token), Date.now());
}
export const publicUser = user => ({ id:user.id, name:user.name, email:user.email, admin:Boolean(user.admin), role:user.admin ? user.role || 'owner' : null,
  locale:user.locale || 'en', auto_tip_percent:user.auto_tip_percent || 0 });
// Staff roles: an owner can do everything; a sitter runs visits but can't change prices, settings, money or accounts.
export const isOwner = user => Boolean(user?.admin) && (user.role || 'owner') === 'owner';
export function signIn(ctx, user) {
  const token = randomBytes(32).toString('hex');
  const seconds = 60 * 60 * 24 * 7;
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run('INSERT INTO sessions(token,user,expires) VALUES(?,?,?)', hash(token), user.id, Date.now() + seconds * 1000);
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
function count(key, limit, windowMs, message) {
  const entry = bucket(key, limit, windowMs, message);
  entry.count++;
  attempts.set(key, entry);
}
// Per-address cap on all sign-in and registration requests.
export function limitLogin(ctx) {
  count('ip:' + ctx.clientAddress, 30, 60_000, 'Too many attempts. Try again in a minute.');
}

// Recognised devices: a successful sign-in leaves a long-lived random cookie naming that device for that
// account. It grants nothing on its own (a password is still needed); it only changes which lockout applies.
const deviceCookie = 'myo_device';
const deviceAge = 365 * 24 * 60 * 60;
const deviceToken = request => request.headers.get('cookie')?.match(/(?:^|; )myo_device=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
function recognised(request, user) {
  const token = deviceToken(request);
  return Boolean(user && token && get('SELECT 1 FROM trusted_devices WHERE token=? AND user=?', hash(token), user.id));
}
export function rememberDevice(ctx, user) {
  if (recognised(ctx.request, user)) return;
  const token = randomBytes(32).toString('hex');
  run('DELETE FROM trusted_devices WHERE created<?', Date.now() - deviceAge * 1000);
  run('INSERT INTO trusted_devices(token,user,created) VALUES(?,?,?)', hash(token), user.id, Date.now());
  ctx.cookies.push(deviceCookie + '=' + token + '; Path=/api; HttpOnly; SameSite=Strict; Max-Age=' + deviceAge + (isSecure(ctx.url) ? '; Secure' : ''));
}
// Forgets an account's recognised devices, except optionally the one making this request.
export function forgetDevices(ctx, user, { keepCurrent = false } = {}) {
  const current = keepCurrent ? hash(deviceToken(ctx.request)) : '';
  run('DELETE FROM trusted_devices WHERE user=? AND token<>?', user.id, current);
}

// Failed-password limits, chosen so that guessing locks out the guesser, not the account's owner:
// - a recognised device has its own allowance (8 failures per 15 minutes) and ignores the limits below,
//   so an attacker elsewhere can never lock the owner out of a phone or computer they have used before;
// - any other device is limited per account and address (8 per 15 minutes), so one attacker locks only themselves;
// - and, per account, unrecognised devices share 50 failures an hour, which caps guessing spread over many addresses.
const minutes = n => n * 60_000;
export function passwordGuard(ctx, address, user) {
  const lockedMessage = 'Too many failed attempts. Try again in 15 minutes.';
  const keys = recognised(ctx.request, user)
    ? [['device:' + hash(deviceToken(ctx.request)), 8, minutes(15), lockedMessage]]
    : [['pair:' + ctx.clientAddress + '|' + address, 8, minutes(15), lockedMessage],
       ['account:' + address, 50, minutes(60), 'Too many failed attempts on this account from new devices. Try again later from a device you have signed in with before.']];
  return {
    check() { for (const [key, limit, windowMs, message] of keys) bucket(key, limit, windowMs, message); },
    fail() { for (const [key, limit, windowMs, message] of keys) count(key, limit, windowMs, message); },
    // A success clears this device's own counter, never the account-wide one an attacker may be filling.
    succeed() { attempts.delete(keys[0][0]); },
  };
}
