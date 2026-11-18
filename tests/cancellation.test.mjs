import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Cancellation policy (C3.2): per-service cutoff and fee, the accepted-fee check, waivers and refunds due. Both runtimes.
let app, walk, pet, slot, nextStart;
const call = (...args) => app.call(...args);
const policy = (cutoff, percent) => call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000, cancel_cutoff_hours:cutoff, cancel_fee_percent:percent });
async function booking({ confirm = true } = {}) {
  const start = nextStart; nextStart += hours(1);
  const made = await call('ann','POST','/api/bookings',{ service:walk.id, pets:[pet], slot:slot.id, start, cents:3000, notes:'' });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  if (confirm) assert.equal((await call('staff','POST','/api/status',{ id:made.json.id, status:'Confirmed' })).status, 200);
  return made.json.id;
}
const preview = async (who, id) => (await call(who,'GET','/api/cancellation-preview?booking=' + id)).json;
const paymentOf = async id => (await call('ann','GET','/api/portal')).json.bookings.concat((await call('ann','GET','/api/history')).json.bookings).find(b => b.id === id)?.payment;

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Meet & Greet', minutes:30, cents:0, cancel_fee_percent:50 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(12)) });
  nextStart = starts;
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  walk = data.services.find(s => s.name === 'Dog walking');
  pet = data.pets[0].id;
  slot = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('services default to a 24-hour cutoff and no fee; a Meet & Greet never has one', async () => {
  const services = (await call('ann','GET','/api/catalog')).json;
  assert.deepEqual([walk.cancel_cutoff_hours, walk.cancel_fee_percent], [24, 0]);
  assert.equal(services.find(s => s.kind === 'meet').cancel_fee_percent, 0);
  const id = await booking();
  assert.equal((await preview('ann', id)).fee_cents, 0);
  assert.equal((await call('ann','POST','/api/status',{ id, status:'Cancelled' })).status, 200);
});

test('inside the cutoff the fee must be accepted, and it remains owed after cancelling', async () => {
  await policy(24, 50);
  const outside = await booking();
  assert.equal((await preview('ann', outside)).fee_cents, 0, 'three days ahead is outside a 24-hour cutoff');
  await policy(336, 50); // two weeks: every test visit is now inside the cutoff
  const id = await booking();
  const terms = await preview('ann', id);
  assert.equal(terms.fee_cents, 1500);
  assert.equal(terms.percent, 50);
  assert.ok(terms.cutoff < Date.now());
  const refused = await call('ann','POST','/api/status',{ id, status:'Cancelled' });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'cancel_fee_changed');
  assert.equal(refused.json.fee_cents, 1500);
  assert.equal((await call('ann','POST','/api/status',{ id, status:'Cancelled', accept_fee_cents:1000 })).json.code, 'cancel_fee_changed');
  assert.equal((await call('ann','POST','/api/status',{ id, status:'Cancelled', accept_fee_cents:1500 })).status, 200);
  const payment = await paymentOf(id);
  assert.equal(payment.due_cents, 1500);
  assert.equal(payment.status, 'due');
});

test('requests are free to cancel and staff cancellations waive the fee', async () => {
  const request = await booking({ confirm:false });
  assert.equal((await preview('ann', request)).fee_cents, 0);
  assert.equal((await call('ann','POST','/api/status',{ id:request, status:'Cancelled' })).status, 200);
  const id = await booking();
  assert.equal((await preview('staff', id)).fee_cents, 0);
  assert.equal((await call('staff','POST','/api/status',{ id, status:'Cancelled' })).status, 200);
  assert.equal((await paymentOf(id)).due_cents, 0);
});

test('money already paid shows what is due back after the fee', async () => {
  const id = await booking();
  await call('staff','POST','/api/payments/record',{ booking:id, cents:3000, method:'cash' });
  const terms = await preview('ann', id);
  assert.equal(terms.refund_due_cents, 1500);
  await call('ann','POST','/api/status',{ id, status:'Cancelled', accept_fee_cents:1500 });
  const payment = await paymentOf(id);
  assert.equal(payment.status, 'refund_due');
  assert.equal(payment.balance_cents, -1500);
  await policy(24, 0);
});
