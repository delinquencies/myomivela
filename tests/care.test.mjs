import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, iso, hours, nodeOnly } from './helpers.mjs';

// Care record (C2.5): profile versions and snapshots, the per-pet timeline, and private feedback. Both runtimes.
let app, service, pet, window_, next = 0;
const call = (...args) => app.call(...args);
const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const profile = notes => ({ id:pet, name:'Rex', species:'Dog', details:JSON.stringify({ profileVersion:1, notes }) });
const timelineOf = async (who, query = '') => (await call(who,'GET','/api/pets/' + pet + '/timeline' + query)).json;
async function booking() {
  return ok(call('ann','POST','/api/bookings',{ service:service.id, cents:service.cents, pets:[pet], slot:window_.id, start:window_.starts + 30 * 60_000 * (next++), notes:'' }));
}
const setStatus = (id, status, extra = {}) => ok(call('staff','POST','/api/status',{ id, status, ...extra }));

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(20)) });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:JSON.stringify({ profileVersion:1, notes:'Shy' }) });
  const data = (await call('ann','GET','/api/portal')).json;
  [service, pet] = [data.services[0], data.pets[0].id];
  window_ = (await call('staff','GET','/api/portal')).json.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('a confirmed visit keeps the profile it was agreed on, and staff see when it changed since', async () => {
  const { id } = await booking();
  await setStatus(id, 'Confirmed');
  const confirmed = (await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === id).pet_profiles;
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].updated_since, false);
  await ok(call('ann','POST','/api/pets', profile('Shy')));
  assert.equal((await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === id).pet_profiles[0].updated_since, false, 'saving the same profile is not a change');
  await ok(call('ann','POST','/api/pets', profile('Shy; now on joint supplements')));
  const after_ = (await call('staff','GET','/api/portal')).json.bookings.find(b => b.id === id).pet_profiles[0];
  assert.equal(after_.updated_since, true);
  const snapshot = await ok(call('staff','GET','/api/profile-versions/' + after_.version));
  assert.equal(JSON.parse(snapshot.details).notes, 'Shy', 'the snapshot is what Myomi was told');
  assert.equal((await call('ann','GET','/api/profile-versions/' + after_.version)).status, 200);
  assert.equal((await call('bob','GET','/api/profile-versions/' + after_.version)).status, 404);
});

test('the timeline merges visits, updates, vaccines and profile changes, newest first, for the owner and staff only', async () => {
  const { id } = await booking();
  await setStatus(id, 'Confirmed'); await setStatus(id, 'In Progress');
  await ok(call('staff','POST','/api/events',{ id, pet, kind:'Walk completed', notes:'Park loop', data:{ pee:true, poop:false } }));
  await setStatus(id, 'Completed', { summary:'Good walk', secured:true });
  await ok(call('ann','POST','/api/vaccines',{ pet, name:'Rabies', given:'2026-01-15', expires:'2027-01-15' }));
  const { entries, next:more } = await timelineOf('ann');
  assert.equal(more, null);
  assert.deepEqual([...new Set(entries.map(e => e.type))].sort(), ['event','profile_change','vaccine','visit']);
  assert.ok(entries.every((e, i) => i === 0 || entries[i - 1].at >= e.at), 'newest first');
  const walk = entries.find(e => e.type === 'event');
  assert.deepEqual(walk.fields.map(f => f.label), ['Pee'], 'customers don’t see hidden answers here either');
  assert.ok((await timelineOf('staff')).entries.find(e => e.type === 'event').fields.some(f => f.label === 'Poop' && f.hidden));
  assert.deepEqual(entries.find(e => e.type === 'profile_change').changed, ['notes']);
  assert.equal(entries.find(e => e.type === 'visit' && e.booking === id).summary, 'Good walk');
  assert.equal((await call('bob','GET','/api/pets/' + pet + '/timeline')).status, 404);
  assert.equal((await call('ann','GET','/api/pets/' + pet + '/timeline?before=bad')).status, 400);
});

test('the timeline pages without skipping or repeating', async () => {
  const { id } = await booking();
  await setStatus(id, 'Confirmed'); await setStatus(id, 'In Progress');
  for (let i = 0; i < 31; i++) await ok(call('staff','POST','/api/events',{ id, pet, kind:'Water', notes:'Bowl ' + i }));
  const seen = [];
  let cursor = '';
  do {
    const page = await timelineOf('ann', cursor ? '?before=' + cursor : '');
    seen.push(...page.entries.map(e => e.type + ':' + e.id));
    cursor = page.next;
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length, 'no entry appears twice');
  assert.ok(seen.filter(key => key.startsWith('event:')).length >= 32);
});

test('private feedback on a completed visit', async () => {
  const { id } = await booking();
  assert.equal((await call('ann','POST','/api/feedback',{ booking:id, score:1 })).status, 404, 'only completed visits');
  await setStatus(id, 'Confirmed'); await setStatus(id, 'In Progress');
  await setStatus(id, 'Completed', { summary:'Done', secured:true });
  assert.equal((await call('ann','POST','/api/feedback',{ booking:id, score:2 })).json.code, 'invalid_score');
  assert.equal((await call('bob','POST','/api/feedback',{ booking:id, score:1 })).status, 404);
  await ok(call('ann','POST','/api/feedback',{ booking:id, score:-1, comment:'Arrived late' }));
  assert.deepEqual((await call('ann','GET','/api/diary?visit=' + id)).json.visits[0].feedback, { score:-1, comment:'Arrived late' });
  assert.equal('feedback' in (await call('staff','GET','/api/diary?visit=' + id)).json.visits[0], false, 'staff read ratings in the summary');
  await ok(call('ann','POST','/api/feedback',{ booking:id, score:0, comment:'Arrived late, but fine' }));
  const summary = await ok(call('staff','GET','/api/feedback?days=30'));
  assert.equal(summary.counts['0'], 1);
  assert.equal(summary.recent[0].comment, 'Arrived late, but fine');
  assert.equal(summary.recent[0].customer, 'ann');
  assert.equal((await call('ann','GET','/api/feedback')).status, 403);
});

test('feedback can’t be changed after 7 days', { skip:nodeOnly }, async () => {
  const db = new DatabaseSync(app.dbPath);
  const row = db.prepare('SELECT booking FROM visit_feedback LIMIT 1').get();
  db.prepare('UPDATE visit_feedback SET created=? WHERE booking=?').run(Date.now() - 8 * 86_400_000, row.booking);
  db.close();
  assert.equal((await call('ann','POST','/api/feedback',{ booking:row.booking, score:1 })).json.code, 'feedback_closed');
});
