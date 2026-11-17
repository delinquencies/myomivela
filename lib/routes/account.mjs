// Registration, sign-in, sign-out and the current session.
import { get, run } from '../db.mjs';
import { requireThat, field, email } from '../validate.mjs';
import { passwordHash, passwordMatches, isAdminEmail, signIn, signOut, publicUser, hash, sessionToken,
  limitLogin, passwordGuard, rememberDevice, forgetDevices } from '../auth.mjs';

function credentials(data) {
  const address = email(data.email);
  requireThat(typeof data.password === 'string' && data.password.length > 0 && data.password.length <= 128, 'Enter a valid password.');
  return [address, data.password];
}

export default [
  { method:'GET', path:'/api/session', access:'public', handler:({ user }) => user ? publicUser(user) : null },

  { method:'POST', path:'/api/register', access:'public', before:limitLogin, handler:async ctx => {
    const { data } = ctx;
    const [address, password] = credentials(data);
    requireThat(password.length >= 12, 'Use at least 12 characters for your password.');
    const name = field(data.name,100);
    const stored = await passwordHash(password);
    // Everything below runs without an await, so the existence check and the insert cannot interleave with another request.
    requireThat(!get('SELECT id FROM users WHERE email=?',address) && !isAdminEmail(address), 'This email cannot be registered.', 409);
    run('INSERT INTO users(email,name,password) VALUES(?,?,?)',address,name,stored);
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
    rememberDevice(ctx, existing);
    return signIn(ctx,existing);
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

  // Ends every session for this account, including this one, and forgets every recognised device.
  { method:'POST', path:'/api/signout-all', access:'user', idempotent:false, handler:ctx => {
    run('DELETE FROM sessions WHERE user=?', ctx.user.id);
    forgetDevices(ctx, ctx.user);
    signOut(ctx);
    return {};
  } },
];
