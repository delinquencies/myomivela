import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';
import { signPayload } from '../lib/payments.mjs';

// Packages (C3.5): defining, buying online, granting by hand, using a credit, and getting it back. Both runtimes.
const secret = 'whsec_pkg';
let app, walk, pet, slot, nextStart, offer, annId;
const call = (...args) => app.call(...args);
const bookingOf = async id => (await call('ann','GET','/api/portal')).json.bookings.find(b => b.id === id);
async function request(extra = {}) {
  const start = nextStart; nextStart += hours(1);
  return call('ann','POST','/api/bookings',{ service:walk.id, pets:[pet], slot:slot.id, start, cents:3000, notes:'', ...extra });
}
async function webhook(type, object, id) {
  const body = JSON.stringify({ id, type, data:{ object } });
  const response = await fetch(app.base + '/api/payments/webhook', { method:'POST', body, headers:{ 'Content-Type':'application/json', 'Stripe-Signature':await signPayload(secret, body) } });
  return response.json();
}

before(async () => {
  app = await startServer({ MYO_PAYMENTS:'fake', MYO_STRIPE_WEBHOOK_SECRET:secret });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('staff','POST','/api/services',{ name:'Overnight pet sitting', minutes:720, cents:10000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(12)) });
  nextStart = starts;
  annId = (await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password })).json.id;
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  annId = data.user.id;
  walk = data.services.find(s => s.name === 'Dog walking');
  pet = data.pets[0].id;
  slot = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('staff define packages for visit services only', async () => {
  const overnight = (await call('ann','GET','/api/catalog')).json.find(s => s.kind === 'overnight');
  assert.equal((await call('staff','POST','/api/packages',{ name:'Stays', service:overnight.id, credits:5, cents:40000, expires_days:90 })).json.code, 'package_visits_only');
  assert.equal((await call('ann','POST','/api/packages',{ name:'Ten walks', service:walk.id, credits:10, cents:27000, expires_days:180 })).status, 403);
  const made = await call('staff','POST','/api/packages',{ name:'Ten walks', service:walk.id, credits:10, cents:27000, expires_days:180 });
  assert.equal(made.status, 200);
  await call('staff','POST','/api/packages',{ name:'Old offer', service:walk.id, credits:2, cents:5000, expires_days:30, active:false });
  const seen = (await call('ann','GET','/api/packages')).json;
  assert.deepEqual(seen.packages.map(p => p.name), ['Ten walks'], 'customers see active packages only');
  assert.equal((await call('staff','GET','/api/packages')).json.packages.length, 2);
  offer = seen.packages[0];
});

test('without a credit, using a package is refused', async () => {
  assert.equal((await request({ use_package:true })).json.code, 'no_package_credit');
});

test('buying online grants the credits only when the signed webhook arrives, once', async () => {
  const buy = await call('ann','POST','/api/packages/buy',{ package:offer.id });
  assert.equal(buy.status, 200);
  assert.equal((await call('ann','GET','/api/packages')).json.balances.length, 0);
  const session = new URL(buy.json.redirect_url).searchParams.get('fake_session');
  const paid = { id:session, payment_status:'paid', amount_total:27000, payment_intent:'pi_pkg' };
  assert.equal((await webhook('checkout.session.completed', paid, 'evt_pkg_1')).result, 'paid');
  await webhook('checkout.session.async_payment_succeeded', paid, 'evt_pkg_2');
  const balances = (await call('ann','GET','/api/packages')).json.balances;
  assert.equal(balances.length, 1);
  assert.deepEqual([balances[0].credits, balances[0].remaining, balances[0].expired], [10, 10, false]);
  assert.equal((await call('staff','GET','/api/financials')).json.received.payments_cents, 27000);
});

test('a request holds a credit, confirmation applies it, cancellation gives it back', async () => {
  const made = await request({ use_package:true });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal((await call('ann','GET','/api/portal')).json.package_balances[0].remaining, 9);
  assert.equal((await bookingOf(made.json.id)).payment.status, 'none');
  await call('staff','POST','/api/status',{ id:made.json.id, status:'Confirmed' });
  const confirmed = (await bookingOf(made.json.id)).payment;
  assert.deepEqual([confirmed.status, confirmed.credit_cents, confirmed.balance_cents], ['paid', 3000, 0]);
  await call('ann','POST','/api/status',{ id:made.json.id, status:'Cancelled' });
  assert.equal((await call('ann','GET','/api/portal')).json.package_balances[0].remaining, 10);
  const ledger = (await call('ann','GET','/api/ledger?booking=' + made.json.id)).json.entries;
  assert.deepEqual(ledger.map(e => [e.kind, e.cents, e.method]), [['credit',3000,'package'],['credit',-3000,'package']]);
});

test('staff grant a package paid another way', async () => {
  assert.equal((await call('staff','POST','/api/packages/grant',{ user:annId, package:offer.id, method:'card' })).json.code, 'invalid_method');
  const granted = await call('staff','POST','/api/packages/grant',{ user:annId, package:offer.id, method:'cash', cents:25000 });
  assert.equal(granted.status, 200);
  assert.equal(granted.json.balances.length, 2);
});
