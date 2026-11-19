import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';
import { signPayload } from '../lib/payments.mjs';

// Ledger and payments (C3.1): hosted checkout, signed webhooks, refunds, manual payments and tips. Both runtimes.
const secret = 'whsec_test_secret';
let app, service, pet, slot, eventCount = 0;
const call = (...args) => app.call(...args);
const portal = async who => (await call(who,'GET','/api/portal')).json;
const bookingOf = async (who, id) => (await portal(who)).bookings.find(b => b.id === id);
let nextStart;
async function confirmedBooking() {
  const start = nextStart; nextStart += hours(1);
  const body = { service:service.id, pets:[pet], slot:slot.id, start, cents:3000, notes:'' };
  const booking = await call('ann','POST','/api/bookings', body);
  assert.equal(booking.status, 200, JSON.stringify(booking.json));
  assert.equal((await call('staff','POST','/api/status',{ id:booking.json.id, status:'Confirmed' })).status, 200);
  return booking.json.id;
}
async function webhook(type, object, { sign = secret, id = 'evt_' + (++eventCount) } = {}) {
  const body = JSON.stringify({ id, type, data:{ object } });
  const response = await fetch(app.base + '/api/payments/webhook', { method:'POST', body,
    headers:{ 'Content-Type':'application/json', 'Stripe-Signature':await signPayload(sign, body) } });
  return { status:response.status, json:await response.json() };
}
const sessionId = url => new URL(url).searchParams.get('fake_session');

before(async () => {
  app = await startServer({ MYO_PAYMENTS:'fake', MYO_STRIPE_WEBHOOK_SECRET:secret });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(12)) });
  nextStart = starts;
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  await call('bob','POST','/api/register',{ name:'Bob', email:'bob@example.test', password });
  const data = await portal('ann');
  [service, pet] = [data.services[0], data.pets[0].id];
  slot = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('a request owes nothing; a confirmed booking is due and the portal says payments are on', async () => {
  const data = await portal('ann');
  assert.equal(data.payments_enabled, true);
  const requested = await call('ann','POST','/api/bookings',{ service:service.id, pets:[pet], slot:slot.id, start:nextStart, cents:3000, notes:'' });
  nextStart += hours(1);
  assert.equal((await bookingOf('ann', requested.json.id)).payment.status, 'none');
  assert.equal((await call('ann','POST','/api/payments/start',{ booking:requested.json.id })).json.code, 'nothing_due');
  const id = await confirmedBooking();
  assert.deepEqual((await bookingOf('ann', id)).payment, { status:'due', due_cents:3000, paid_cents:0, refunded_cents:0, credit_cents:0, balance_cents:3000,
    deposit_cents:0, deposit_paid:false, deposit_due_at:null, stage:'total' });
});

test('only a correctly signed, recent webhook is accepted, and the redirect alone records nothing', async () => {
  const id = await confirmedBooking();
  const start = await call('ann','POST','/api/payments/start',{ booking:id });
  assert.equal(start.status, 200);
  assert.match(start.json.redirect_url, /payment=success/);
  assert.equal((await bookingOf('ann', id)).payment.status, 'pending');
  // Starting again reuses the open session.
  assert.equal((await call('ann','POST','/api/payments/start',{ booking:id })).json.redirect_url, start.json.redirect_url);
  assert.equal((await call('bob','POST','/api/payments/start',{ booking:id })).status, 404, 'another customer cannot pay or see it');
  const paid = { id:sessionId(start.json.redirect_url), payment_status:'paid', amount_total:3000, payment_intent:'pi_' + id };
  assert.equal((await webhook('checkout.session.completed', paid, { sign:'whsec_wrong' })).status, 400);
  const unsigned = await fetch(app.base + '/api/payments/webhook', { method:'POST', body:'{}', headers:{ 'Content-Type':'application/json' } });
  assert.equal(unsigned.status, 400);
  assert.equal((await bookingOf('ann', id)).payment.paid_cents, 0);
  const ok = await webhook('checkout.session.completed', paid, { id:'evt_paid_' + id });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result, 'paid');
  // A replay of the same event, or a second delivery of the same payment, changes nothing.
  assert.equal((await webhook('checkout.session.completed', paid, { id:'evt_paid_' + id })).json.result, 'duplicate');
  await webhook('checkout.session.async_payment_succeeded', paid);
  const payment = (await bookingOf('ann', id)).payment;
  assert.equal(payment.status, 'paid');
  assert.equal(payment.paid_cents, 3000);
  assert.equal((await call('ann','POST','/api/payments/start',{ booking:id })).json.code, 'nothing_due');
  const ledger = await call('ann','GET','/api/ledger?booking=' + id);
  assert.deepEqual(ledger.json.entries.map(e => [e.kind, e.cents, e.method]), [['payment',3000,'card']]);
  assert.equal((await call('bob','GET','/api/ledger?booking=' + id)).status, 404);
});

test('an expired checkout ends the pending state; an unpaid completion does not record money', async () => {
  const id = await confirmedBooking();
  const start = await call('ann','POST','/api/payments/start',{ booking:id });
  const session = sessionId(start.json.redirect_url);
  assert.equal((await webhook('checkout.session.completed', { id:session, payment_status:'unpaid', amount_total:3000 })).json.result, 'ignored');
  assert.equal((await webhook('checkout.session.expired', { id:session })).json.result, 'expired');
  assert.equal((await bookingOf('ann', id)).payment.status, 'due');
  // A new session is made, and an unknown session is ignored.
  assert.notEqual((await call('ann','POST','/api/payments/start',{ booking:id })).json.redirect_url, start.json.redirect_url);
  assert.equal((await webhook('checkout.session.completed', { id:'cs_unknown', payment_status:'paid', amount_total:100 })).json.result, 'ignored');
});

test('refunds go back through the provider, are limited to what was paid, and dashboard refunds are recorded once', async () => {
  const id = await confirmedBooking();
  const start = await call('ann','POST','/api/payments/start',{ booking:id });
  await webhook('checkout.session.completed', { id:sessionId(start.json.redirect_url), payment_status:'paid', amount_total:3000, payment_intent:'pi_r' + id });
  assert.equal((await call('ann','POST','/api/refunds',{ booking:id, cents:500, method:'card' })).status, 403);
  assert.equal((await call('staff','POST','/api/refunds',{ booking:id, cents:3001, method:'card' })).json.code, 'refund_too_large');
  const partial = await call('staff','POST','/api/refunds',{ booking:id, cents:1000, method:'card', note:'Short visit' });
  assert.equal(partial.status, 200, JSON.stringify(partial.json));
  assert.equal(partial.json.payment.status, 'partial');
  assert.equal(partial.json.payment.balance_cents, 1000);
  // The provider's own event for that refund is a duplicate; a refund made in the dashboard is new.
  const entries = (await call('staff','GET','/api/ledger?booking=' + id)).json.entries;
  const ours = entries.find(e => e.kind === 'refund');
  assert.equal((await webhook('refund.created', { id:ours.provider_ref, amount:1000, payment_intent:'pi_r' + id, status:'succeeded' })).json.result, 'duplicate');
  assert.equal((await webhook('refund.created', { id:'re_dash', amount:500, payment_intent:'pi_r' + id, status:'succeeded' })).json.result, 'refunded');
  const after = (await bookingOf('ann', id)).payment;
  assert.equal(after.refunded_cents, 1500);
  assert.equal((await call('staff','POST','/api/refunds',{ booking:id, cents:1501, method:'card' })).json.code, 'refund_too_large');
});

test('staff record cash payments and refunds by hand', async () => {
  const id = await confirmedBooking();
  assert.equal((await call('staff','POST','/api/payments/record',{ booking:id, cents:2000, method:'card' })).json.code, 'invalid_method');
  assert.equal((await call('ann','POST','/api/payments/record',{ booking:id, cents:2000, method:'cash' })).status, 403);
  const cash = await call('staff','POST','/api/payments/record',{ booking:id, cents:3500, method:'cash', note:'Paid at the door' });
  assert.equal(cash.json.payment.status, 'refund_due');
  assert.equal(cash.json.payment.balance_cents, -500);
  const back = await call('staff','POST','/api/refunds',{ booking:id, cents:500, method:'cash' });
  assert.equal(back.json.payment.status, 'paid');
  const entries = (await call('staff','GET','/api/ledger?booking=' + id)).json.entries;
  assert.deepEqual(entries.map(e => [e.kind, e.method, e.note]), [['payment','cash','Paid at the door'],['refund','cash','']]);
  const money = (await call('staff','GET','/api/financials')).json;
  assert.ok(money.received.payments_cents >= 3500);
  assert.ok(money.outstanding.owed_cents >= 3000);
});

test('tips join the balance; an automatic tip is added when the visit is completed', async () => {
  const id = await confirmedBooking();
  assert.equal((await call('ann','POST','/api/tips',{ booking:id, cents:500 })).json.code, 'tip_not_open');
  await call('staff','POST','/api/status',{ id, status:'In Progress' });
  const tipped = await call('ann','POST','/api/tips',{ booking:id, cents:500 });
  assert.equal(tipped.status, 200);
  assert.equal(tipped.json.payment.due_cents, 3500);
  assert.equal((await call('ann','POST','/api/tips',{ booking:id, cents:50 })).status, 400, 'at least $1');
  assert.equal((await call('ann','POST','/api/auto-tip',{ percent:31 })).status, 400);
  assert.equal((await call('ann','POST','/api/auto-tip',{ percent:20 })).json.auto_tip_percent, 20);
  assert.equal((await portal('ann')).user.auto_tip_percent, 20);
  // Already tipped: completion adds nothing more.
  await call('staff','POST','/api/status',{ id, status:'Completed', summary:'Good walk', secured:true });
  assert.equal((await bookingOf('ann', id)).cents, 3500);
  const second = await confirmedBooking();
  await call('staff','POST','/api/status',{ id:second, status:'In Progress' });
  assert.equal((await call('staff','POST','/api/status',{ id:second, status:'Completed', summary:'Good walk', secured:true })).status, 200);
  const done = await bookingOf('ann', second);
  assert.deepEqual(done.lines.at(-1), { code:'tip', label:'Tip (20%)', quantity:1, cents:600 });
  assert.equal(done.payment.due_cents, 3600);
});

test('with payments off, checkout is refused but manual records still work', async () => {
  const off = await startServer();
  try {
    await off.call('staff','POST','/api/login',adminLogin);
    await off.call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
    assert.equal((await off.call('ann','GET','/api/portal')).json.payments_enabled, false);
    assert.equal((await off.call('ann','POST','/api/payments/start',{ booking:1 })).json.code, 'payments_unavailable');
    const body = JSON.stringify({ id:'evt', type:'x', data:{ object:{} } });
    const hook = await fetch(off.base + '/api/payments/webhook', { method:'POST', body, headers:{ 'Content-Type':'application/json', 'Stripe-Signature':await signPayload(secret, body) } });
    assert.equal(hook.status, 503);
  } finally { await off.stop(); }
});
