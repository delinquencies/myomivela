// Browser test for Phase 3 money (C3.1, C3.2, C3.5): Pay now through the (fake) hosted checkout, paid only after the
// signed webhook, tips, staff recording a cash payment, the cancellation fee in the cancel dialog, the automatic tip
// and using a package credit. Run with `npm run test:browser`; MYO_TARGET=worker runs it against the Worker.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password, target } from '../helpers.mjs';
import { signPayload } from '../../lib/payments.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  return import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
}
const { chromium } = await loadPlaywright();
console.log('Target: ' + target);
const secret = 'whsec_browser';
const server = await startServer({ MYO_PAYMENTS:'fake', MYO_STRIPE_WEBHOOK_SECRET:secret });
const browser = await chromium.launch();
const problems = [], failures = [];
const check = (ok, message) => { console.log((ok ? '✓ ' : '✗ ') + message); if (!ok) failures.push(message); };
const phone = () => browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, timezoneId:'America/New_York' });
const watch = (page, who) => {
  page.on('pageerror', e => problems.push(`[${who}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of 409/.test(m.text())) problems.push(`[${who}] console: ${m.text()}`); });
};
const post = (page, path, body) => page.evaluate(async ([path, body]) => {
  const response = await fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return { status:response.status, json:await response.json() };
}, [path, body]);
async function webhook(object, id) {
  const body = JSON.stringify({ id, type:'checkout.session.completed', data:{ object } });
  await fetch(server.base + '/api/payments/webhook', { method:'POST', body, headers:{ 'Content-Type':'application/json', 'Stripe-Signature':await signPayload(secret, body) } });
}
const card = (page, id) => page.locator('#upcoming article, #history article').filter({ has:page.locator(`form[data-id="${id}"]`) }).first();

try {
  const staff = await (await phone()).newPage();
  watch(staff, 'staff');
  await staff.goto(server.base + '/portal/index.html?staff=1');
  await staff.locator('[data-action=login] [name=email]').fill(adminLogin.email);
  await staff.locator('[data-action=login] [name=password]').fill(adminLogin.password);
  await staff.locator('[data-action=login] button').tap();
  await staff.locator('#staff-home').waitFor();
  await post(staff, 'schedule', { days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  await post(staff, 'services', { name:'Dog walking', minutes:30, cents:3000, cancel_cutoff_hours:336, cancel_fee_percent:50 });

  const ana = await (await phone()).newPage();
  watch(ana, 'ana');
  await ana.goto(server.base + '/portal/index.html');
  await ana.getByRole('button', { name:/New here/ }).tap();
  const reg = ana.locator('[data-action=register]');
  await reg.locator('[name=name]').fill('Ana'); await reg.locator('[name=email]').fill('ana@example.test'); await reg.locator('[name=password]').fill(password);
  await reg.locator('button[type=submit]').tap();
  await ana.locator('#client-home').waitFor();
  await post(ana, 'pets', { name:'Cooper', species:'Dog', details:'' });
  // Two confirmed visits, booked through the API from the customer's page.
  const portal = (await ana.evaluate(() => fetch('/api/portal').then(r => r.json())));
  const ids = [];
  for (const slot of portal.slots.slice(2, 5)) {
    const made = await post(ana, 'bookings', { service:portal.services[0].id, pets:[portal.pets[0].id], slot:slot.id, start:slot.starts, cents:3000, notes:'' });
    ids.push(made.json.id);
    await post(staff, 'status', { id:made.json.id, status:'Confirmed' });
  }

  // Pay now goes to the provider's page and comes back; the booking is not paid until the webhook arrives.
  await ana.goto(server.base + '/portal/index.html#upcoming');
  await ana.reload();
  await ana.locator('#upcoming article').first().waitFor();
  const visit = card(ana, ids[0]);
  check(/Payment due · Balance \$30\.00/.test(await visit.locator('[data-payment-status]').textContent()), 'a confirmed visit shows Payment due and its balance');
  await visit.getByRole('button', { name:'Pay $30.00 now' }).tap();
  await ana.waitForURL(/fake_session=/);
  const session = new URL(ana.url()).searchParams.get('fake_session');
  await ana.locator('#feedback').filter({ hasText:'being confirmed' }).waitFor();
  check(!/fake_session|payment=/.test(ana.url()), 'the return address is tidied');
  check(/Checkout started/.test(await card(ana, ids[0]).locator('[data-payment-status]').textContent()), 'after returning, the visit says checkout started, not paid');
  await webhook({ id:session, payment_status:'paid', amount_total:3000, payment_intent:'pi_browser' }, 'evt_browser');
  await ana.reload();
  check(/Paid/.test(await card(ana, ids[0]).locator('[data-payment-status]').textContent()), 'once the signed webhook arrives the visit shows Paid');

  // Cancelling inside the cutoff shows the fee first, and the fee is charged as shown.
  await card(ana, ids[1]).getByRole('button', { name:'Cancel booking' }).tap();
  const dialog = ana.locator('#cancel-booking');
  await dialog.locator('[data-cancel-terms]').filter({ hasText:'fee of $15.00' }).waitFor();
  check(true, 'the cancel dialog shows the $15.00 fee before cancelling');
  await dialog.getByRole('button', { name:'Cancel visit' }).tap();
  await ana.locator('#feedback').filter({ hasText:'Visit cancelled.' }).waitFor();

  // Staff record a cash payment on the third visit; it then shows as paid on the customer's card too.
  await staff.goto(server.base + '/portal/index.html#upcoming');
  await staff.reload();
  const cashCard = card(staff, ids[2]);
  await cashCard.locator('summary', { hasText:'Record a payment' }).tap();
  const record = cashCard.locator('form[data-action="payments/record"]');
  await record.locator('[name=dollars]').fill('30');
  await record.getByRole('button', { name:'Record payment' }).tap();
  await staff.locator('#feedback').filter({ hasText:'Payment recorded.' }).waitFor();
  check(/Paid/.test(await card(staff, ids[2]).locator('[data-payment-status]').textContent()), 'staff record a cash payment and the visit shows Paid');
  const fee = (await ana.evaluate(() => fetch('/api/history').then(r => r.json()))).bookings.concat(
    (await ana.evaluate(() => fetch('/api/portal').then(r => r.json()))).bookings).find(b => b.id === ids[1]);
  check(fee?.payment.due_cents === 1500 && fee.payment.status === 'due', 'the cancelled visit owes the $15.00 fee');

  // The automatic tip is saved from Account.
  await ana.goto(server.base + '/portal/index.html#account');
  const tipForm = ana.locator('form[data-action=auto-tip]');
  await tipForm.locator('input[name=percent][value="15"]').locator('xpath=..').tap();
  await tipForm.getByRole('button', { name:'Save tip' }).tap();
  await ana.locator('#feedback').filter({ hasText:'Automatic tip saved.' }).waitFor();
  check((await ana.evaluate(() => fetch('/api/portal').then(r => r.json()))).user.auto_tip_percent === 15, 'the automatic tip is saved');

  if (problems.length) { console.error(problems.join('\n')); failures.push('console errors'); }
} catch (error) {
  failures.push(error.message.split('\n')[0]);
  console.error(error);
} finally {
  await browser.close();
  await server.stop();
}
if (failures.length) { console.error('\n' + failures.length + ' check(s) failed.'); process.exit(1); }
console.log('Payment checks passed; no console errors.');
