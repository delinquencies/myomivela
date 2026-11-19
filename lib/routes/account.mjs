// Registration, sign-in, sign-out and the current session.
import { get, run } from '../db.mjs';
import { requireThat, field, email } from '../validate.mjs';
import { eligibility } from '../service-area.mjs';
import { randomBytes } from 'node:crypto';
import { config } from '../config.mjs';
import { encrypt } from '../vault.mjs';
import { notify, emailEnabled } from '../outbox.mjs';
import { transaction } from '../db.mjs';
import { passwordHash, passwordMatches, isAdminEmail, signIn, signOut, publicUser, hash, sessionToken,
  limitLogin, passwordGuard, rememberDevice, forgetDevices, recoveryAllowed, markVerified } from '../auth.mjs';

function credentials(data) {
  const address = email(data.email);
  requireThat(typeof data.password === 'string' && data.password.length > 0 && data.password.length <= 128, 'Enter a valid password.');
  return [address, data.password];
}

// Contact details (CUX-08): a phone Myomi can call, the home address where care happens, and its ZIP. Optional at
// registration so existing callers keep working; the booking flow asks for them at its contact step.
function contactFrom(data, { required }) {
  const missing = { phone:'Add a phone number so Myomi can reach you.', address:'Add the address where Myomi will care for your pet.', zip:'Add your ZIP code.' };
  const value = (name, max) => {
    const raw = data[name];
    if (raw === undefined || raw === null || raw === '') { requireThat(!required, missing[name], 400, 'contact_required', { field:name }); return null; }
    return field(raw, max);
  };
  const phone = value('phone', 30);
  requireThat(phone === null || (/^[+()\-.\s\d]{7,30}$/.test(phone) && phone.replace(/\D/g,'').length >= 10), 'Enter a phone number with area code.', 400, 'invalid_phone');
  const address = value('address', 200);
  const zip = value('zip', 10);
  if (zip !== null) eligibility(zip); // validates the format (invalid_zip); an outside ZIP is allowed, by arrangement
  return { phone, address, zip:zip && zip.slice(0, 5) };
}

// Password recovery (CUX-07). It needs a way to deliver the link (an email driver) and the vault key that seals the link
// while it waits in the outbox. Without them the capability says so, and the portal offers "contact Myomi" instead.
const resetMinutes = 30;
export const recoveryAvailable = () => emailEnabled() && Boolean(config.vaultKey);

export default [
  { method:'GET', path:'/api/session', access:'public', handler:({ user }) => user ? publicUser(user) : null },

  { method:'POST', path:'/api/register', access:'public', before:limitLogin, handler:async ctx => {
    const { data } = ctx;
    const [address, password] = credentials(data);
    requireThat(password.length >= 12, 'Use at least 12 characters for your password.');
    const name = field(data.name,100);
    const contact = contactFrom(data, { required:false });
    const stored = await passwordHash(password);
    // Everything below runs without an await, so the existence check and the insert cannot interleave with another request.
    requireThat(!get('SELECT id FROM users WHERE email=?',address) && !isAdminEmail(address), 'This email cannot be registered.', 409);
    run('INSERT INTO users(email,name,password,phone,address,zip) VALUES(?,?,?,?,?,?)',address,name,stored,contact.phone,contact.address,contact.zip);
    const user = get('SELECT * FROM users WHERE email=?',address);
    rememberDevice(ctx, user);
    return signIn(ctx,user);
  } },

  { method:'POST', path:'/api/login', access:'public', before:limitLogin, handler:async ctx => {
    const { data } = ctx;
    const [address, password] = credentials(data);
    const existing = get('SELECT * FROM users WHERE email=?',address);
    const guard = passwordGuard(ctx, address, existing);
    guard.check();
    const valid = await passwordMatches(existing, password);
    if (!valid) guard.fail();
    requireThat(valid, 'Email or password is incorrect.', 401);
    guard.succeed();
    requireThat(!existing.disabled, 'This account has been switched off. Ask Myomi for access.', 403, 'account_disabled');
    rememberDevice(ctx, existing);
    return signIn(ctx,existing);
  } },

  // Step-up (audit F5): re-enter the password before an action marked recentAuth. Same lockouts as signing in.
  { method:'POST', path:'/api/reauth', access:'user', before:limitLogin, idempotent:false, handler:async ctx => {
    const password = typeof ctx.data?.password === 'string' ? ctx.data.password : '';
    const guard = passwordGuard(ctx, ctx.user.email, ctx.user);
    guard.check();
    const valid = await passwordMatches(ctx.user, password);
    if (!valid) guard.fail();
    requireThat(valid, 'That password is incorrect.', 401, 'reauth_failed');
    guard.succeed();
    return markVerified(ctx);
  } },

  // Updates a customer's contact details. All three are required here: this is the booking flow's contact step.
  { method:'POST', path:'/api/contact', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Staff contact details are not kept here.', 403);
    const contact = contactFrom(data, { required:true });
    run('UPDATE users SET phone=?, address=?, zip=? WHERE id=?', contact.phone, contact.address, contact.zip, user.id);
    return { contact:publicUser({ ...user, ...contact }).contact };
  } },

  // Whether self-service recovery works right now, and what to offer otherwise.
  { method:'GET', path:'/api/recovery', access:'public', handler:() => ({ available:recoveryAvailable(), expires_minutes:resetMinutes,
    alternative:recoveryAvailable() ? null : 'contact_myomi' }) },

  // Asks for a reset link. The answer is the same whether or not the address has an account, is switched off, or has
  // asked too often; only `delivery` varies, and only with the installation's capability.
  { method:'POST', path:'/api/recovery/request', access:'public', before:limitLogin, idempotent:false, handler:async ({ data, url }) => {
    const address = email(data.email);
    const answer = { accepted:true, delivery:recoveryAvailable() ? 'email' : 'unavailable', expires_minutes:resetMinutes };
    if (!recoveryAvailable()) return answer;
    const user = get('SELECT id, disabled FROM users WHERE email=?', address);
    const token = randomBytes(32).toString('hex');
    const link = (config.origin || url.origin) + '/portal/index.html?reset=' + token + '#recover';
    // Seal even when there is no account, so both cases take the same time.
    const sealed = await encrypt('reset:' + (user?.id ?? 0), link);
    if (!user || user.disabled || !recoveryAllowed(address)) return answer;
    transaction(() => {
      const now = Date.now();
      run('UPDATE password_resets SET used=1 WHERE user=? AND used=0', user.id); // only the newest link works
      run('INSERT INTO password_resets(token_hash,user,expires,created) VALUES(?,?,?,?)', hash(token), user.id, now + resetMinutes * 60_000, now);
      notify(user.id, 'password_reset', { sealed:sealed.secret_enc, iv:sealed.iv, minutes:resetMinutes }, 'reset:' + hash(token).slice(0, 24));
    });
    return answer;
  } },

  // Sets a new password with a reset token. The token works once, within 30 minutes; every session and recognised
  // device of the account is signed out, and the person signs in again with the new password.
  { method:'POST', path:'/api/recovery/redeem', access:'public', before:limitLogin, idempotent:false, handler:async ({ data }) => {
    requireThat(typeof data.token === 'string' && /^[0-9a-f]{64}$/.test(data.token), 'This reset link has expired or was already used. Ask for a new one.', 400, 'invalid_token');
    requireThat(typeof data.password === 'string' && data.password.length >= 12 && data.password.length <= 128,
      'Use at least 12 characters for your password.', 400, 'password_too_short');
    const stored = await passwordHash(data.password);
    return transaction(() => {
      const row = get('SELECT r.*, u.disabled FROM password_resets r JOIN users u ON u.id=r.user WHERE r.token_hash=?', hash(data.token));
      const usable = row && !row.used && !row.disabled && row.expires > Date.now();
      // Marking it used inside the same transaction makes two simultaneous redemptions succeed once.
      requireThat(usable && run('UPDATE password_resets SET used=1 WHERE token_hash=? AND used=0', row.token_hash).changes === 1,
        'This reset link has expired or was already used. Ask for a new one.', 400, 'invalid_token');
      run('UPDATE users SET password=? WHERE id=?', stored, row.user);
      run('DELETE FROM sessions WHERE user=?', row.user);
      run('DELETE FROM trusted_devices WHERE user=?', row.user);
      return { reset:true };
    });
  } },

  { method:'POST', path:'/api/logout', access:'user', handler:ctx => {
    signOut(ctx);
    return {};
  } },

  // Change password: needs the current one (wrong guesses count toward the lockout), signs out every other
  // session and forgets every other recognised device. Not idempotency-keyed, so nothing derived from a
  // password is ever stored with a retry key.
  { method:'POST', path:'/api/password', access:'user', idempotent:false, handler:async ctx => {
    const { user, data } = ctx;
    requireThat(typeof data.current === 'string' && data.current.length <= 128, 'Enter your current password.');
    requireThat(typeof data.password === 'string' && data.password.length >= 12 && data.password.length <= 128, 'Use 12–128 characters for your new password.');
    requireThat(data.password !== data.current, 'Choose a password different from the current one.');
    const guard = passwordGuard(ctx, user.email, user);
    guard.check();
    const valid = await passwordMatches(user, data.current);
    if (!valid) guard.fail();
    requireThat(valid, 'Your current password is incorrect.', 401);
    guard.succeed();
    const stored = await passwordHash(data.password);
    // No await from here on: the new hash and the sign-outs land together.
    run('UPDATE users SET password=? WHERE id=?', stored, user.id);
    run('DELETE FROM sessions WHERE user=? AND token<>?', user.id, hash(sessionToken(ctx.request)));
    forgetDevices(ctx, user, { keepCurrent:true });
    return {};
  } },

  // The account's language (C2.6), kept for messages sent outside the portal.
  { method:'POST', path:'/api/locale', access:'user', handler:({ user, data }) => {
    requireThat(['en','es'].includes(data.locale), 'Choose English or Spanish.', 400, 'invalid_locale');
    run('UPDATE users SET locale=? WHERE id=?', data.locale, user.id);
    return {};
  } },

  // Ends every session for this account, including this one, and forgets every recognised device.
  { method:'POST', path:'/api/signout-all', access:'user', idempotent:false, handler:ctx => {
    run('DELETE FROM sessions WHERE user=?', ctx.user.id);
    forgetDevices(ctx, ctx.user);
    signOut(ctx);
    return {};
  } },
];
