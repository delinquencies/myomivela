import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password } from './helpers.mjs';
import { myoConfig } from '../assets/myo-config.js';

// CUX-08: ZIP eligibility, a guest quote for a real date without an account, its parity with the signed-in quote,
// day times for guests, and contact details on the account. Launch pricing mode, both runtimes.
let app, walk, dropIn, overnight, defaultDay, shortDay;
const call = (...args) => app.call(...args);
const quote = body => call('guest','POST','/api/public-quote', body);
const timesOn = async (service, date) => (await call('guest','GET',`/api/availability/times?service=${service}&date=${date}`)).json.times;

before(async () => {
  app = await startServer({ MYO_PRICING_MODE:'launch' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0, overnight_days:[0,1,2,3,4,5,6] });
  for (const [name, minutes] of [['Dog walking',30],['Drop-in visit',30],['Overnight pet sitting',720]]) await call('staff','POST','/api/services',{ name, minutes, cents:3000 });
  const catalog = (await call('guest','GET','/api/catalog')).json;
  walk = catalog.find(s => s.name === 'Dog walking'); dropIn = catalog.find(s => s.name === 'Drop-in visit'); overnight = catalog.find(s => s.kind === 'overnight');
  const days = (await call('guest','GET','/api/availability/days?service=' + walk.id)).json;
  defaultDay = days.days.find(day => day.date === days.default_day);
  shortDay = days.days.find(day => day.open && day.last_minute);
});
after(() => app.stop());

test('a ZIP is in the area, near the edge, or outside by arrangement', async () => {
  const at = async zip => (await call('guest','GET','/api/eligibility?zip=' + encodeURIComponent(zip))).json;
  assert.deepEqual(pick(await at('01108')), { outcome:'in_area', confidence:'high', by_arrangement:false, listed:true });
  assert.equal((await at('01001-1234')).place, 'Agawam', 'ZIP+4 is accepted');
  const edge = await at('01060');
  assert.deepEqual(pick(edge), { outcome:'boundary', confidence:'low', by_arrangement:true, listed:true });
  assert.ok(edge.distance_miles > myoConfig.business.radiusMiles);
  assert.deepEqual(pick(await at('02108')), { outcome:'outside', confidence:'low', by_arrangement:true, listed:false });
  for (const bad of ['1108', 'abcde', '']) assert.equal((await call('guest','GET','/api/eligibility?zip=' + bad)).json.code, 'invalid_zip');
});

test('a guest sees real times and a real price for a date, without an account', async () => {
  const times = await timesOn(walk.id, defaultDay.date);
  assert.equal(times[0].start, defaultDay.first_start);
  const result = await quote({ service:walk.id, pets:[{ kind:'dog', age_years:4 }], start:times[0].start, zip:'01108' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const body = result.json;
  assert.equal(body.estimate, true);
  assert.equal(body.total_cents, myoConfig.rates.visit * 100);
  assert.equal(body.deposit_cents, Math.round(body.total_cents * myoConfig.booking.depositRatio));
  assert.equal(body.deposit_cents + body.balance_cents, body.total_cents);
  assert.deepEqual(body.units, { kind:'visit', quantity:1, minutes:30 });
  assert.equal(body.notice.last_minute, false);
  assert.equal(body.eligibility.outcome, 'in_area');
  assert.ok(body.valid_until > Date.now() && /^[0-9a-f]{16}$/.test(body.revision));
  for (const key of ['blockers','owner','customer','email','pets']) assert.ok(!(key in body), 'no ' + key + ' in a public quote');
});

test('short notice, puppies and extra pets are priced as for a saved pet', async () => {
  if (shortDay) {
    const early = (await quote({ service:walk.id, pets:[{ kind:'dog' }], start:shortDay.first_start })).json;
    assert.equal(early.notice.last_minute, true);
    assert.equal(early.lines.find(line => line.code === 'lastMinute').cents, myoConfig.rates.lastMinute * 100);
  }
  const start = defaultDay.first_start;
  const puppy = (await quote({ service:walk.id, pets:[{ kind:'dog', age_years:0.5 }], start })).json;
  assert.equal(puppy.lines[0].cents, (puppy.peak.is_peak ? myoConfig.flags.peakPuppyRate : myoConfig.rates.puppy) * 100);
  const two = (await quote({ service:dropIn.id, pets:[{ kind:'dog', age_years:4 }, { kind:'cat' }], start })).json;
  assert.ok(two.lines.some(line => line.code === 'extraPets' && line.cents === myoConfig.rates.additionalCat * 100));
  assert.equal((await quote({ service:walk.id, pets:[{ kind:'cat' }], start })).json.code, 'pet_ineligible');
  for (const pets of [[], [{ kind:'horse' }], [{ kind:'dog', age_years:-1 }], 'dog']) assert.equal((await quote({ service:walk.id, pets, start })).json.code, 'invalid_pets');
  assert.equal((await quote({ service:walk.id, pets:[{ kind:'dog' }], start:start + 60_000 })).json.code, 'time_unavailable');
});

test('a stay is quoted per night', async () => {
  const nights = (await call('guest','GET','/api/availability/days?service=' + overnight.id)).json.overnight_nights;
  const first = nights.find((night, index) => nights[index + 1] === nextDay(night) && nights[index + 2] === nextDay(nextDay(night)));
  const body = (await quote({ service:overnight.id, pets:[{ kind:'dog', age_years:4 }], arrive:eastern(first, '17:00'), depart:eastern(nextDay(nextDay(first)), '10:00') })).json;
  assert.deepEqual(body.units, { kind:'night', quantity:2, minutes:null });
  assert.equal(body.lines[0].cents, 2 * myoConfig.rates.overnight * 100);
});

test('the guest quote matches the signed-in quote for the same facts, and holds nothing', async () => {
  const start = defaultDay.first_start;
  const guest = (await quote({ service:dropIn.id, pets:[{ kind:'dog', age_years:4 }, { kind:'cat', age_years:2 }], start })).json;
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:JSON.stringify({ age:'4' }) });
  await call('ann','POST','/api/pets',{ name:'Mia', species:'Cat', details:JSON.stringify({ age:'2' }) });
  const portal = (await call('ann','GET','/api/portal')).json;
  const slot = portal.slots.find(row => row.starts === start);
  assert.ok(slot, 'the time is still offered after guest quotes: nothing was held');
  // The first pet is priced as the primary pet, so both quotes list the dog first (portal pets are sorted by name).
  const ordered = ['Rex','Mia'].map(name => portal.pets.find(p => p.name === name).id);
  const signedIn = (await call('ann','POST','/api/quote',{ service:dropIn.id, pets:ordered, slot:slot.id, start })).json;
  for (const key of ['total_cents','deposit_cents','balance_cents','revision']) assert.equal(signedIn[key], guest[key], key);
  assert.deepEqual(signedIn.lines.map(l => [l.code, l.cents]), guest.lines.map(l => [l.code, l.cents]));
  assert.ok(Array.isArray(signedIn.blockers), 'only the signed-in quote reports blockers');
});

test('contact details are optional at registration, required at the contact step, and shown to the customer only', async () => {
  const made = await call('bob','POST','/api/register',{ name:'Bob', email:'bob@example.test', password, phone:'(413) 555-0100', address:'12 Maple St, Springfield, MA', zip:'01108' });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.deepEqual(made.json.contact, { phone:'(413) 555-0100', address:'12 Maple St, Springfield, MA', zip:'01108', area:'in_area' });
  assert.equal((await call('cy','POST','/api/register',{ name:'Cy', email:'cy@example.test', password, phone:'555' })).json.code, 'invalid_phone');
  assert.equal((await call('cy','POST','/api/register',{ name:'Cy', email:'cy@example.test', password, zip:'12' })).json.code, 'invalid_zip');
  assert.equal((await call('ann','GET','/api/session')).json.contact.phone, null, 'registering without contact still works');
  const missing = await call('ann','POST','/api/contact',{ phone:'413-555-0101', address:'1 Elm St' });
  assert.deepEqual([missing.json.code, missing.json.field], ['contact_required', 'zip']);
  const saved = await call('ann','POST','/api/contact',{ phone:'413-555-0101', address:'1 Elm St, Northampton, MA', zip:'01060' });
  assert.equal(saved.json.contact.area, 'boundary');
  assert.equal((await call('ann','GET','/api/session')).json.contact.zip, '01060');
  await call('staff','POST','/api/login',adminLogin);
  assert.equal((await call('staff','POST','/api/contact',{ phone:'413-555-0102', address:'x', zip:'01108' })).status, 403);
  assert.equal('contact' in (await call('staff','GET','/api/session')).json, false);
});

test('public lookups are rate-limited per address', async () => {
  let status = 200;
  for (let i = 0; i < 70 && status !== 429; i++) status = (await call('scraper','GET','/api/eligibility?zip=01108')).status;
  assert.equal(status, 429);
});

function pick({ outcome, confidence, by_arrangement, listed }) { return { outcome, confidence, by_arrangement, listed }; }
function nextDay(day) { return new Date(Date.parse(day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10); }
function eastern(day, hhmm) {
  const offsetAt = t => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return (sign === '+' ? 1 : -1) * (Number(h) * 60 + Number(m)) * 60_000;
  };
  const wall = Date.parse(`${day}T${hhmm}:00Z`);
  return wall - offsetAt(wall - offsetAt(wall));
}
