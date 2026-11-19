import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, nodeOnly } from './helpers.mjs';
import { isPeakDate, myoConfig } from '../assets/myo-config.js';

// CUX-09: per-day availability labels (open, full, peak, short notice), the fee-free default day, overnight nights,
// and full days removed from bookable times. Launch pricing mode, both runtimes (capacity seeding is Node-only).
let app, services;
const call = (...args) => app.call(...args);
const dayMs = 86_400_000;
const easternDay = new Intl.DateTimeFormat('sv-SE', { dateStyle:'short', timeZone:'America/New_York' });
const today = easternDay.format(Date.now());
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
function eastern(day, hhmm) {
  const offsetAt = t => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return (sign === '+' ? 1 : -1) * (Number(h) * 60 + Number(m)) * 60_000;
  };
  const wall = Date.parse(`${day}T${hhmm}:00Z`);
  return wall - offsetAt(wall - offsetAt(wall));
}
const days = async (service) => (await call('anyone','GET','/api/availability/days' + (service ? '?service=' + service : ''))).json;
const byKind = kind => services.find(service => service.kind === kind);

before(async () => {
  app = await startServer({ MYO_PRICING_MODE:'launch' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0, overnight_days:[0,1,2,3,4,5,6] });
  for (const [name, minutes] of [['Dog walking',30],['Overnight pet sitting',720],['Meet & Greet',30]]) {
    await call('staff','POST','/api/services',{ name, minutes, cents:name === 'Meet & Greet' ? 0 : 3000 });
  }
  services = (await call('anyone','GET','/api/catalog')).json;
});
after(() => app.stop());

test('28 days from today, each labelled; the short-notice window matches the quote rule', async () => {
  const result = await days(byKind('visit').id);
  assert.equal(result.kind, 'visit');
  assert.equal(result.days.length, 28);
  assert.equal(result.days[0].date, today);
  assert.deepEqual(result.notice, { days:myoConfig.booking.visitNoticeDays });
  for (const [index, day] of result.days.entries()) {
    assert.equal(day.last_minute, index < myoConfig.booking.visitNoticeDays, day.date);
    assert.equal(day.peak, isPeakDate(day.date), day.date);
    if (day.open) assert.ok(day.first_start > Date.now() && easternDay.format(day.first_start) === day.date, day.date);
  }
  assert.equal(result.notice_free_from, addDays(today, myoConfig.booking.visitNoticeDays));
});

test('the default day is the first fee-free open day, and its quote has no short-notice fee', async () => {
  const result = await days(byKind('visit').id);
  assert.equal(result.default_reason, 'notice_free');
  assert.equal(result.default_day, result.days.find(day => day.open && !day.last_minute).date);
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'{"age":"4"}' });
  const portal = (await call('ann','GET','/api/portal')).json;
  const first = result.days.find(day => day.date === result.default_day).first_start;
  const slot = portal.slots.find(row => row.starts === first);
  const quote = await call('ann','POST','/api/quote',{ service:byKind('visit').id, pets:[portal.pets[0].id], slot:slot.id, start:first });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  assert.ok(!quote.json.lines.some(line => line.code === 'lastMinute'), 'no last-minute line on the default day');
  const early = result.days.find(day => day.open && day.last_minute);
  if (early) {
    const earlySlot = portal.slots.find(row => row.starts === early.first_start);
    const earlyQuote = await call('ann','POST','/api/quote',{ service:byKind('visit').id, pets:[portal.pets[0].id], slot:earlySlot.id, start:early.first_start });
    assert.ok(earlyQuote.json.lines.some(line => line.code === 'lastMinute'), 'a labelled short-notice day carries the fee');
  }
});

test('a Meet & Greet never carries a short-notice label; overnights list their open nights', async () => {
  const meet = await days(byKind('meet').id);
  assert.equal(meet.notice, null);
  assert.ok(meet.days.every(day => !day.last_minute));
  const stay = await days(byKind('overnight').id);
  assert.equal(stay.kind, 'overnight');
  assert.deepEqual(stay.notice, { days:myoConfig.booking.overnightNoticeDays });
  assert.ok(stay.overnight_nights.length > 0);
  assert.ok(stay.days.filter(day => day.open).every(day => stay.overnight_nights.includes(day.date)));
  assert.ok(stay.days.every(day => day.first_start === null), 'stays are chosen by night, not by start time');
});

test('bad service parameters are refused', async () => {
  assert.equal((await call('anyone','GET','/api/availability/days?service=abc')).json.code, 'invalid_service');
  assert.equal((await call('anyone','GET','/api/availability/days?service=999')).status, 404);
  assert.equal((await days()).kind, 'visit', 'without a service, daytime visits are described');
});

test('a full day (including a stay crossing midnight) is closed everywhere and refused by the quote', { skip:nodeOnly }, async () => {
  const target = addDays(today, 10), nextDay = addDays(today, 11);
  const db = new DatabaseSync(app.dbPath);
  try {
    const owner = db.prepare("SELECT id FROM users WHERE email='ann@example.test'").get().id;
    const insert = db.prepare("INSERT INTO bookings(owner,service,starts,ends,cents,notes,status) VALUES(?,?,?,?,?,'','Confirmed')");
    // Ten bookings from 11 PM on the target day to 1 AM the next: both days reach capacity.
    for (let i = 0; i < myoConfig.business.capacity; i++) insert.run(owner, byKind('visit').id, eastern(target, '23:00'), eastern(nextDay, '01:00'), 3000);
  } finally { db.close(); }
  const result = await days(byKind('visit').id);
  for (const date of [target, nextDay]) {
    const day = result.days.find(row => row.date === date);
    assert.deepEqual([day.full, day.open, day.first_start], [true, false, null], date);
  }
  const stay = await days(byKind('overnight').id);
  assert.ok(!stay.overnight_nights.includes(target) && !stay.overnight_nights.includes(nextDay), 'full days are not offered as nights');
  const portal = (await call('ann','GET','/api/portal')).json;
  assert.ok(!portal.slots.some(slot => [target, nextDay].includes(easternDay.format(slot.starts))), 'no bookable times on full days');
  // The day's regular-hours window is identified by its opening time.
  const refused = await call('ann','POST','/api/quote',{ service:byKind('visit').id, pets:[portal.pets[0].id], slot:eastern(target, '08:00'), start:eastern(target, '10:00') });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'time_unavailable');
});

test('catalog mode has no capacity or launch notice labels', async () => {
  const catalog = await startServer();
  try {
    await catalog.call('staff','POST','/api/login',adminLogin);
    await catalog.call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
    await catalog.call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
    const result = (await catalog.call('anyone','GET','/api/availability/days')).json;
    assert.equal(result.notice, null);
    assert.ok(result.days.every(day => !day.last_minute && !day.full));
    assert.equal(result.default_day, result.days.find(day => day.open).date);
  } finally { await catalog.stop(); }
});
