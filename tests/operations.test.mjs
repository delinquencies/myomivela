import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password } from './helpers.mjs';
import { Buffer } from 'node:buffer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('production mode refuses to start without an https origin and secure cookies', () => {
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

test('behind a trusted proxy, one noisy client cannot lock out other clients', async () => {
  const app = await startServer({ MYO_TRUST_PROXY:'1' });
  try {
    let last;
    for (let i = 0; i < 32; i++) last = await app.call('x','POST','/api/login',{ email:'n'+i+'@example.test', password:'whatever-12345' },{ 'X-Forwarded-For':'203.0.113.9, 198.51.100.1' });
    assert.equal(last.status, 429);
    const other = await app.call('y','POST','/api/login',adminLogin,{ 'X-Forwarded-For':'203.0.113.9, 198.51.100.2' });
    assert.equal(other.status, 200, 'a different client address has its own allowance');
  } finally { await app.stop(); }
});

test('a pre-migration database upgrades in place and keeps its data', async () => {
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
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 3);
  assert.ok(upgraded.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'summary'));
  assert.equal(upgraded.prepare('SELECT name FROM pets').get().name, 'Biscuit');
  assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE name='events_booking'").get());
  upgraded.close();
  await rm(dir, { recursive:true, force:true });
});

test('backup script writes a verified copy of a live database and refuses to overwrite', async () => {
  const app = await startServer();
  const dir = await mkdtemp(join(tmpdir(), 'myo-backup-'));
  try {
    await app.call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
    const target = join(dir, 'backup.sqlite');
    const run = () => spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'backup.mjs'), target], { env:{ ...process.env, MYO_DB:app.dbPath }, encoding:'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /schema version 3/);
    const copy = new DatabaseSync(target, { readOnly:true });
    assert.equal(copy.prepare("SELECT email FROM users WHERE email='c@example.test'").get().email, 'c@example.test');
    copy.close();
    assert.equal(run().status, 1, 'second run must not overwrite');
  } finally { await app.stop(); await rm(dir, { recursive:true, force:true }); }
});

test('scrub-photos removes metadata from photos stored before stripping existed (dry run first)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myo-scrub-'));
  const path = join(dir, 'scrub.sqlite');
  const fresh = await startServer({}, { dbPath:path });
  await fresh.call('c','POST','/api/register',{ name:'c', email:'c@example.test', password });
  await fresh.stop();
  const db = new DatabaseSync(path);
  db.exec("INSERT INTO pets(owner,name,species,details) VALUES(1,'P','Dog','{}'); INSERT INTO services(name,minutes,cents) VALUES('Dog walking',30,1); INSERT INTO bookings(owner,service,starts,ends,cents,notes) VALUES(1,1,1,2,1,'')");
  const exif = Buffer.from('Exif\0\0GPSLatitude=42.36N');
  const header = Buffer.from([0xff,0xe1,0,0]); header.writeUInt16BE(exif.length + 2, 2);
  const jpeg = Buffer.concat([Buffer.from([0xff,0xd8]), header, exif, Buffer.from([0xff,0xda,0,4,0,0,1,0xff,0xd9])]);
  db.prepare("INSERT INTO booking_pets VALUES(1,1)").run();
  db.prepare("INSERT INTO events(booking,pet,kind,notes,published,mime,photo) VALUES(1,1,'Observation','',1,'image/jpeg',?)").run(jpeg);
  db.close();
  const script = join(root, 'scripts', 'scrub-photos.mjs');
  const run = args => spawnSync(process.execPath, ['--no-warnings', script, ...args], { env:{ ...process.env, MYO_DB:path }, encoding:'utf8' });
  const dry = run([]);
  assert.match(dry.stdout, /Would scrub 1 of 1/);
  assert.ok(Buffer.from(new DatabaseSync(path).prepare('SELECT photo FROM events').get().photo).includes('GPSLatitude'), 'dry run changes nothing');
  assert.match(run(['--apply']).stdout, /Scrubbed 1 of 1/);
  assert.ok(!Buffer.from(new DatabaseSync(path).prepare('SELECT photo FROM events').get().photo).includes('GPSLatitude'));
  await rm(dir, { recursive:true, force:true });
});
