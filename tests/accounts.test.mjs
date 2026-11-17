import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, target } from './helpers.mjs';

// Runs on both runtimes. Node trusts X-Forwarded-For here (MYO_TRUST_PROXY=1); the Worker reads CF-Connecting-IP.
let app;
const from = address => target === 'worker' ? { 'CF-Connecting-IP':address } : { 'X-Forwarded-For':address };
const login = (who, email, secret, address) => app.call(who, 'POST', '/api/login', { email, password:secret }, from(address));
const register = (who, name, address) => app.call(who, 'POST', '/api/register', { name, email:name + '@example.test', password }, from(address));
const signedIn = async who => (await app.call(who, 'GET', '/api/portal')).status === 200;

before(async () => { app = await startServer({ MYO_TRUST_PROXY:'1' }); });
after(() => app.stop());

test('a password guesser locks out only their own address, not the account owner', async () => {
  await register('ann-setup', 'ann', '198.51.100.1');
  for (let i = 0; i < 8; i++) assert.equal((await login('attacker','ann@example.test','wrong-guess-' + i,'203.0.113.10')).status, 401);
  assert.equal((await login('attacker','ann@example.test',password,'203.0.113.10')).status, 429, 'the guessing address is locked, even with the right password');
  assert.equal((await login('ann-new-laptop','ann@example.test',password,'198.51.100.77')).status, 200, 'the owner on a new device elsewhere still signs in');
});

test('guessing from many addresses is capped per account, but a device the owner used before still works', async () => {
  await register('bea-phone', 'bea', '198.51.100.2'); // registering makes this phone a recognised device
  let address = 0;
  for (let round = 0; round < 9; round++) {
    const ip = '203.0.113.' + (100 + ++address);
    for (let i = 0; i < 6; i++) await login('botnet','bea@example.test','guess-' + round + '-' + i, ip);
  }
  const stranger = await login('bea-new-device','bea@example.test',password,'198.51.100.99');
  assert.equal(stranger.status, 429, '54 failures from new devices close sign-in from new devices');
  assert.match(stranger.json.error, /device you have signed in with before/);
  assert.equal((await login('bea-phone','bea@example.test',password,'198.51.100.2')).status, 200, 'the recognised phone is unaffected');
});

test('a recognised device has its own limit', async () => {
  await register('cal-phone', 'cal', '198.51.100.3');
  for (let i = 0; i < 8; i++) assert.equal((await login('cal-phone','cal@example.test','oops-' + i,'198.51.100.3')).status, 401);
  assert.equal((await login('cal-phone','cal@example.test',password,'198.51.100.3')).status, 429);
  assert.equal((await login('cal-laptop','cal@example.test',password,'198.51.100.30')).status, 200, 'other devices are not locked');
});

test('changing the password needs the current one, keeps this session and signs out the others', async () => {
  await register('dee-phone', 'dee', '198.51.100.4');
  assert.equal((await login('dee-laptop','dee@example.test',password,'198.51.100.40')).status, 200);
  assert.equal((await app.call('dee-phone','GET','/api/portal')).json.account.sessions, 2);
  const change = body => app.call('dee-phone','POST','/api/password',body);
  assert.equal((await change({ current:'not-my-password', password:'a-brand-new-password' })).status, 401);
  assert.equal((await change({ current:password, password:'too-short' })).status, 400);
  assert.equal((await change({ current:password, password })).status, 400, 'must differ');
  assert.equal((await change({ current:password, password:'a-brand-new-password' })).status, 200);
  assert.ok(await signedIn('dee-phone'), 'this session stays signed in');
  assert.ok(!(await signedIn('dee-laptop')), 'other sessions are signed out');
  assert.equal((await app.call('dee-phone','GET','/api/portal')).json.account.sessions, 1);
  assert.equal((await login('dee-other','dee@example.test',password,'198.51.100.41')).status, 401, 'old password no longer works');
  assert.equal((await login('dee-other','dee@example.test','a-brand-new-password','198.51.100.41')).status, 200);
});

test('wrong current passwords count toward the lockout', async () => {
  await register('eve-phone', 'eve', '198.51.100.5');
  for (let i = 0; i < 8; i++) assert.equal((await app.call('eve-phone','POST','/api/password',{ current:'guess-' + i, password:'whatever-new-password' })).status, 401);
  assert.equal((await app.call('eve-phone','POST','/api/password',{ current:password, password:'whatever-new-password' })).status, 429);
});

test('sign out everywhere ends every session, including this one', async () => {
  await register('fay-phone', 'fay', '198.51.100.6');
  assert.equal((await login('fay-laptop','fay@example.test',password,'198.51.100.60')).status, 200);
  assert.equal((await app.call('fay-phone','POST','/api/signout-all',{})).status, 200);
  assert.ok(!(await signedIn('fay-phone')));
  assert.ok(!(await signedIn('fay-laptop')));
  assert.equal(app.cookies('fay-phone').has('myo_session'), false, 'the session cookie is cleared');
});

test('staff can change their own password, so the setup variable is only needed once', async () => {
  assert.equal((await login('staff','staff@example.test',adminLogin.password,'198.51.100.7')).status, 200);
  assert.equal((await app.call('staff','POST','/api/password',{ current:adminLogin.password, password:'rotated-staff-password' })).status, 200);
  assert.equal((await login('staff-2','staff@example.test','rotated-staff-password','198.51.100.70')).status, 200);
  assert.equal((await login('staff-3','staff@example.test',adminLogin.password,'198.51.100.71')).status, 401);
});
