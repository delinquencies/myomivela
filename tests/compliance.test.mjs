import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Compliance gates (C2.2): vaccines, the service agreement, and a meet & greet before a first stay. Both runtimes.
let app, walk, window_, dog, cat, next = 0;
const call = (...args) => app.call(...args);
const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const day = offset => new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' }).format(Date.now() + offset * 86_400_000);
const walkBody = (pets, extra = {}) => ({ service:walk.id, pets, slot:window_.id, start:window_.starts + 30 * 60_000 * (next++), cents:walk.cents, notes:'', ...extra });
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const codes = list => list.map(b => b.code + (b.vaccine ? ':' + b.vaccine : '')).sort();

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(10)) });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  await call('ann','POST','/api/pets',{ name:'Tom', species:'cat', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  walk = data.services[0];
  [dog, cat] = [data.pets.find(p => p.name === 'Rex').id, data.pets.find(p => p.name === 'Tom').id];
  window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('no gate applies until Myomi sets one up', async () => {
  const data = (await call('ann','GET','/api/portal')).json;
  assert.deepEqual(data.requirements, {});
  assert.deepEqual(data.pets.find(p => p.id === dog).vaccines, []);
  assert.deepEqual((await ok(call('ann','POST','/api/quote', walkBody([dog])))).blockers, []);
  assert.equal(await call('ann','GET','/api/agreement').then(r => r.json), null);
});

test('required vaccines block holds until they are on file and current', async () => {
  await ok(call('staff','POST','/api/vaccine-requirements',{ species:'dog', names:['Rabies','DHPP'] }));
  assert.deepEqual((await call('ann','GET','/api/portal')).json.requirements, { dog:['DHPP','Rabies'] });
  const quote = await ok(call('ann','POST','/api/quote', walkBody([dog, cat])));
  assert.deepEqual(codes(quote.blockers), ['vaccine_missing:DHPP','vaccine_missing:Rabies'], 'the cat has no requirements');
  const hold = await call('ann','POST','/api/checkout-hold', walkBody([dog]));
  assert.equal(hold.status, 409);
  assert.equal(hold.json.code, 'blocked');
  assert.equal(hold.json.blockers.length, 2);
  assert.match(hold.json.error, /Rex needs a/);
  await ok(call('ann','POST','/api/vaccines',{ pet:dog, name:'Rabies', given:day(-400), expires:day(-1) }));
  await ok(call('ann','POST','/api/vaccines',{ pet:dog, name:'DHPP', expires:day(400) }));
  assert.deepEqual(codes((await ok(call('ann','POST','/api/quote', walkBody([dog])))).blockers), ['vaccine_expired:Rabies']);
  // A record that expires part-way through a longer booking.
  await ok(call('ann','POST','/api/vaccines',{ pet:dog, name:'Rabies', expires:day(5) }));
  const during = await ok(call('ann','GET','/api/blockers?service=' + walk.id + '&pets=' + dog + '&starts=' + (Date.now() + 86_400_000) + '&ends=' + (Date.now() + 10 * 86_400_000)));
  assert.deepEqual(codes(during.blockers), ['vaccine_expires_during:Rabies']);
  await ok(call('ann','POST','/api/vaccines',{ pet:dog, name:'Rabies', expires:day(365) }));
  const quote2 = await ok(call('ann','POST','/api/quote', walkBody([dog])));
  assert.deepEqual(quote2.blockers, []);
  const held = await ok(call('ann','POST','/api/checkout-hold', { ...walkBody([dog]) }));
  assert.ok(held.expires);
  assert.equal((await call('ann','POST','/api/vaccines',{ pet:dog, name:'Rabies', given:day(10), expires:day(5) })).json.code, 'invalid_date');
  assert.equal((await call('bob','POST','/api/vaccines',{ pet:dog, name:'Rabies', expires:day(5) })).status, 404, 'only the owner adds records');
});

test('statuses, verification and documents', async () => {
  await ok(call('ann','POST','/api/vaccines',{ pet:dog, name:'DHPP', expires:day(10) }));
  const vaccines = (await call('ann','GET','/api/portal')).json.pets.find(p => p.id === dog).vaccines;
  assert.deepEqual(Object.fromEntries(vaccines.map(v => [v.name, v.status])), { DHPP:'due_soon', Rabies:'ok' });
  const rabies = vaccines.find(v => v.name === 'Rabies');
  await ok(call('staff','POST','/api/vaccines/verify',{ id:rabies.id }));
  const verified = (await call('ann','GET','/api/portal')).json.pets.find(p => p.id === dog).vaccines.find(v => v.name === 'Rabies');
  assert.equal(verified.verified, true);
  await ok(call('ann','POST','/api/vaccines/document',{ id:rabies.id, document:pdf }));
  const after_ = (await call('ann','GET','/api/portal')).json.pets.find(p => p.id === dog).vaccines.find(v => v.name === 'Rabies');
  assert.equal(after_.has_document, true);
  assert.equal(after_.verified, false, 'a new document needs verifying again');
  const own = await call('ann','GET','/api/vaccines/' + rabies.id + '/document');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'application/pdf');
  assert.match(own.headers.get('content-disposition'), /^attachment/);
  assert.ok(own.bytes.toString('latin1').startsWith('%PDF-'));
  assert.equal((await call('staff','GET','/api/vaccines/' + rabies.id + '/document')).status, 200);
  assert.equal((await call('bob','GET','/api/vaccines/' + rabies.id + '/document')).status, 404);
  assert.equal((await call('ann','POST','/api/vaccines/document',{ id:rabies.id, document:'data:application/pdf;base64,' + Buffer.from('not a pdf').toString('base64') })).status, 400);
  const backup = JSON.parse(gunzipSync((await call('staff','GET','/api/backup')).bytes));
  assert.ok(Object.keys(backup.photos).some(key => key.startsWith('vaccines/')), 'documents are in the backup');
  assert.equal(backup.tables.pet_vaccines.length, 2);
});

test('a published agreement must be accepted, again for each new version', async () => {
  const v1 = await ok(call('staff','POST','/api/agreements',{ title:'Service agreement', body_en:'Terms…', body_es:'Términos…' }));
  assert.deepEqual(codes((await ok(call('ann','POST','/api/quote', walkBody([dog])))).blockers), ['agreement_required']);
  assert.equal((await call('ann','POST','/api/agreement/accept',{ version:v1.version + 1 })).json.code, 'agreement_changed');
  await ok(call('ann','POST','/api/agreement/accept',{ version:v1.version }));
  const current = (await call('ann','GET','/api/agreement')).json;
  assert.equal(current.accepted, true);
  assert.equal(current.body_es, 'Términos…');
  assert.deepEqual((await ok(call('ann','POST','/api/quote', walkBody([dog])))).blockers, []);
  await ok(call('staff','POST','/api/agreements',{ title:'Service agreement', body_en:'New terms', body_es:'Nuevos términos' }));
  assert.deepEqual(codes((await ok(call('ann','POST','/api/quote', walkBody([dog])))).blockers), ['agreement_required']);
  await ok(call('ann','POST','/api/agreement/accept',{ version:(await call('ann','GET','/api/agreement')).json.version }));
});

test('a first overnight stay needs a meet & greet first; a meet & greet itself skips the vaccine gate', async () => {
  await ok(call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:11000 }));
  await ok(call('staff','POST','/api/services',{ name:'Meet & Greet', minutes:30, cents:0 }));
  await ok(call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'20:00', buffer:0, overnight_days:[0,1,2,3,4,5,6] }));
  await call('bob','POST','/api/pets',{ name:'Mo', species:'Dog', details:'' });
  const bob = (await call('bob','GET','/api/portal')).json;
  await ok(call('bob','POST','/api/agreement/accept',{ version:(await call('bob','GET','/api/agreement')).json.version }));
  const night = bob.overnight_nights[4].date;
  const arrive = Date.parse(night + 'T22:00:00Z'), depart = arrive + 86_400_000 - 30 * 60_000 * 2;
  const stay = await ok(call('bob','POST','/api/quote',{ service:bob.services.find(s => s.kind === 'overnight').id, pets:[bob.pets[0].id], arrive, depart }));
  assert.ok(codes(stay.blockers).includes('meet_required'));
  const meet = bob.services.find(s => s.kind === 'meet');
  const meetQuote = await ok(call('bob','POST','/api/quote',{ service:meet.id, pets:[bob.pets[0].id], slot:window_.id, start:window_.starts + 30 * 60_000 * (next++) }));
  assert.deepEqual(meetQuote.blockers, [], 'no vaccines are needed to meet');
});
