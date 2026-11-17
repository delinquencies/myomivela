import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, target, nodeOnly } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('production mode refuses to start without an https origin and secure cookies', { skip:nodeOnly }, () => {
  const result = spawnSync(process.execPath, ['--no-warnings', join(root, 'server.mjs')], {
    env: { ...process.env, NODE_ENV:'production', MYO_ORIGIN:'', MYO_SECURE_COOKIES:'', MYO_DB:join(tmpdir(), 'never-created.sqlite') }, encoding:'utf8', timeout:10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MYO_ORIGIN/);
  assert.match(result.stderr, /MYO_SECURE_COOKIES/);
});

test('production mode with https config sends HSTS and Secure cookies, and accepts the https origin', async () => {
  const app = await startServer({ NODE_ENV:'production', MYO_ORIGIN:'https://myo.example', MYO_SECURE_COOKIES:'1' });
  try {
    const page = await app.call('x','GET','/');
    assert.match(page.headers.get('strict-transport-security'), /max-age=/);
    const login = await app.call('x','POST','/api/login',adminLogin,{ Origin:'https://myo.example' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /; Secure/);
    const wrong = await app.call('x','POST','/api/login',adminLogin,{ Origin:'https://evil.example' });
    assert.equal(wrong.status, 403);
  } finally { await app.stop(); }
});

// Node behind a proxy reads the last X-Forwarded-For hop; the Worker reads CF-Connecting-IP, which Cloudflare sets.
const clientHeader = address => target === 'worker' ? { 'CF-Connecting-IP':address } : { 'X-Forwarded-For':'203.0.113.9, ' + address };
test('behind a trusted proxy, one noisy client cannot lock out other clients', async () => {
  const app = await startServer({ MYO_TRUST_PROXY:'1' });
  try {
    let last;
    for (let i = 0; i < 32; i++) last = await app.call('x','POST','/api/login',{ email:'n'+i+'@example.test', password:'whatever-12345' },clientHeader('198.51.100.1'));
    assert.equal(last.status, 429);
    const other = await app.call('y','POST','/api/login',adminLogin,clientHeader('198.51.100.2'));
    assert.equal(other.status, 200, 'a different client address has its own allowance');
  } finally { await app.stop(); }
});

test('a pre-migration database upgrades in place and keeps its data', { skip:nodeOnly }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myo-migrate-'));
  const path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sessions(token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE pets(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, species TEXT NOT NULL, details TEXT NOT NULL);
    CREATE TABLE services(id INTEGER PRIMARY KEY, name TEXT NOT NULL, minutes INTEGER NOT NULL, cents INTEGER NOT NULL, UNIQUE(name, minutes));
    CREATE TABLE slots(id INTEGER PRIMARY KEY, starts INTEGER NOT NULL, ends INTEGER NOT NULL, CHECK(ends > starts));
    CREATE TABLE bookings(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), service INTEGER NOT NULL REFERENCES services(id), starts INTEGER NOT NULL, ends INTEGER NOT NULL, cents INTEGER NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Requested', arrived INTEGER, departed INTEGER);
    CREATE TABLE booking_pets(booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), PRIMARY KEY(booking,pet));
    CREATE TABLE events(id INTEGER PRIMARY KEY, booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), kind TEXT NOT NULL, notes TEXT NOT NULL, published INTEGER NOT NULL, mime TEXT, photo BLOB);
    INSERT INTO users(email,name,password) VALUES('old@example.test','Old','salt:hash');
    INSERT INTO pets(owner,name,species,details) VALUES(1,'Biscuit','Dog','{}');
  `);
  legacy.close();
  const app = await startServer({}, { dbPath:path });
  await app.stop();
  const upgraded = new DatabaseSync(path);
  assert.equal(upgraded.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '6');
  assert.ok(upgraded.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'photo_key'));
  assert.ok(upgraded.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'summary'));
  assert.equal(upgraded.prepare('SELECT name FROM pets').get().name, 'Biscuit');
  assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE name='events_booking'").get());
  upgraded.close();
  await rm(dir, { recursive:true, force:true });
});

test('backup script writes a verified copy of a live database and refuses to overwrite', { skip:nodeOnly }, async () => {
  const app = await startServer();
  const dir = await mkdtemp(join(tmpdir(), 'myo-backup-'));
  try {
    await app.call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
    const target = join(dir, 'backup.sqlite');
    const run = () => spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'backup.mjs'), target], { env:{ ...process.env, MYO_DB:app.dbPath }, encoding:'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /schema version 6/);
    const copy = new DatabaseSync(target, { readOnly:true });
    assert.equal(copy.prepare("SELECT email FROM users WHERE email='c@example.test'").get().email, 'c@example.test');
    copy.close();
    assert.equal(run().status, 1, 'second run must not overwrite');
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});
