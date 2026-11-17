import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, hours } from './helpers.mjs';

// Bounded responses: /api/portal carries one page of history, /api/history and /api/diary page the rest.
let app;
const call = (...args) => app.call(...args);
const get = async (who, path) => { const r = await call(who,'GET',path); assert.equal(r.status, 200, path); return r.json; };
const pastVisits = 45;
let annPets, bobPet;
before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name+'@example.test', password });
  for (const pet of ['Alpha','Beta']) await call('ann','POST','/api/pets',{ name:pet, species:'Dog', details:'' });
  await call('bob','POST','/api/pets',{ name:'Bobpet', species:'Cat', details:'' });
  annPets = (await get('ann','/api/portal')).pets.map(p => p.id);
  bobPet = (await get('bob','/api/portal')).pets[0].id;
  // Completed visits in the past cannot be created through the API, so seed them directly.
  const db = new DatabaseSync(app.dbPath);
  const service = db.prepare('SELECT id FROM services').get().id;
  const owner = email => db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
  const seed = (user, pet, starts) => {
    const id = db.prepare("INSERT INTO bookings(owner,service,starts,ends,cents,notes,status,summary) VALUES(?,?,?,?,3000,'','Completed','ok')")
      .run(user, service, starts, starts + hours(0.5)).lastInsertRowid;
    db.prepare('INSERT INTO booking_pets VALUES(?,?)').run(id, pet);
    db.prepare("INSERT INTO events(booking,pet,kind,notes,published) VALUES(?,?,'Feeding','fed',?)").run(id, pet, starts + 60_000);
  };
  const ann = owner('ann@example.test');
  // Two visits share a start time so the cursor's id tie-breaker is exercised.
  for (let i = 0; i < pastVisits; i++) seed(ann, annPets[i % 2], Date.now() - hours(24) * (1 + Math.floor(i / 2) * 2));
  for (let i = 0; i < 3; i++) seed(owner('bob@example.test'), bobPet, Date.now() - hours(5 + i));
  db.close();
});
after(() => app.stop());

// Follows `next` cursors until the last page. Stops after 50 pages so a cursor that fails to advance fails the test instead of hanging.
async function collect(who, path, key, start = '') {
  const rows = [];
  let next = start, pages = 0;
  do {
    const url = new URL(path, 'http://x');
    if (next) url.searchParams.set('before', next);
    const page = await get(who, url.pathname + url.search);
    rows.push(...page[key]);
    next = page.next;
    assert.ok(++pages < 50, 'pagination did not advance');
  } while (next);
  return { rows, pages };
}

test('the portal sends one page of history and no diary events', async () => {
  const data = await get('ann','/api/portal');
  assert.equal(data.bookings.length, 20);
  assert.ok(data.history_next);
  assert.equal('events' in data, false);
});

test('history pages cover every past booking once, newest first, owner only', async () => {
  const first = await get('ann','/api/portal');
  const rest = await collect('ann','/api/history','bookings',first.history_next);
  const all = [...first.bookings, ...rest.rows];
  assert.equal(all.length, pastVisits);
  assert.equal(new Set(all.map(b => b.id)).size, pastVisits);
  assert.ok(all.every((b, i) => i === 0 || all[i - 1].starts > b.starts || (all[i - 1].starts === b.starts && all[i - 1].id > b.id)));
  assert.ok(all.every(b => b.pet_ids.every(id => annPets.includes(id))));
});

test('diary pages hold ten visits with their updates, and the pet filter runs on the server', async () => {
  const everything = await collect('ann','/api/diary','visits');
  assert.equal(everything.rows.length, pastVisits);
  assert.equal(everything.pages, Math.ceil(pastVisits / 10));
  const first = await get('ann','/api/diary');
  assert.equal(first.visits.length, 10);
  assert.deepEqual(new Set(first.events.map(e => e.booking)), new Set(first.visits.map(v => v.id)));
  const beta = await collect('ann','/api/diary?pet=' + annPets[1],'visits');
  assert.equal(beta.rows.length, Math.floor(pastVisits / 2));
  assert.ok(beta.rows.every(v => v.pet_ids.includes(annPets[1])));
  const onlyBeta = await get('ann','/api/diary?pet=' + annPets[1]);
  assert.ok(onlyBeta.events.every(e => e.pet === annPets[1]));
});

test('a customer cannot page into another customer’s diary or history', async () => {
  const bob = await collect('bob','/api/diary','visits');
  assert.equal(bob.rows.length, 3);
  const annVisit = (await get('ann','/api/diary')).visits[0].id;
  const probe = await get('bob','/api/diary?visit=' + annVisit);
  assert.equal(probe.visits.length + probe.events.length, 0);
  assert.equal((await get('bob','/api/diary?pet=' + annPets[0])).visits.length, 0);
  assert.equal((await get('bob','/api/history')).bookings.length, 3);
  assert.equal((await call('nobody','GET','/api/diary')).status, 401);
});

test('staff see every customer, but only the pets their page references', async () => {
  const staff = await get('staff','/api/portal');
  const referenced = new Set(staff.bookings.flatMap(b => b.pet_ids));
  assert.deepEqual(new Set(staff.pets.map(p => p.id)), referenced);
  assert.equal((await collect('staff','/api/diary','visits')).rows.length, pastVisits + 3);
});

test('malformed page cursors are rejected', async () => {
  for (const bad of ['abc', '1.2.3', '-1.5', '1e5.1']) {
    assert.equal((await call('ann','GET','/api/diary?before=' + bad)).status, 400, bad);
    assert.equal((await call('ann','GET','/api/history?before=' + bad)).status, 400, bad);
  }
  assert.equal((await call('ann','GET','/api/diary?pet=x')).status, 400);
});
