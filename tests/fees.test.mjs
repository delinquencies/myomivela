import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso } from './helpers.mjs';

// Fee rules (C3.4): weekend, holiday, after-hours and short-notice fees in quotes and bookings. Both runtimes.
let app, walk, overnight, pets;
const call = (...args) => app.call(...args);
const dayMs = 86_400_000;
function eastern(day, hhmm) {
  const offsetAt = t => {
    const name = new Intl.DateTimeFormat('en-US',{ timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return (sign === '+' ? 1 : -1) * (Number(h) * 60 + Number(m)) * 60_000;
  };
  const wall = Date.parse(`${day}T${hhmm}:00Z`);
  return wall - offsetAt(wall - offsetAt(wall));
}
const easternToday = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' }).format(Date.now());
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
// The first date at least `min` days ahead that falls on `weekday` (0 = Sunday).
const nextWeekday = (weekday, min) => { let day = addDays(easternToday, min); while (new Date(day + 'T12:00:00Z').getUTCDay() !== weekday) day = addDays(day, 1); return day; };
const saturday = nextWeekday(6, 10), tuesday = nextWeekday(2, 10);
const windows = {};
async function windowOn(day, from = '06:00', to = '20:00') {
  await call('staff','POST','/api/slots',{ starts:iso(eastern(day, from)), ends:iso(eastern(day, to)) });
  const data = (await call('ann','GET','/api/portal')).json;
  return data.windows.find(w => w.starts === eastern(day, from));
}
const visit = (day, hhmm, extra = {}) => ({ service:walk.id, pets:[pets[0]], slot:windows[day].id, start:eastern(day, hhmm), notes:'', ...extra });
const quoted = async body => { const q = await call('ann','POST','/api/quote', body); assert.equal(q.status, 200, JSON.stringify(q.json)); return q.json; };
const rule = async body => { const r = await call('staff','POST','/api/fee-rules', body); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.id; };

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:10000 });
  await call('staff','POST','/api/schedule',{ days:[], opens:'08:00', closes:'18:00', buffer:0, overnight_days:[0,1,2,3,4,5,6] });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  walk = data.services.find(s => s.kind === 'visit');
  overnight = data.services.find(s => s.kind === 'overnight');
  pets = data.pets.map(p => p.id);
  for (const day of [saturday, tuesday]) windows[day] = await windowOn(day);
});
after(() => app.stop());

test('without fee rules a quote is unchanged', async () => {
  assert.deepEqual((await call('staff','GET','/api/fee-rules')).json, { rules:[], holidays:[] });
  assert.equal((await quoted(visit(saturday, '10:00'))).total_cents, 3000);
});

test('only staff manage fee rules, and invalid rules are refused', async () => {
  assert.equal((await call('ann','POST','/api/fee-rules',{ code:'x', label:'X', kind:'weekend', amount_type:'flat', value:100 })).status, 403);
  assert.equal((await call('staff','POST','/api/fee-rules',{ code:'x', label:'X', kind:'rainy', amount_type:'flat', value:100 })).json.code, 'fee_rule_invalid');
  assert.equal((await call('staff','POST','/api/fee-rules',{ code:'x', label:'X', kind:'weekend', amount_type:'percent', value:101 })).status, 400);
  assert.equal((await call('staff','POST','/api/fee-rules',{ code:'Bad Code', label:'X', kind:'weekend', amount_type:'flat', value:1 })).json.code, 'fee_rule_invalid');
  assert.equal((await call('staff','POST','/api/fee-rules',{ code:'x', label:'X', kind:'after_hours', amount_type:'flat', value:1, params:{ before:'19:00', after:'07:00' } })).status, 400);
});

test('a weekend percentage applies on the weekend only, and the booking keeps the fee line', async () => {
  const id = await rule({ code:'weekend', label:'Weekend', kind:'weekend', amount_type:'percent', value:20 });
  const sat = await quoted(visit(saturday, '10:00'));
  assert.deepEqual(sat.lines.at(-1), { code:'fee', label:'Weekend', quantity:1, cents:600 });
  assert.equal(sat.total_cents, 3600);
  assert.equal((await quoted(visit(tuesday, '10:00'))).total_cents, 3000);
  // The old price is refused; the new one books, and the lines are kept on the booking.
  assert.equal((await call('ann','POST','/api/checkout-hold', visit(saturday, '10:00', { cents:3000 }))).json.code, 'price_changed');
  const hold = await call('ann','POST','/api/checkout-hold', visit(saturday, '10:00', { cents:3600 }));
  assert.equal(hold.status, 200);
  const booking = await call('ann','POST','/api/bookings', visit(saturday, '10:00', { cents:3600, hold:hold.json.expires }));
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
  const row = (await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === booking.json.id);
  assert.equal(row.cents, 3600);
  assert.deepEqual(row.lines.map(l => l.code), ['base','fee']);
  // Turning the rule off changes new quotes, not the booking.
  await rule({ id, label:'Weekend', kind:'weekend', amount_type:'percent', value:20, active:false });
  assert.equal((await quoted(visit(saturday, '11:00'))).total_cents, 3000);
  assert.equal((await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === booking.json.id).cents, 3600);
  assert.equal((await call('staff','POST','/api/fee-rules/delete',{ id })).status, 200);
});

test('holiday, after-hours and short-notice fees stack in a fixed order', async () => {
  await rule({ code:'notice', label:'Short notice', kind:'short_notice', amount_type:'flat', value:500, params:{ hours:168 } });
  await rule({ code:'early', label:'Early visit', kind:'after_hours', amount_type:'flat', value:700, params:{ before:'08:00', after:'18:00' } });
  await rule({ code:'holiday', label:'Holiday', kind:'holiday', amount_type:'percent', value:50 });
  assert.equal((await call('staff','POST','/api/holidays',{ day:tuesday, name:'Test holiday' })).json.holidays.length, 1);
  const early = await quoted(visit(tuesday, '07:00'));
  assert.deepEqual(early.lines.map(l => [l.label, l.cents]), [['Dog walking',3000],['Holiday',1500],['Early visit',700]]);
  const late = await quoted(visit(tuesday, '19:30'));
  assert.equal(late.lines.find(l => l.label === 'Early visit')?.cents, 700, 'ending after hours counts too');
  assert.equal((await quoted(visit(tuesday, '12:00'))).total_cents, 4500);
  // Short notice: a window inside the next 168 hours.
  const soon = addDays(easternToday, 3);
  windows[soon] = await windowOn(soon, '10:00', '16:00');
  const near = await quoted(visit(soon, '12:00'));
  assert.equal(near.lines.find(l => l.label === 'Short notice')?.cents, 500);
  await call('staff','POST','/api/holidays/delete',{ day:tuesday });
  assert.equal((await quoted(visit(tuesday, '12:00'))).total_cents, 3000);
  for (const { id } of (await call('staff','GET','/api/fee-rules')).json.rules) await call('staff','POST','/api/fee-rules/delete',{ id });
});

test('a stay counts each weekend night at the per-night amount', async () => {
  await rule({ code:'weekend-nights', label:'Weekend night', kind:'weekend', amount_type:'percent', value:10, params:{ days:[5,6] } });
  const friday = nextWeekday(5, 20);
  // Thursday, Friday and Saturday nights: two of them are weekend nights.
  const q = await quoted({ service:overnight.id, pets:[pets[0]], arrive:eastern(addDays(friday, -1), '17:00'), depart:eastern(addDays(friday, 2), '10:00'), notes:'' });
  assert.deepEqual(q.lines.map(l => [l.code, l.quantity, l.cents]), [['nightly',3,30000],['fee',2,2000]]);
  assert.equal(q.total_cents, 32000);
});
