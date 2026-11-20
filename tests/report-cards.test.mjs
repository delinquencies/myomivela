import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';
import { reportFields } from '../lib/domain.mjs';

// Report cards (C2.4): structured answers on diary updates, validated by template and filtered by role. Both runtimes.
let app, pet, window_, services, next = 0;
const call = (...args) => app.call(...args);
const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
async function visit(kind = 'visit') {
  const service = services.find(s => s.kind === kind);
  const booking = await ok(call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window_.id, start:window_.starts + 30 * 60_000 * (next++), notes:'' }));
  for (const status of ['Confirmed','In Progress']) await ok(call('staff','POST','/api/status',{ id:booking.id, status }));
  return booking.id;
}
const publish = (id, kind, data) => call('staff','POST','/api/events',{ id, pet, kind, notes:'', ...(data === undefined ? {} : { data }) });
const fieldsSeenBy = async (who, id) => (await call(who,'GET','/api/diary?visit=' + id)).json.events[0].fields;

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Meet & Greet', minutes:30, cents:0 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(10)) });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  [pet, services] = [data.pets[0].id, data.services];
  window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('templates reach the portal, and medication answers can never be hidden', async () => {
  assert.deepEqual((await call('ann','GET','/api/portal')).json.reportFields, reportFields);
  for (const kinds of Object.values(reportFields)) {
    for (const field of kinds.Medication || []) assert.equal(field.hideWhen, undefined, 'medication field ' + field.id);
  }
});

test('customers see what happened; unremarkable answers are hidden from them but not from staff', async () => {
  const id = await visit();
  await ok(publish(id, 'Walk completed', { pee:true, poop:false, water:true, minutes:25 }));
  assert.deepEqual(await fieldsSeenBy('ann', id), [
    { label:'Pee', type:'yesno', value:true }, { label:'Water', type:'yesno', value:true }, { label:'Minutes walked', type:'count', value:25 },
  ]);
  const staff = await fieldsSeenBy('staff', id);
  assert.deepEqual(staff.find(f => f.label === 'Poop'), { label:'Poop', type:'yesno', value:false, hidden:true });
  const zero = await visit();
  await ok(publish(zero, 'Walk completed', { minutes:0, pee:true }));
  assert.deepEqual((await fieldsSeenBy('ann', zero)).map(f => f.label), ['Pee'], 'zero minutes is hidden');
});

test('medication not given is always shown, and choices are kept as answered', async () => {
  const id = await visit();
  await ok(publish(id, 'Medication', { given:false }));
  assert.deepEqual(await fieldsSeenBy('ann', id), [{ label:'Medication given', type:'yesno', value:false }]);
  const fed = await visit();
  await ok(publish(fed, 'Feeding', { ate:'Some' }));
  assert.deepEqual(await fieldsSeenBy('ann', fed), [{ label:'Ate', type:'choice', value:'Some' }]);
});

test('answers are validated against the template', async () => {
  const id = await visit();
  assert.equal((await publish(id, 'Walk completed', { distance:2 })).json.code, 'unknown_field');
  assert.equal((await publish(id, 'Walk completed', { minutes:500 })).json.code, 'invalid_field');
  assert.equal((await publish(id, 'Walk completed', { minutes:1.5 })).json.code, 'invalid_field');
  assert.equal((await publish(id, 'Walk completed', { pee:'yes' })).json.code, 'invalid_field');
  assert.equal((await publish(id, 'Feeding', { ate:'Lots' })).json.code, 'invalid_field');
  assert.equal((await publish(id, 'Playtime', { pee:true })).json.code, 'unknown_field', 'Playtime has no card');
  assert.equal((await publish(id, 'Walk completed', [true])).status, 400);
  await ok(publish(id, 'Playtime'));
  assert.deepEqual(await fieldsSeenBy('ann', id), [], 'an update without answers has no fields');
});

test('a meet & greet has no report cards', async () => {
  const id = await visit('meet');
  assert.equal((await publish(id, 'Walk completed', { pee:true })).json.code, 'unknown_field');
});

// Audit UX-08: a medication that was given needs the medicine, dose and time in the notes.
test('a given medication needs details; one not given does not', async () => {
  const { json:portal } = await app.call('staff','GET','/api/portal');
  const visit = portal.bookings.find(booking => booking.status === 'In Progress');
  assert.ok(visit, 'an in-progress visit from the earlier tests');
  const pet = visit.pet_ids[0];
  const bare = await app.call('staff','POST','/api/events',{ id:visit.id, pet, kind:'Medication', notes:'', data:{ given:true } });
  assert.equal(bare.status, 400);
  assert.equal(bare.json.code, 'medication_details_required');
  assert.equal((await app.call('staff','POST','/api/events',{ id:visit.id, pet, kind:'Medication', notes:'Apoquel 16 mg at 8:05 AM', data:{ given:true } })).status, 200);
  assert.equal((await app.call('staff','POST','/api/events',{ id:visit.id, pet, kind:'Medication', notes:'', data:{ given:false } })).status, 200);
});
