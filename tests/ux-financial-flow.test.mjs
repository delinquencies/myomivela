import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, iso, hours, nodeOnly } from './helpers.mjs';
import { signPayload } from '../lib/payments.mjs';
import { myoConfig } from '../assets/myo-config.js';
import { requiredFields } from '../assets/intake-model.js';

// Owner decisions of Nov 19, 2026 (CUX-02/04/09): one Meet & Greet per client, booked 24 hours ahead; a 50% deposit
// due 48 hours after the request; Myomi confirms once it is in; unpaid requests expire when online payment is on;
// cancelling 7+ days ahead is free, later Myomi keeps 50% of the deposit paid. Launch mode, fake payments.
const secret = 'whsec_flow';
const dayMs = 86_400_000;
let app, walk, meet, pet, days;
const call = (...args) => app.call(...args);
const intake = Object.fromEntries(requiredFields('walk').map(key => [key, key === 'spendingLimit' ? 0 : key === 'vetAuthorization' ? 'no' : 'Sample ' + key]));
const dayAhead = n => days.days.find((day, index) => index >= n && day.open);
async function timeOn(service, day, index = 0) {
  return (await call('ann','GET',`/api/availability/times?service=${service}&date=${day.date}`)).json.times[index];
}
async function request(service, day, index = 0, extra = {}) {
  const time = await timeOn(service.id, day, index);
  const body = { service:service.id, pets:[pet], slot:time.slot, start:time.start, notes:'' };
  const quote = (await call('ann','POST','/api/quote', body)).json;
  const made = await call('ann','POST','/api/bookings', { ...body, cents:quote.total_cents, accept_terms_version:quote.terms?.version, ...extra });
  return { made, quote };
}
async function webhook(object, id) {
  const body = JSON.stringify({ id, type:'checkout.session.completed', data:{ object } });
  const response = await fetch(app.base + '/api/payments/webhook', { method:'POST', body, headers:{ 'Content-Type':'application/json', 'Stripe-Signature':await signPayload(secret, body) } });
  return response.json();
}
async function payDeposit(id) {
  const start = (await call('ann','POST','/api/payments/start',{ booking:id })).json;
  const session = new URL(start.redirect_url).searchParams.get('fake_session');
  const view = (await call('ann','GET','/api/bookings/' + id)).json;
  await webhook({ id:session, payment_status:'paid', amount_total:view.booking.payment.balance_cents, payment_intent:'pi_' + id }, 'evt_' + id);
}

before(async () => {
  app = await startServer({ MYO_PRICING_MODE:'launch', MYO_PAYMENTS:'fake', MYO_STRIPE_WEBHOOK_SECRET:secret });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  for (const name of ['Dog walking','Meet & Greet']) await call('staff','POST','/api/services',{ name, minutes:30, cents:name === 'Meet & Greet' ? 0 : 3000 });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'{"age":"4"}' });
  await call('ann','POST','/api/intake',{ service:'walk', ...intake });
  const portal = (await call('ann','GET','/api/portal')).json;
  walk = portal.services.find(s => s.kind === 'visit');
  meet = portal.services.find(s => s.kind === 'meet');
  pet = portal.pets[0].id;
  days = (await call('ann','GET','/api/availability/days?service=' + walk.id)).json;
});
after(() => app.stop());

test('a Meet & Greet needs 24 hours’ notice', async () => {
  const starts = Math.ceil((Date.now() + hours(2)) / (30 * 60_000)) * 30 * 60_000;
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(3)) });
  const window = (await call('ann','GET','/api/portal')).json.windows.find(w => w.starts === starts);
  const soon = await call('ann','POST','/api/quote',{ service:meet.id, pets:[pet], slot:window.id, start:starts });
  assert.deepEqual([soon.status, soon.json.code, soon.json.hours], [409, 'meet_too_soon', 24]);
  const offered = (await call('ann','GET','/api/portal')).json.slots.filter(slot => slot.service_ids.includes(meet.id));
  assert.ok(offered.every(slot => slot.starts - Date.now() >= hours(24)), 'too-soon Meet & Greet times are not offered');
  assert.equal((await call('guest','POST','/api/public-quote',{ service:meet.id, pets:[{ kind:'dog' }], start:starts })).json.code, 'meet_too_soon');
});

test('before the Meet & Greet a paid request is blocked; after it, every booking is covered', async () => {
  const blocked = await request(walk, dayAhead(4));
  assert.equal(blocked.made.status, 409);
  const meetBlocker = blocked.made.json.blockers.find(b => b.code === 'meet_required');
  assert.equal(meetBlocker.status, 'needed');
  const { made } = await request(meet, dayAhead(2));
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(made.json.next_steps.some(step => step.code === 'pay_deposit'), false, 'a Meet & Greet has no deposit');
  assert.equal((await call('ann','GET','/api/portal')).json.meet_status, 'scheduled');
  for (const status of ['Confirmed','In Progress']) await call('staff','POST','/api/status',{ id:made.json.id, status });
  await call('staff','POST','/api/status',{ id:made.json.id, status:'Completed', summary:'Lovely to meet Rex', secured:true });
  assert.equal((await call('ann','GET','/api/portal')).json.meet_status, 'done');
  const first = await request(walk, dayAhead(4));
  const second = await request(walk, dayAhead(4), 2);
  assert.deepEqual([first.made.status, second.made.status], [200, 200]);
});

test('a paid request owes a 50% deposit within 48 hours, and Myomi confirms once it is in', async () => {
  const { made, quote } = await request(walk, dayAhead(5));
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const id = made.json.id;
  const deposit = Math.round(quote.total_cents * myoConfig.booking.depositRatio);
  assert.equal(quote.deposit_cents, deposit);
  const view = (await call('ann','GET','/api/bookings/' + id)).json;
  const payment = view.booking.payment;
  assert.deepEqual([payment.stage, payment.due_cents, payment.deposit_cents, payment.deposit_paid], ['deposit', deposit, deposit, false]);
  assert.ok(Math.abs(payment.deposit_due_at - (view.booking.created + hours(48))) < 1000, 'due 48 hours after the request');
  const step = view.next_steps.find(s => s.code === 'pay_deposit');
  assert.deepEqual([step.amount_cents, step.done], [deposit, false]);
  assert.ok(view.allowed_actions.includes('pay'));
  const notice = (await call('staff','GET','/api/outbox')).json.messages.find(m => m.template === 'deposit_due');
  assert.match(notice.text, new RegExp('\\$' + (deposit / 100).toFixed(2)));
  const early = await call('staff','POST','/api/status',{ id, status:'Confirmed' });
  assert.deepEqual([early.status, early.json.code], [409, 'deposit_unpaid']);
  await payDeposit(id);
  const paid = (await call('ann','GET','/api/bookings/' + id)).json;
  assert.equal(paid.booking.payment.deposit_paid, true);
  assert.equal(paid.next_steps.find(s => s.code === 'pay_deposit').done, true);
  assert.equal((await call('staff','POST','/api/status',{ id, status:'Confirmed' })).status, 200);
  const confirmed = (await call('ann','GET','/api/bookings/' + id)).json.booking.payment;
  assert.deepEqual([confirmed.stage, confirmed.status, confirmed.balance_cents], ['total', 'partial', quote.total_cents - deposit]);
});

test('the request records the accepted terms; changed terms are refused with the new ones', async () => {
  const stale = await request(walk, dayAhead(6), 0, { accept_terms_version:'old-version' });
  assert.deepEqual([stale.made.status, stale.made.json.code], [409, 'terms_changed']);
  assert.equal(stale.made.json.terms.cancellation_days, myoConfig.booking.cancellationDays);
  assert.equal(stale.made.json.terms.deposit_collection, 'online');
  const ok = await request(walk, dayAhead(6));
  const booking = (await call('ann','GET','/api/bookings/' + ok.made.json.id)).json.booking;
  assert.equal(booking.terms_version, ok.quote.terms.version);
  assert.ok(booking.terms_accepted_at > 0);
});

test('cancelling late keeps half the paid deposit; early or by Myomi, nothing', async () => {
  const late = await request(walk, dayAhead(4), 4);
  await payDeposit(late.made.json.id);
  const deposit = late.quote.deposit_cents;
  const preview = (await call('ann','GET','/api/cancellation-preview?booking=' + late.made.json.id)).json;
  assert.deepEqual([preview.model, preview.fee_cents, preview.cutoff_days], ['deposit', Math.round(deposit * 0.5), 7]);
  assert.equal((await call('ann','POST','/api/status',{ id:late.made.json.id, status:'Cancelled' })).json.code, 'cancel_fee_changed');
  await call('ann','POST','/api/status',{ id:late.made.json.id, status:'Cancelled', accept_fee_cents:preview.fee_cents });
  const after = (await call('ann','GET','/api/bookings/' + late.made.json.id)).json.booking;
  assert.deepEqual([after.cancel_reason, after.payment.status, after.payment.balance_cents], ['customer', 'refund_due', preview.fee_cents - deposit]);
  const far = dayAhead(12);
  const early = await request(walk, far);
  await payDeposit(early.made.json.id);
  assert.equal((await call('ann','GET','/api/cancellation-preview?booking=' + early.made.json.id)).json.fee_cents, 0, '7 or more days ahead is free');
  const unpaid = await request(walk, dayAhead(4), 6);
  assert.equal((await call('ann','GET','/api/cancellation-preview?booking=' + unpaid.made.json.id)).json.fee_cents, 0, 'nothing paid, nothing kept');
  await call('staff','POST','/api/status',{ id:early.made.json.id, status:'Cancelled' });
  assert.equal((await call('ann','GET','/api/bookings/' + early.made.json.id)).json.booking.cancel_reason, 'staff');
});

test('an unpaid request is reminded a day before and released at its deadline', { skip:nodeOnly }, async () => {
  const { made } = await request(walk, dayAhead(8));
  const id = made.json.id;
  const db = new DatabaseSync(app.dbPath);
  try { db.prepare('UPDATE bookings SET deposit_due_at=? WHERE id=?').run(Date.now() + hours(12), id); } finally { db.close(); }
  await call('ann','GET','/api/portal');
  await call('ann','GET','/api/portal');
  const reminders = (await call('staff','GET','/api/outbox')).json.messages.filter(m => m.template === 'deposit_reminder');
  assert.equal(reminders.length, 1, 'one reminder, however often it is checked');
  const db2 = new DatabaseSync(app.dbPath);
  try { db2.prepare('UPDATE bookings SET deposit_due_at=? WHERE id=?').run(Date.now() - 1000, id); } finally { db2.close(); }
  await call('ann','GET','/api/portal');
  const expired = (await call('ann','GET','/api/bookings/' + id)).json.booking;
  assert.deepEqual([expired.status, expired.cancel_reason], ['Cancelled', 'deposit_expired']);
  const templates = (await call('staff','GET','/api/outbox')).json.messages.map(m => m.template);
  assert.ok(templates.includes('deposit_expired') && templates.includes('deposit_expired_staff'));
});

test('with online payment off, deposits are arranged with Myomi and nothing expires on its own', { skip:nodeOnly }, async () => {
  const manual = await startServer({ MYO_PRICING_MODE:'launch' });
  try {
    const c = (...args) => manual.call(...args);
    await c('staff','POST','/api/login',adminLogin);
    await c('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
    for (const name of ['Dog walking','Meet & Greet']) await c('staff','POST','/api/services',{ name, minutes:30, cents:0 });
    await c('bo','POST','/api/register',{ name:'Bo', email:'bo@example.test', password });
    await c('bo','POST','/api/pets',{ name:'Ty', species:'Dog', details:'{"age":"4"}' });
    await c('bo','POST','/api/intake',{ service:'walk', ...intake });
    const portal = (await c('bo','GET','/api/portal')).json;
    assert.equal(portal.deposit_collection, 'manual');
    const [walkService, meetService] = ['visit','meet'].map(kind => portal.services.find(s => s.kind === kind));
    const open = (await c('bo','GET','/api/availability/days?service=' + walkService.id)).json.days.filter(day => day.open);
    const book = async (service, day) => {
      const time = (await c('bo','GET',`/api/availability/times?service=${service.id}&date=${day.date}`)).json.times[0];
      const body = { service:service.id, pets:[portal.pets[0].id], slot:time.slot, start:time.start, notes:'' };
      const quote = (await c('bo','POST','/api/quote', body)).json;
      return (await c('bo','POST','/api/bookings',{ ...body, cents:quote.total_cents })).json;
    };
    const meeting = await book(meetService, open[2]);
    for (const status of ['Confirmed','In Progress']) await c('staff','POST','/api/status',{ id:meeting.id, status });
    await c('staff','POST','/api/status',{ id:meeting.id, status:'Completed', summary:'Hello Ty', secured:true });
    // An ordinary day (not peak, not short notice), so the price is the base $30 whatever today's date is.
    const visit = await book(walkService, open.find((day, index) => index >= 5 && !day.peak && !day.last_minute));
    assert.equal(visit.next_steps.find(step => step.code === 'deposit_arranged').amount_cents, 1500);
    const db = new DatabaseSync(manual.dbPath);
    try { db.prepare('UPDATE bookings SET deposit_due_at=? WHERE id=?').run(Date.now() - 1000, visit.id); } finally { db.close(); }
    await c('bo','GET','/api/portal');
    assert.equal((await c('bo','GET','/api/bookings/' + visit.id)).json.booking.status, 'Requested', 'Myomi decides');
    // Myomi records the deposit by hand, then confirms.
    assert.equal((await c('staff','POST','/api/payments/record',{ booking:visit.id, cents:1500, method:'cash' })).status, 200);
    assert.equal((await c('staff','POST','/api/status',{ id:visit.id, status:'Confirmed' })).status, 200);
  } finally { await manual.stop(); }
});
