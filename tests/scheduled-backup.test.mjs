import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, adminLogin, password, target } from './helpers.mjs';

// Scheduled backups: made on demand here (the timers call the same code daily), kept to MYO_BACKUP_KEEP, downloadable,
// and restorable into a new installation (a restore rehearsal). Both runtimes: a directory on Node, R2 on the Worker.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let app, dir;
const call = (...args) => app.call(...args);
const restore = (site, file) => spawnSync(process.execPath, [join(root, 'scripts', 'restore.mjs'), file, site], {
  env:{ ...process.env, MYO_STAFF_EMAIL:adminLogin.email, MYO_STAFF_PASSWORD:adminLogin.password }, encoding:'utf8', timeout:60_000,
});

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'myo-scheduled-'));
  app = await startServer({ MYO_BACKUP_DIR:join(dir, 'backups'), MYO_BACKUP_KEEP:'2' });
  await call('staff','POST','/api/login',adminLogin);
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Biscuit', species:'Dog', details:'' });
});
after(async () => { await app.stop(); await rm(dir, { recursive:true, force:true }); });

test('backups are on, and only staff can see or make them', async () => {
  const status = (await call('staff','GET','/api/backups')).json;
  assert.equal(status.enabled, true);
  assert.equal(status.keep, 2);
  assert.equal(status.last_backup, null);
  assert.equal((await call('ann','POST','/api/backups/run',{})).status, 403);
  assert.equal((await call('ann','GET','/api/backups')).status, 403);
});

test('each backup is stored, the newest two are kept, and the time of the last one is recorded', async () => {
  const names = [];
  for (let i = 0; i < 3; i++) {
    const made = await call('staff','POST','/api/backups/run',{});
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.ok(made.json.size > 100);
    names.push(made.json.name);
  }
  const status = (await call('staff','GET','/api/backups')).json;
  assert.deepEqual(status.backups.map(b => b.name), names.slice(1).reverse());
  assert.ok(status.last_backup > Date.now() - 60_000);
  assert.equal(status.last_error, null);
  assert.equal((await call('staff','GET','/api/backups/file/../../etc/passwd')).status, 404);
  assert.equal((await call('staff','GET','/api/backups/file/' + names[0])).status, 404, 'the oldest was removed');
});

test('a stored backup restores into a new installation (restore rehearsal)', async () => {
  const newest = (await call('staff','GET','/api/backups')).json.backups[0].name;
  const response = await fetch(app.base + '/api/backups/file/' + newest, { headers:{ cookie:[...app.cookies('staff')].map(([k, v]) => k + '=' + v).join('; ') } });
  assert.equal(response.status, 200);
  const file = join(dir, newest);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  const fresh = await startServer();
  try {
    const result = restore(fresh.base, file);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await fresh.call('ann','POST','/api/login',{ email:'ann@example.test', password })).status, 200);
    assert.equal((await fresh.call('ann','GET','/api/portal')).json.pets[0].name, 'Biscuit');
  } finally { await fresh.stop(); }
});

test('without a backup destination, scheduled backups are off', { skip:target === 'worker' ? 'the Worker always has its BACKUPS bucket' : false }, async () => {
  const off = await startServer();
  try {
    await off.call('staff','POST','/api/login',adminLogin);
    assert.equal((await off.call('staff','GET','/api/backups')).json.enabled, false);
    assert.equal((await off.call('staff','POST','/api/backups/run',{})).json.code, 'backups_unconfigured');
  } finally { await off.stop(); }
});
