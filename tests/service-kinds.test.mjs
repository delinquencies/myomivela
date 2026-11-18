import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, adminLogin, password, iso, hours, nodeOnly } from './helpers.mjs';

// Service kinds and the free meet & greet (C1.4). Both runtimes, except the migration back-fill (Node only).
let app;
const call = (...args) => app.call(...args);
const kinds = async () => Object.fromEntries((await call('anyone','GET','/api/catalog')).json.map(s => [s.name, s.kind]));

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  for (const [name, cents] of [['Dog walking',3000],['Drop-in visit',3500],['Overnight pet sitting',11000],['Meet & Greet',0]]) {
    assert.equal((await call('staff','POST','/api/services',{ name, minutes:30, cents })).status, 200, name);
  }
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
});
after(() => app.stop());

test('every service carries its kind', async () => {
  assert.deepEqual(await kinds(), { 'Dog walking':'visit', 'Drop-in visit':'visit', 'Overnight pet sitting':'overnight', 'Meet & Greet':'meet' });
  assert.ok((await call('ann','GET','/api/portal')).json.services.every(s => ['visit','meet','overnight'].includes(s.kind)));
});

test('a meet & greet must be free', async () => {
  const priced = await call('staff','POST','/api/services',{ name:'Meet & Greet', minutes:30, cents:500 });
  assert.equal(priced.status, 400);
  assert.equal(priced.json.code, 'meet_is_free');
  assert.equal((await call('staff','POST','/api/services',{ name:'Meet & Greet', minutes:30, cents:0, extra_pet_cents:100 })).json.code, 'meet_is_free');
  assert.equal((await call('staff','POST','/api/services',{ name:'Puppy party', minutes:30, cents:0 })).status, 400, 'unknown services are refused');
});

test('a new customer is a first visit until a visit is completed, and a meet & greet books at no charge', async () => {
  assert.equal((await call('ann','GET','/api/portal')).json.first_visit, true);
  assert.equal('first_visit' in (await call('staff','GET','/api/portal')).json, false, 'staff have no first-visit flag');
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(2)) });
  const data = (await call('ann','GET','/api/portal')).json;
  const meet = data.services.find(s => s.kind === 'meet');
  const window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
  const quote = await call('ann','POST','/api/quote',{ service:meet.id, pets:[data.pets[0].id], slot:window_.id, start:starts });
  assert.equal(quote.json.total_cents, 0);
  const booking = await call('ann','POST','/api/bookings',{ service:meet.id, cents:0, pets:[data.pets[0].id], slot:window_.id, start:starts, notes:'' });
  assert.equal(booking.status, 200);
  for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status })).status, 200);
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Completed', summary:'Met Rex', secured:true })).status, 200);
  assert.equal((await call('ann','GET','/api/portal')).json.first_visit, false);
  assert.equal((await call('staff','GET','/api/financials')).json.completed.find(row => row.service === 'Meet & Greet').cents, 0);
});

test('the migration marks existing overnight services', { skip:nodeOnly }, async () => {
  // A database of our own, so it survives stopping the server (stop() removes the server's temporary folder).
  const dir = await mkdtemp(join(tmpdir(), 'myo-kinds-'));
  const path = join(dir, 'kinds.sqlite');
  let own = await startServer({}, { dbPath:path });
  await own.call('staff','POST','/api/login',adminLogin);
  await own.call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:11000 });
  await own.stop();
  const db = new DatabaseSync(path);
  // Rewind to just before migration 12 (service kinds), so it and every later migration run again.
  db.exec("UPDATE services SET kind='visit'; UPDATE meta SET value='11' WHERE key='schema_version'");
  db.close();
  own = await startServer({}, { dbPath:path });
  try {
    const catalog = (await own.call('anyone','GET','/api/catalog')).json;
    assert.equal(catalog.find(s => s.name === 'Overnight pet sitting').kind, 'overnight');
  } finally { await own.stop(); await rm(dir, { recursive:true, force:true }); }
});
