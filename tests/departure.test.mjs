import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Departure check (C1.3): completing a visit records whether the home was left secured. Both runtimes.
let app, service, pet, window_, next = 0;
const call = (...args) => app.call(...args);
async function visitInProgress() {
  const start = window_.starts + (next++) * 30 * 60_000;
  const booking = await call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window_.id, start, notes:'' });
  for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status })).status, 200);
  return booking.json.id;
}
const complete = (id, extra) => call('staff','POST','/api/status',{ id, status:'Completed', summary:'All good', ...extra });
const diaryVisit = async (who, id) => (await call(who,'GET','/api/diary?visit=' + id)).json.visits[0];

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(8)) });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pet] = [data.services[0], data.pets[0].id];
  window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('completion requires the departure check', async () => {
  const id = await visitInProgress();
  const missing = await complete(id, {});
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, 'departure_check_required');
  assert.equal((await complete(id, { secured:'yes' })).json.code, 'departure_check_required', 'must be a boolean');
});

test('not secured needs a note of 3–500 characters', async () => {
  const id = await visitInProgress();
  assert.equal((await complete(id, { secured:false })).json.code, 'secure_note_required');
  assert.equal((await complete(id, { secured:false, secure_note:'  x ' })).json.code, 'secure_note_required');
  assert.equal((await complete(id, { secured:false, secure_note:'x'.repeat(501) })).status, 400);
  assert.equal((await complete(id, { secured:false, secure_note:'  Back gate latch broken; tied it shut  ' })).status, 200);
  const visit = await diaryVisit('ann', id);
  assert.equal(visit.departure_check.secured, false);
  assert.equal(visit.departure_check.note, 'Back gate latch broken; tied it shut');
  assert.ok(Math.abs(visit.departure_check.at - Date.now()) < 60_000);
});

test('secured is recorded and visible to both roles; earlier visits have none', async () => {
  const before_ = await visitInProgress();
  const unfinished = await diaryVisit('ann', before_);
  assert.equal(unfinished.departure_check, null, 'no check until the visit is completed');
  assert.equal((await complete(before_, { secured:true, secure_note:'ignored when secured' })).status, 200);
  for (const who of ['ann','staff']) {
    const visit = await diaryVisit(who, before_);
    assert.equal(visit.departure_check.secured, true);
    assert.equal(visit.departure_check.note, '');
  }
  assert.equal((await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === before_)?.departure_check?.secured ?? true, true);
});
