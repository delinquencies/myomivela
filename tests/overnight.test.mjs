import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, nodeOnly } from './helpers.mjs';

// Overnight stays (C2.1): nightly pricing, availability by night, stay conflicts, diary nights and late pickup.
let app, overnight, walk, annPets, bobPet, nights;
const call = (...args) => app.call(...args);
const dayMs = 86_400_000;
// Epoch ms for a wall-clock time in Massachusetts.
function eastern(day, hhmm) {
  const offsetAt = t => {
    const name = new Intl.DateTimeFormat('en-US',{ timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return (sign === '+' ? 1 : -1) * (Number(h) * 60 + Number(m)) * 60_000;
  };
  const wall = Date.parse(`${day}T${hhmm}:00Z`);
  return wall - offsetAt(wall - offsetAt(wall));
}
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const stay = (who, pets, arrive, depart, extra = {}) => ({ service:overnight.id, pets, arrive, depart, notes:'', ...extra });
async function book(who, pets, arrive, depart) {
  const q = await call(who,'POST','/api/quote', stay(who, pets, arrive, depart));
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const hold = await call(who,'POST','/api/checkout-hold', stay(who, pets, arrive, depart, { cents:q.json.total_cents }));
  assert.equal(hold.status, 200, JSON.stringify(hold.json));
  const booking = await call(who,'POST','/api/bookings', stay(who, pets, arrive, depart, { cents:q.json.total_cents, hold:hold.json.expires }));
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
  return { id:booking.json.id, quote:q.json };
}

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:11000, extra_pet_cents:2000 });
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  assert.equal((await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'20:00', buffer:0,
    overnight_days:[0,1,2,3,4,5,6], late_pickup_grace:120 })).status, 200);
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  for (const pet of ['Rex','Pip']) await call('ann','POST','/api/pets',{ name:pet, species:'Dog', details:'' });
  await call('bob','POST','/api/pets',{ name:'Mo', species:'Cat', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  overnight = data.services.find(s => s.kind === 'overnight');
  walk = data.services.find(s => s.kind === 'visit');
  annPets = data.pets.map(p => p.id);
  bobPet = (await call('bob','GET','/api/portal')).json.pets[0].id;
  nights = data.overnight_nights.map(n => n.date);
});
after(() => app.stop());

test('customers see bookable nights; stays are not offered as start times', async () => {
  assert.ok(nights.length >= 30, 'nights are listed for the coming weeks');
  const data = (await call('ann','GET','/api/portal')).json;
  assert.ok(data.slots.every(slot => !slot.service_ids.includes(overnight.id)));
  const availability = (await call('anyone','GET','/api/availability')).json.find(row => row.kind === 'overnight');
  assert.equal(availability.nights.length, 3);
  assert.equal((await call('staff','GET','/api/portal')).json.schedule.overnight_days, 127);
});

test('a stay is priced per night, including extra pets', async () => {
  const day = nights[3];
  const q = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(day,'17:00'), eastern(addDays(day,3),'10:00')));
  assert.equal(q.status, 200, JSON.stringify(q.json));
  assert.deepEqual(q.json.lines.map(l => [l.code, l.quantity, l.cents]), [['nightly',3,33000],['extra_pet',3,6000]]);
  assert.equal(q.json.total_cents, 39000);
});

test('a confirmed stay takes its nights; daytime visits stay possible except over arrival and departure', async () => {
  const day = nights[5];
  const arrive = eastern(day,'17:00'), depart = eastern(addDays(day,2),'10:00');
  const { id } = await book('ann', annPets, arrive, depart);
  assert.ok((await call('bob','GET','/api/portal')).json.overnight_nights.some(n => n.date === day), 'a request alone does not take the nights');
  assert.equal((await call('staff','POST','/api/status',{ id, status:'Confirmed' })).status, 200);
  const bobNights = (await call('bob','GET','/api/portal')).json.overnight_nights.map(n => n.date);
  assert.ok(!bobNights.includes(day) && !bobNights.includes(addDays(day,1)) && bobNights.includes(addDays(day,2)));
  const clash = await call('bob','POST','/api/quote', { service:overnight.id, pets:[bobPet], arrive:eastern(addDays(day,1),'18:00'), depart:eastern(addDays(day,3),'09:00') });
  assert.equal(clash.json.code, 'time_reserved');
  const slots = (await call('bob','GET','/api/portal')).json.slots;
  const middayNextDay = eastern(addDays(day,1),'12:00');
  assert.ok(slots.some(s => s.starts === middayNextDay && s.service_ids.includes(walk.id)), 'a walk mid-stay is offered');
  assert.ok(!slots.some(s => s.starts === arrive && s.service_ids.includes(walk.id)), 'a walk over the arrival block is not');
  const row = (await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === id);
  assert.equal(row.cents, 26000);
  assert.equal(row.service_kind, 'overnight');
});

test('closed dates, unavailable nights and lengths are refused', async () => {
  const day = nights[10];
  await call('staff','POST','/api/schedule-exception',{ day:addDays(day,1), mode:'closed' });
  const closed = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(day,'17:00'), eastern(addDays(day,3),'10:00')));
  assert.equal(closed.json.code, 'night_unavailable');
  assert.equal(closed.json.day, addDays(day,1));
  await call('staff','POST','/api/schedule-exception',{ day:addDays(day,1), mode:'reset' });
  const tooLong = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(day,'17:00'), eastern(addDays(day,29),'10:00')));
  assert.equal(tooLong.json.code, 'stay_length');
  const backwards = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(day,'17:00'), eastern(day,'10:00')));
  assert.equal(backwards.json.code, 'time_unavailable');
  const offGrid = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(day,'17:10'), eastern(addDays(day,1),'10:00')));
  assert.equal(offGrid.json.code, 'time_unavailable');
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'20:00', buffer:0, overnight_days:[5,6] });
  const weekday = await call('ann','POST','/api/quote', stay('ann', annPets, eastern(nights.find(d => ![5,6].includes(new Date(d + 'T12:00:00Z').getUTCDay())),'17:00'),
    eastern(addDays(nights.find(d => ![5,6].includes(new Date(d + 'T12:00:00Z').getUTCDay())),1),'10:00')));
  assert.equal(weekday.json.code, 'night_unavailable');
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'20:00', buffer:0, overnight_days:[0,1,2,3,4,5,6] });
  assert.equal((await call('staff','GET','/api/portal')).json.schedule.late_pickup_grace, 120, 'saving hours without the grace keeps it');
});

test('a stay can’t be rescheduled yet, and its diary groups updates by night', async () => {
  const day = nights[14];
  const { id } = await book('ann', annPets, eastern(day,'17:00'), eastern(addDays(day,2),'10:00'));
  const moved = await call('ann','POST','/api/reschedule',{ id, slot:0, start:eastern(day,'18:00') });
  assert.equal(moved.json.code, 'stay_reschedule_unsupported');
  for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id, status })).status, 200);
  assert.equal((await call('staff','POST','/api/events',{ id, pet:annPets[0], kind:'Arrival', notes:'Settled in' })).status, 200);
  const visit = (await call('ann','GET','/api/diary?visit=' + id)).json.visits[0];
  assert.deepEqual(visit.nights.map(n => n.date), [day, addDays(day,1)]);
  assert.equal(visit.nights[0].event_ids.length, 1, 'an update before the first night belongs to night 1');
});

test('a late pickup adds half a night after the grace period, and a whole night after 8 hours', { skip:nodeOnly }, async () => {
  for (const [late, expected] of [[3, 5500], [9, 11000], [1, 0]]) {
    const day = nights[20 + late];
    const { id } = await book('ann', [annPets[0]], eastern(day,'17:00'), eastern(addDays(day,1),'10:00'));
    for (const status of ['Confirmed','In Progress']) assert.equal((await call('staff','POST','/api/status',{ id, status })).status, 200);
    // The planned pickup is in the future; move it into the past so completing now is `late` hours late.
    const db = new DatabaseSync(app.dbPath);
    db.prepare('UPDATE bookings SET ends=? WHERE id=?').run(Date.now() - late * 3_600_000, id);
    db.close();
    assert.equal((await call('staff','POST','/api/status',{ id, status:'Completed', summary:'Home', secured:true })).status, 200);
    const row = (await call('ann','GET','/api/history')).json.bookings.find(b => b.id === id) || (await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === id);
    const line = row.lines.find(l => l.code === 'late_pickup');
    assert.equal(line?.cents ?? 0, expected, late + ' hours late');
    assert.equal(row.cents, 11000 + expected);
  }
});
