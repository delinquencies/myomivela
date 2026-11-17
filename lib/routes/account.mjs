// Registration, sign-in, sign-out and the current session.
import { get, run } from '../db.mjs';
import { requireThat, field, email } from '../validate.mjs';
import { passwordHash, passwordMatches, isAdminEmail, signIn, signOut, publicUser,
  limitLogin, checkAccountLock, failedSignIn, clearFailures } from '../auth.mjs';

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
    return signIn(ctx,get('SELECT * FROM users WHERE email=?',address));
  } },

  { method:'POST', path:'/api/login', access:'public', before:limitLogin, handler:async ctx => {
    const { data } = ctx;
    const [address, password] = credentials(data);
    checkAccountLock(address);
    const existing = get('SELECT * FROM users WHERE email=?',address);
    const valid = await passwordMatches(existing, password);
    if (!valid) failedSignIn(address);
    requireThat(valid, 'Email or password is incorrect.', 401);
    clearFailures(address);
    return signIn(ctx,existing);
  } },

  { method:'POST', path:'/api/logout', access:'user', handler:ctx => {
    signOut(ctx);
    return {};
  } },
];
