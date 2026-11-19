import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDiarySync } from '../assets/diary-sync.js';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// CUX-06: the diary freshness controller (fake clock and timers) and GET /api/diary/changes (both runtimes).
function harness(responder) {
  let clock = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  const reports = [];
  const calls = [];
  const sync = createDiarySync({
    fetchChanges:since => { calls.push(since); return responder(since, calls.length); },
    onReport:report => reports.push(report),
    now:() => clock,
    setTimer:(fn, ms) => { const id = nextId++; timers.set(id, { fn, at:clock + ms }); return id; },
    clearTimer:id => timers.delete(id),
  });
  const settle = () => new Promise(done => setImmediate(done));
  async function advance(ms) {
    clock += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
    await settle(); await settle();
  }
  return { sync, reports, calls, timers, advance, settle, setClock:value => { clock = value; } };
}
const answer = (revision, extra = {}) => Promise.resolve({ revision, changed:true, latest_published_at:5, checked_at:0, events:[], visit_ids:[], ...extra });

test('checks every 30 seconds while visible and reports new updates', async () => {
  const h = harness((since, n) => n < 3 ? answer('1.0', { changed:since !== '1.0' }) : answer('2.0', { events:[{ id:2 }] }));
  await h.sync.start();
  await h.settle();
  assert.deepEqual(h.calls, [null]);
  assert.equal(h.reports.at(-1).state, 'current', 'the first answer only sets the revision');
  await h.advance(29_000);
  assert.equal(h.calls.length, 1);
  await h.advance(1_000);
  assert.deepEqual(h.calls, [null, '1.0']);
  assert.equal(h.reports.at(-1).state, 'current');
  await h.advance(30_000);
  const last = h.reports.at(-1);
  assert.deepEqual([last.state, last.revision, last.events.length], ['new_data', '2.0', 1]);
});

test('a hidden tab makes no requests; showing it checks at once', async () => {
  const h = harness(() => answer('1.0'));
  await h.sync.start();
  await h.settle();
  h.sync.setVisible(false);
  await h.advance(5 * 60_000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
  h.sync.setVisible(true);
  await h.settle();
  assert.equal(h.calls.length, 2);
});

test('overlapping refreshes share one request', async () => {
  let release;
  const h = harness(() => new Promise(done => { release = () => done({ revision:'1.0', changed:false, latest_published_at:null, checked_at:0, events:[], visit_ids:[] }); }));
  const first = h.sync.start();
  h.sync.refresh(); h.sync.refresh();
  assert.equal(h.calls.length, 1);
  release(); await first;
});

test('stopping or switching account discards answers that arrive late', async () => {
  let release;
  const h = harness(() => new Promise(done => { release = done; }));
  h.sync.start();
  h.sync.stop();
  release({ revision:'9.9', changed:true, latest_published_at:1, checked_at:0, events:[{ id:9, notes:'Another account' }], visit_ids:[] });
  await h.settle(); await h.settle();
  assert.ok(h.reports.every(report => report.events.length === 0), 'nothing from the old generation is reported');
  assert.equal(h.sync.status.revision, null);
  assert.equal(h.timers.size, 0, 'no checks scheduled after stop');
});

test('errors back off up to five minutes, then recover; old data becomes stale', async () => {
  let fail = false;
  const h = harness(() => fail ? Promise.reject(new Error('offline')) : answer('1.0'));
  await h.sync.start();
  await h.settle();
  fail = true;
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    const before = h.calls.length;
    let waited = 0;
    while (h.calls.length === before) { await h.advance(10_000); waited += 10_000; }
    gaps.push(waited);
  }
  assert.deepEqual(gaps, [30_000, 30_000, 60_000, 120_000, 240_000, 300_000]);
  assert.equal(h.reports.at(-1).state, 'stale');
  fail = false;
  await h.sync.refresh();
  await h.settle();
  assert.equal(h.reports.at(-1).state, 'current');
});

let app, visitId, pet;
const call = (...args) => app.call(...args);
before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(6)) });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const portal = (await call('ann','GET','/api/portal')).json;
  pet = portal.pets[0].id;
  visitId = (await call('ann','POST','/api/bookings',{ service:portal.services[0].id, pets:[pet], slot:portal.windows[0].id, start:starts, cents:3000, notes:'' })).json.id;
  for (const status of ['Confirmed','In Progress']) await call('staff','POST','/api/status',{ id:visitId, status });
});
after(() => app.stop());

test('the changes endpoint returns new updates once, for the right customer only', async () => {
  const first = (await call('ann','GET','/api/diary/changes')).json;
  assert.match(first.revision, /^\d+\.\d+$/);
  assert.equal(first.changed, false);
  const unchanged = (await call('ann','GET','/api/diary/changes?since=' + first.revision)).json;
  assert.deepEqual([unchanged.changed, unchanged.events.length], [false, 0]);
  await call('staff','POST','/api/events',{ id:visitId, pet, kind:'Walk started', notes:'Off we go' });
  const fresh = (await call('ann','GET','/api/diary/changes?since=' + first.revision)).json;
  assert.equal(fresh.changed, true);
  assert.deepEqual(fresh.events.map(event => [event.kind, event.notes]), [['Walk started','Off we go']]);
  assert.notEqual(fresh.revision, first.revision);
  assert.ok(fresh.latest_published_at > 0);
  const bob = (await call('bob','GET','/api/diary/changes?since=0.0')).json;
  assert.deepEqual([bob.events.length, bob.visit_ids.length], [0, 0], 'another customer sees nothing');
  const staff = (await call('staff','GET','/api/diary/changes?since=0.0')).json;
  assert.ok(staff.events.length >= 1);
  await call('staff','POST','/api/status',{ id:visitId, status:'Completed', summary:'Good walk', secured:true });
  const completed = (await call('ann','GET','/api/diary/changes?since=' + fresh.revision)).json;
  assert.deepEqual([completed.changed, completed.visit_ids], [true, [visitId]], 'a finished visit is reported');
  assert.equal((await call('ann','GET','/api/diary/changes?since=garbage')).json.code, 'invalid_revision');
  assert.equal((await call('nobody','GET','/api/diary/changes')).status, 401);
});
