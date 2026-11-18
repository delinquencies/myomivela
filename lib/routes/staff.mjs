// Staff accounts (owner only): add a sitter or another owner, change a role, switch an account off or on, and set
// a new password (there is no email yet, so the owner hands it over). There is always at least one active owner.
import { all, get, run, transaction } from '../db.mjs';
import { requireThat, field, email, integer } from '../validate.mjs';
import { passwordHash } from '../auth.mjs';

const roles = ['owner','sitter'];
const listing = user => all('SELECT id, name, email, role, disabled FROM users WHERE admin=1 ORDER BY disabled, name, id')
  .map(row => ({ ...row, disabled:Boolean(row.disabled), you:row.id === user.id }));
const newPassword = value => {
  requireThat(typeof value === 'string' && value.length >= 12 && value.length <= 128, 'Use a password of 12–128 characters.');
  return value;
};
function staffMember(id) {
  const member = get('SELECT * FROM users WHERE id=? AND admin=1', integer(id));
  requireThat(member, 'Staff account not found.', 404);
  return member;
}
// Ends every session and forgets every recognised device of an account.
const signOutEverywhere = id => { run('DELETE FROM sessions WHERE user=?', id); run('DELETE FROM trusted_devices WHERE user=?', id); };

export default [
  { method:'GET', path:'/api/staff', access:'owner', handler:({ user }) => ({ staff:listing(user) }) },

  { method:'POST', path:'/api/staff', access:'owner', handler:async ({ user, data }) => {
    const address = email(data.email);
    const name = field(data.name, 100);
    requireThat(roles.includes(data.role), 'Choose owner or sitter.', 400, 'invalid_role');
    const stored = await passwordHash(newPassword(data.password));
    return transaction(() => {
      requireThat(!get('SELECT id FROM users WHERE email=?', address), 'This email already has an account.', 409, 'email_taken');
      run('INSERT INTO users(email,name,password,admin,role) VALUES(?,?,?,1,?)', address, name, stored, data.role);
      return { staff:listing(user) };
    });
  } },

  // { id, role?, disabled? }. Nobody can demote or switch off themselves, so the owner can't lock everyone out.
  { method:'POST', path:'/api/staff/update', access:'owner', handler:({ user, data }) => transaction(() => {
    const member = staffMember(data.id);
    requireThat(member.id !== user.id, 'You can’t change your own role or switch off your own account.', 409, 'staff_self');
    const role = data.role === undefined ? member.role : data.role;
    requireThat(roles.includes(role), 'Choose owner or sitter.', 400, 'invalid_role');
    requireThat(data.disabled === undefined || typeof data.disabled === 'boolean', 'Choose on or off.');
    const disabled = data.disabled === undefined ? Boolean(member.disabled) : data.disabled;
    run('UPDATE users SET role=?, disabled=? WHERE id=?', role, disabled ? 1 : 0, member.id);
    requireThat(get("SELECT COUNT(*) AS count FROM users WHERE admin=1 AND role='owner' AND disabled=0").count >= 1,
      'Keep at least one active owner.', 409, 'last_owner');
    // A changed role or a switched-off account takes effect at once: their sessions end.
    if (disabled || role !== member.role) signOutEverywhere(member.id);
    return { staff:listing(user) };
  }) },

  { method:'POST', path:'/api/staff/password', access:'owner', handler:async ({ user, data }) => {
    const stored = await passwordHash(newPassword(data.password));
    return transaction(() => {
      const member = staffMember(data.id);
      requireThat(member.id !== user.id, 'Change your own password in Account.', 409, 'staff_self');
      run('UPDATE users SET password=? WHERE id=?', stored, member.id);
      signOutEverywhere(member.id);
      return { staff:listing(user) };
    });
  } },
];
