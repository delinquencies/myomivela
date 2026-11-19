import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';
import { launchQuote } from '../lib/pricing.mjs';
import { myoConfig, isPeakDate } from '../assets/myo-config.js';

test('server launch pricing uses flat peak visits, overnight peak nights and puppy/additional pet rules', () => {
  const dog = { species: 'Dog', details: '' },
    cat = { species: 'Cat', details: '' };
  const service = { name: 'Drop-in visit', kind: 'visit', minutes: 60, cents: 1 };
  const peak = Date.parse('2027-07-05T14:00:00-04:00');
  assert.equal(
    launchQuote({ service, pets: [dog, cat], starts: peak, now: peak - hours(240) }).total_cents,
    7700
  );
  assert.equal(
    launchQuote({
      service: { ...service, name: 'Overnight pet sitting', kind: 'overnight' },
      pets: [dog, cat],
      starts: peak,
      nights: 2,
      now: peak - hours(240),
    }).total_cents,
    26000
  );
  assert.equal(
    launchQuote({
      service: { ...service, minutes: 30 },
      pets: [{ species: 'Dog', details: JSON.stringify({ age: '6 months' }) }],
      starts: peak + hours(24),
      now: peak + hours(1),
    }).total_cents,
    5400
  );
});
let app, selection;
before(async () => {
  app = await startServer({ MYO_PRICING_MODE: 'launch' });
});
after(() => app.stop());
test('launch API catalog, live quote and booking use approved configuration instead of a stale catalog price', async () => {
  await app.call('staff', 'POST', '/api/login', adminLogin);
  await app.call('staff', 'POST', '/api/services', {
    name: 'Drop-in visit',
    minutes: 30,
    cents: 2500,
    extra_pet_cents: 1000,
  });
  await app.call('a', 'POST', '/api/register', { name: 'A', email: 'launch-a@example.test', password });
  await app.call('b', 'POST', '/api/register', { name: 'B', email: 'launch-b@example.test', password });
  await app.call('a', 'POST', '/api/pets', { name: 'Rex', species: 'Dog', details: '' });
  await app.call('a', 'POST', '/api/pets', { name: 'Mochi', species: 'Cat', details: '' });
  let starts = Math.ceil((Date.now() + hours(240)) / hours(1)) * hours(1);
  const day = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: myoConfig.business.timeZone });
  while (isPeakDate(day.format(starts))) starts += hours(24);
  await app.call('staff', 'POST', '/api/slots', { starts: iso(starts), ends: iso(starts + hours(3)) });
  const { json: data } = await app.call('a', 'GET', '/api/portal');
  assert.equal(data.pricing_mode, 'launch');
  assert.equal(data.services[0].cents, 3000);
  const body = {
    service: data.services[0].id,
    pets: [...data.pets].sort((a, b) => (a.species === 'Dog' ? -1 : 1)).map((p) => p.id),
    slot: data.windows[0].id,
    start: starts,
    notes: '',
  };
  selection = body;
  const quoted = await app.call('a', 'POST', '/api/quote', body);
  assert.equal(quoted.status, 200);
  assert.equal(quoted.json.total_cents, 4300);
  assert.equal(
    (await app.call('a', 'POST', '/api/bookings', { ...body, cents: 3500 })).json.code,
    'price_changed'
  );
  const blocked = await app.call('a', 'POST', '/api/bookings', { ...body, cents: 4300 });
  assert.equal(blocked.status, 409);
  assert.deepEqual(
    blocked.json.blockers.map((item) => item.code),
    ['intake_required', 'meet_required']
  );
});
test('all intake fields are saved for the owner and staff, backed up, and protected from other customers', async () => {
  const body = {
    service: 'overnight',
    spendingLimit: 0,
    vetAuthorization: 'no',
    overnightAlone: 'Up to six hours',
    overnightBehavior: 'Quiet overnight',
    overnightAcknowledgment: true,
  };
  for (const [key] of myoConfig.intakeFields) if (!(key in body)) body[key] = 'Sample ' + key;
  assert.equal((await app.call('a', 'POST', '/api/intake', { ...body, emergency: '' })).status, 400);
  assert.equal(
    (await app.call('a', 'POST', '/api/intake', { ...body, overnightAcknowledgment: false })).status,
    400
  );
  body.feeding = 'Detailed feeding instructions. '.repeat(200);
  assert.equal((await app.call('a', 'POST', '/api/intake', body)).status, 200);
  const saved = (await app.call('a', 'GET', '/api/intake')).json;
  assert.equal(saved.spendingLimit, 0);
  assert.equal(saved.vetAuthorization, 'no');
  assert.equal((await app.call('b', 'GET', '/api/intake')).json, null);
  assert.equal((await app.call('staff', 'GET', '/api/intake')).status, 403);
  const owner = (await app.call('a', 'GET', '/api/session')).json.id;
  assert.equal(
    (await app.call('staff', 'GET', '/api/clients/' + owner)).json.intake.emergency,
    body.emergency
  );
  assert.equal((await app.call('b', 'GET', '/api/clients/' + owner)).status, 403);
});
test('one completed Meet & Greet covers the client’s bookings, and moves require review of the new peak price', async () => {
  await app.call('staff', 'POST', '/api/services', { name: 'Meet & Greet', minutes: 30, cents: 0 });
  const meet = (await app.call('a', 'GET', '/api/catalog')).json.find((service) => service.kind === 'meet');
  const request = await app.call('a', 'POST', '/api/bookings', { ...selection, service: meet.id, cents: 0 });
  assert.equal(request.status, 200);
  for (const status of ['Confirmed', 'In Progress'])
    assert.equal(
      (await app.call('staff', 'POST', '/api/status', { id: request.json.id, status })).status,
      200
    );
  await app.call('staff', 'POST', '/api/status', {
    id: request.json.id,
    status: 'Completed',
    summary: 'Introductions completed',
    secured: true,
  });
  const paid = await app.call('a', 'POST', '/api/bookings', { ...selection, cents: 4300 });
  assert.equal(paid.status, 200);
  const second = await app.call('a', 'POST', '/api/bookings', {
    ...selection,
    start: selection.start + hours(1),
    cents: 4300,
  });
  // Owner decision (Nov 19, 2026): the Meet & Greet is once per client, so a second booking needs no new meeting.
  assert.equal(second.status, 200, JSON.stringify(second.json));
  const peakDay = myoConfig.peakPeriods.find(
    ([, start]) => Date.parse(start + 'T15:00:00Z') > Date.now() + hours(72)
  )?.[1];
  if (!peakDay) return;
  const starts = Date.parse(peakDay + 'T15:00:00Z');
  await app.call('staff', 'POST', '/api/slots', { starts: iso(starts), ends: iso(starts + hours(3)) });
  const window = (await app.call('a', 'GET', '/api/portal')).json.windows.find(
    (row) => row.starts === starts
  );
  const move = { id: paid.json.id, slot: window.id, start: starts };
  const quoted = await app.call('a', 'POST', '/api/reschedule-quote', move);
  assert.equal(quoted.json.total_cents, 5700);
  assert.equal(
    (await app.call('a', 'POST', '/api/reschedule', { ...move, cents: 4300 })).json.code,
    'price_changed'
  );
  assert.equal((await app.call('a', 'POST', '/api/reschedule', { ...move, cents: 5700 })).status, 200);
  const saved = (await app.call('a', 'GET', '/api/portal')).json.bookings.find(
    (row) => row.id === paid.json.id
  );
  assert.equal(saved.cents, 5700);
  assert.equal(saved.meet_booking, request.json.id);
  assert.equal(
    saved.lines.reduce((sum, line) => sum + line.cents, 0),
    5700
  );
});
test('launch mode enforces the configured daily capacity even across separate appointment times', async () => {
  const day = new Date(selection.start + hours(24 * 30)).toISOString().slice(0, 10);
  const starts = Date.parse(day + 'T11:00:00Z');
  await app.call('staff', 'POST', '/api/slots', { starts: iso(starts), ends: iso(starts + hours(12)) });
  const portal = (await app.call('a', 'GET', '/api/portal')).json;
  const window = portal.windows.find((row) => row.starts === starts);
  const meet = portal.services.find((row) => row.kind === 'meet');
  for (let i = 0; i < myoConfig.business.capacity; i++) {
    const request = await app.call('a', 'POST', '/api/bookings', {
      service: meet.id,
      pets: selection.pets,
      slot: window.id,
      start: starts + hours(i),
      cents: 0,
      notes: '',
    });
    assert.equal(request.status, 200, JSON.stringify(request.json));
    assert.equal(
      (await app.call('staff', 'POST', '/api/status', { id: request.json.id, status: 'Confirmed' })).status,
      200
    );
  }
  const refused = await app.call('a', 'POST', '/api/quote', {
    service: meet.id,
    pets: selection.pets,
    slot: window.id,
    start: starts + hours(10),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'time_unavailable');
});
