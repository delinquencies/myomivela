import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password } from './helpers.mjs';

// Recurring visits (C3.3): generation, projections, conflicts, skips, pause, auto-approve and ending. Both runtimes.
let app, walk, overnight, pet;
const call = (...args) => app.call(...args);
const dayMs = 86_400_000;
const today = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' }).format(Date.now());
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
const from = addDays(today, 2);
const pattern = [1, 4]; // Mondays and Thursdays
const expectedDays = () => { const days = []; for (let d = from; d <= addDays(today, 27); d = addDays(d, 1)) if (pattern.includes(weekday(d))) days.push(d); return days; };
const seriesBookings = async (who, id) => (await call(who,'GET','/api/portal')).json.bookings.filter(b => b.series === id);
let mine;

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:10000 });
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  // The second pattern date is closed, so it shows as a conflict.
  await call('staff','POST','/api/schedule-exception',{ day:expectedDays()[1], mode:'closed' });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  walk = data.services.find(s => s.kind === 'visit');
  overnight = data.services.find(s => s.kind === 'overnight');
  pet = data.pets[0].id;
});
after(() => app.stop());

test('a series is checked before it is saved', async () => {
  const base = { service:walk.id, pets:[pet], weekdays:pattern, time:'10:00', from };
  assert.equal((await call('ann','POST','/api/series',{ ...base, service:overnight.id })).json.code, 'series_visits_only');
  assert.equal((await call('ann','POST','/api/series',{ ...base, time:'10:15' })).json.code, 'invalid_time');
  assert.equal((await call('ann','POST','/api/series',{ ...base, from:addDays(today, -1) })).json.code, 'invalid_date');
  assert.equal((await call('ann','POST','/api/series',{ ...base, until:addDays(from, -1) })).json.code, 'invalid_date');
  assert.equal((await call('staff','POST','/api/series',base)).status, 403);
  assert.equal((await call('bob','POST','/api/series',base)).status, 404, 'another customer’s pet');
});

test('four weeks are booked as requests at the visit price; later dates are projected; a closed date is a conflict', async () => {
  const created = await call('ann','POST','/api/series',{ service:walk.id, pets:[pet], weekdays:pattern, time:'10:00', from, notes:'Side gate' });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  mine = created.json.series;
  assert.deepEqual([mine.weekdays, mine.time, mine.from, mine.until], [pattern, '10:00', from, null]);
  const days = expectedDays();
  const booked = await seriesBookings('ann', mine.id);
  assert.deepEqual(booked.map(b => b.series_day).sort(), days.filter((_, i) => i !== 1));
  assert.ok(booked.every(b => b.status === 'Requested' && b.cents === 3000 && b.notes === 'Side gate' && b.pet_ids[0] === pet));
  const conflict = mine.projections.find(p => p.date === days[1]);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.reason, 'unavailable', 'no published hours that day');
  assert.ok(mine.projections.some(p => p.status === 'projected' && p.date > addDays(today, 27)));
  // Reading again does not book anything twice.
  await call('ann','GET','/api/series');
  assert.equal((await seriesBookings('ann', mine.id)).length, booked.length);
  assert.equal((await call('bob','GET','/api/series')).json.series.length, 0);
  assert.equal((await call('staff','GET','/api/series')).json.series[0].customer, 'ann');
  assert.equal((await call('bob','POST','/api/series/pause',{ id:mine.id, paused:true })).status, 404);
});

test('skipping a date cancels its visit; un-skipping books it again, confirmed once staff turn on auto-approve', async () => {
  const day = expectedDays()[0];
  const skipped = await call('ann','POST','/api/series/skip',{ id:mine.id, day });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.json.series.projections.find(p => p.date === day).status, 'skipped');
  assert.equal((await call('ann','GET','/api/history')).json.bookings.concat((await call('ann','GET','/api/portal')).json.bookings)
    .find(b => b.series === mine.id && b.status === 'Cancelled')?.status, 'Cancelled');
  assert.equal((await call('ann','POST','/api/series/auto-approve',{ id:mine.id, auto_approve:true })).status, 403);
  assert.equal((await call('staff','POST','/api/series/auto-approve',{ id:mine.id, auto_approve:true })).json.series.auto_approve, true);
  const back = await call('ann','POST','/api/series/skip',{ id:mine.id, day, skip:false });
  const projection = back.json.series.projections.find(p => p.date === day);
  assert.equal(projection.status, 'booked');
  assert.equal(projection.booking.status, 'Confirmed');
});

test('a confirmed date inside the cancellation cutoff needs the fee accepted to skip', async () => {
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000, cancel_cutoff_hours:336, cancel_fee_percent:50 });
  const day = expectedDays()[0];
  const refused = await call('ann','POST','/api/series/skip',{ id:mine.id, day });
  assert.equal(refused.json.code, 'cancel_fee_changed');
  assert.equal(refused.json.fee_cents, 1500);
  assert.equal((await call('ann','POST','/api/series/skip',{ id:mine.id, day, accept_fee_cents:1500 })).status, 200);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000, cancel_fee_percent:0 });
});

test('pausing keeps booked visits; ending cancels the upcoming requests and stops the series', async () => {
  const paused = await call('ann','POST','/api/series/pause',{ id:mine.id, paused:true });
  assert.equal(paused.json.series.paused, true);
  assert.ok(paused.json.series.projections.every(p => p.status !== 'conflict'), 'a paused series has no conflicts, only projections');
  await call('ann','POST','/api/series/pause',{ id:mine.id, paused:false });
  const ended = await call('ann','POST','/api/series/end',{ id:mine.id });
  assert.ok(ended.json.cancelled > 0);
  assert.ok(ended.json.series.ended);
  assert.ok((await seriesBookings('ann', mine.id)).every(b => b.status !== 'Requested'));
  assert.equal((await call('ann','POST','/api/series/pause',{ id:mine.id, paused:false })).json.code, 'series_ended');
});
