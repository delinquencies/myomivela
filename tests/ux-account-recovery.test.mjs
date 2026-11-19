import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, nodeOnly } from './helpers.mjs';

// CUX-07: self-service password recovery. Same public answer for every address, single-use 30-minute tokens stored
// as hashes, the link sealed while it waits in the outbox, sessions ended on reset, and an honest capability flag.
// Reading the sealed link back needs the database and vault key, so those steps are Node-only.
const vaultKey = Buffer.from('test-vault-key-0123456789abcdef!').toString('base64');
let app;
const call = (...args) => app.call(...args);
const db = () => new DatabaseSync(app.dbPath);
async function linkFor(email) {
  process.env.MYO_VAULT_KEY = vaultKey;
  const { configure } = await import('../lib/config.mjs');
  configure(process.env);
  const { decrypt } = await import('../lib/vault.mjs');
  const handle = db();
  try {
    const row = handle.prepare("SELECT o.user, o.params FROM outbox o JOIN users u ON u.id=o.user WHERE u.email=? AND o.template='password_reset' ORDER BY o.id DESC LIMIT 1").get(email);
    const { sealed, iv } = JSON.parse(row.params);
    return (await decrypt('reset:' + row.user, sealed, iv)).plaintext;
  } finally { handle.close(); }
}
const tokenOf = link => new URL(link).searchParams.get('reset');

before(async () => {
  app = await startServer({ MYO_EMAIL:'log' });
  await call('staff','POST','/api/login',adminLogin);
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
});
after(() => app.stop());

test('recovery is available with an email driver and the vault key', async () => {
  assert.deepEqual((await call('guest','GET','/api/recovery')).json, { available:true, expires_minutes:30, alternative:null });
});

test('the answer is the same for a known address, an unknown one and a staff account', async () => {
  const known = await call('guest','POST','/api/recovery/request',{ email:'ann@example.test' });
  const unknown = await call('guest','POST','/api/recovery/request',{ email:'nobody@example.test' });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.deepEqual(known.json, { accepted:true, delivery:'email', expires_minutes:30 });
  assert.equal((await call('guest','POST','/api/recovery/request',{ email:'not-an-email' })).status, 400);
});

test('staff can see the message is queued, but never the link', async () => {
  const message = (await call('staff','GET','/api/outbox')).json.messages.find(m => m.template === 'password_reset');
  assert.ok(message, 'one reset message queued for Ann');
  assert.match(message.text, /\[link hidden\]/);
  assert.doesNotMatch(JSON.stringify(message), /[0-9a-f]{64}/);
});

test('a reset link works once, ends every session, and the new password signs in', { skip:nodeOnly }, async () => {
  const link = await linkFor('ann@example.test');
  assert.match(link, /\/portal\/index\.html\?reset=[0-9a-f]{64}#recover$/);
  const token = tokenOf(link);
  const handle = db();
  try { assert.equal(handle.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE token_hash=?').get(token).n, 0, 'only the hash is stored'); }
  finally { handle.close(); }
  assert.equal((await call('ann','POST','/api/recovery/redeem',{ token, password:'short' })).json.code, 'password_too_short');
  // Two simultaneous redemptions: exactly one succeeds.
  const results = await Promise.all([1, 2].map(n => call('guest' + n,'POST','/api/recovery/redeem',{ token, password:'brand-new-password-' + n })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal(results.find(r => r.status === 400).json.code, 'invalid_token');
  assert.equal((await call('ann','GET','/api/portal')).status, 401, 'the old session ended');
  assert.equal((await call('ann','POST','/api/login',{ email:'ann@example.test', password })).status, 401, 'the old password no longer works');
  const winner = results.findIndex(r => r.status === 200) + 1;
  assert.equal((await call('ann','POST','/api/login',{ email:'ann@example.test', password:'brand-new-password-' + winner })).status, 200);
  assert.equal((await call('guest','POST','/api/recovery/redeem',{ token, password:'another-new-password' })).json.code, 'invalid_token', 'a used link fails');
});

test('a newer link replaces an older one, and links expire', { skip:nodeOnly }, async () => {
  await call('guest','POST','/api/recovery/request',{ email:'ann@example.test' });
  const older = tokenOf(await linkFor('ann@example.test'));
  await call('guest','POST','/api/recovery/request',{ email:'ann@example.test' });
  const newer = tokenOf(await linkFor('ann@example.test'));
  assert.notEqual(older, newer);
  assert.equal((await call('guest','POST','/api/recovery/redeem',{ token:older, password:'replaced-password-1' })).json.code, 'invalid_token');
  const handle = db();
  try { handle.prepare('UPDATE password_resets SET expires=1').run(); } finally { handle.close(); }
  assert.equal((await call('guest','POST','/api/recovery/redeem',{ token:newer, password:'expired-password-1' })).json.code, 'invalid_token');
  assert.equal((await call('guest','POST','/api/recovery/redeem',{ token:'zz', password:'whatever-password' })).json.code, 'invalid_token');
});

test('a sent reset link is scrubbed from the outbox', { skip:nodeOnly }, async () => {
  await call('staff','POST','/api/outbox/drain',{});
  const handle = db();
  try {
    const rows = handle.prepare("SELECT status, params FROM outbox WHERE template='password_reset'").all();
    assert.ok(rows.every(row => row.status === 'sent' && !JSON.parse(row.params).sealed));
  } finally { handle.close(); }
});

test('at most three links an hour per address, silently', { skip:nodeOnly }, async () => {
  await call('bob','POST','/api/register',{ name:'Bob', email:'bob@example.test', password });
  const answers = [];
  for (let i = 0; i < 5; i++) answers.push((await call('guest','POST','/api/recovery/request',{ email:'bob@example.test' })).json);
  assert.ok(answers.every(answer => answer.accepted && answer.delivery === 'email'), 'the answer never changes');
  const handle = db();
  try { assert.equal(handle.prepare("SELECT COUNT(*) AS n FROM password_resets r JOIN users u ON u.id=r.user WHERE u.email='bob@example.test'").get().n, 3); }
  finally { handle.close(); }
});

test('without an email driver, recovery says so and creates nothing', async () => {
  const plain = await startServer();
  try {
    assert.deepEqual((await plain.call('guest','GET','/api/recovery')).json, { available:false, expires_minutes:30, alternative:'contact_myomi' });
    await plain.call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
    const known = (await plain.call('guest','POST','/api/recovery/request',{ email:'ann@example.test' })).json;
    const unknown = (await plain.call('guest','POST','/api/recovery/request',{ email:'nobody@example.test' })).json;
    assert.deepEqual(known, unknown);
    assert.equal(known.delivery, 'unavailable');
  } finally { await plain.stop(); }
});
