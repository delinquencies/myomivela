// Registration, sign-in, sign-out and the current session.
import { get, run } from '../db.mjs';
import { requireThat, field, email } from '../validate.mjs';
import { eligibility } from '../service-area.mjs';
import { passwordHash, passwordMatches, isAdminEmail, signIn, signOut, publicUser, hash, sessionToken,
  limitLogin, passwordGuard, rememberDevice, forgetDevices } from '../auth.mjs';

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

  // Updates a customer's contact details. All three are required here: this is the booking flow's contact step.
  { method:'POST', path:'/api/contact', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Staff contact details are not kept here.', 403);
    const contact = contactFrom(data, { required:true });
    run('UPDATE users SET phone=?, address=?, zip=? WHERE id=?', contact.phone, contact.address, contact.zip, user.id);
    return { contact:publicUser({ ...user, ...contact }).contact };
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
