// Browser test for booking holds: expiry shown on the review, recovery with fresh times, and holds given back
// when a review is abandoned (reload) or discarded by a redraw. Run with `npm run test:browser`.
// MYO_TARGET=worker runs it against the Cloudflare runtime.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password, target } from '../helpers.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  try { return await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs'))); }
  catch { console.error('Playwright is not installed. Run `npm install --no-save playwright && npx playwright install chromium`.'); process.exit(1); }
}
const { chromium } = await loadPlaywright();
console.log('Target: ' + target);
const server = await startServer({ MYO_EARLY_START_MINUTES:'' }); // the real early-start rule (visit buffer)
const browser = await chromium.launch();
const problems = [];
const failures = [];
const check = (ok, message) => { console.log((ok ? '✓ ' : '✗ ') + message); if (!ok) failures.push(message); };
const phone = () => browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, timezoneId:'America/New_York' });
function watch(page, who, expected = []) {
  page.on('pageerror', e => problems.push(`[${who}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !expected.some(pattern => pattern.test(m.text()))) problems.push(`[${who}] console: ${m.text()}`); });
}
const tapLabel = locator => locator.locator('xpath=..').tap();
// Times the server offers this customer right now, as "window:start" keys.
const serverTimes = page => page.evaluate(() => fetch('/api/portal').then(r => r.json()).then(d => d.slots.map(s => s.id + ':' + s.starts)));

async function customer(name, petName) {
  const ctx = await phone();
  const page = await ctx.newPage();
  // A refused send is an expected 409 in the hold scenarios.
  watch(page, name, [/status of 409/]);
  await page.goto(server.base + '/portal/index.html#book');
  await page.getByRole('button', { name:/New here/ }).tap();
  const reg = page.locator('[data-action=register]');
  await reg.locator('[name=name]').fill(name);
  await reg.locator('[name=email]').fill(name.toLowerCase() + '@example.test');
  await reg.locator('[name=password]').fill(password);
  await reg.locator('button[type=submit]').tap();
  await page.getByRole('link', { name:/Add a pet profile/ }).tap();
  const pet = page.locator('form[data-action=pets][data-id=""]');
  await pet.locator('[name=name]').fill(petName);
  await pet.locator('[name=species]').fill('Dog');
  for (let i = 0; i < 5; i++) await pet.locator('button[type=submit]').tap();
  await page.waitForFunction(() => location.hash === '#book');
  await page.locator('[data-action=bookings]').waitFor();
  return { ctx, page };
}
// Chooses the pet and the n-th time, adds notes, and opens the review. Returns the chosen time key.
async function review(page, n, notes = '') {
  const form = page.locator('[data-action=bookings]');
  await form.locator('[data-booking-inputs]').waitFor();
  if (!(await form.locator('input[name=pets]').first().isChecked())) await tapLabel(form.locator('input[name=pets]').first());
  await tapLabel(form.locator('input[name=slot]').nth(n));
  if (notes) await form.locator('[name=notes]').fill(notes);
  const chosen = await form.locator('input[name=slot]:checked').getAttribute('value');
  await form.locator('[data-booking-inputs] button[type=submit]').tap();
  await form.locator('[data-booking-review] .checkout-card').waitFor();
  return chosen;
}
const offeredInForm = page => page.locator('[data-action=bookings] input[name=slot]').evaluateAll(els => els.map(el => el.value));

try {
  // Staff: weekly hours every day and one price, through the API.
  const staff = await (await phone()).newPage();
  watch(staff, 'staff');
  await staff.goto(server.base + '/portal/index.html?staff=1');
  await staff.locator('[data-action=login] [name=email]').fill(adminLogin.email);
  await staff.locator('[data-action=login] [name=password]').fill(adminLogin.password);
  await staff.locator('[data-action=login] button').tap();
  await staff.locator('#staff-home').waitFor();
  await staff.evaluate(async () => {
    const post = (path, body) => fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    await post('schedule', { days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
    await post('services', { name:'Dog walking', minutes:30, cents:3000 });
  });

  const ana = await customer('Ana', 'Cooper');
  const ben = await customer('Ben', 'Mochi');

  const scenario = async (name, fn) => { try { await fn(); } catch (error) { failures.push(name + ': ' + error.message.split('\n')[0]); console.log('✗ ' + name + ' stopped: ' + error.message.split('\n').slice(0,4).join(' / ')); } };
  // 1. Expiry on the review screen (browser clock fast-forwarded past the hold), then recovery.
  await scenario('expiry', async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    watch(page, 'cara');
    await page.clock.install();
    await page.goto(server.base + '/portal/index.html');
    await page.getByRole('button', { name:/New here/ }).tap();
    const reg = page.locator('[data-action=register]');
    await reg.locator('[name=name]').fill('Cara'); await reg.locator('[name=email]').fill('cara@example.test'); await reg.locator('[name=password]').fill(password);
    await reg.locator('button[type=submit]').tap();
    await page.evaluate(() => { location.hash = 'pet-intake'; });
    const pet = page.locator('form[data-action=pets][data-id=""]');
    await pet.locator('[name=name]').fill('Pip'); await pet.locator('[name=species]').fill('Dog');
    for (let i = 0; i < 5; i++) await pet.locator('button[type=submit]').tap();
    await page.waitForFunction(() => location.hash === '#book');
    await review(page, 4, 'Back door code 4321');
    const review_ = page.locator('[data-booking-review]');
    check(/Time held until/.test(await review_.locator('.checkout-payment-note').textContent()), 'review shows how long the time is held');
    await page.clock.fastForward('10:30');
    await page.waitForTimeout(200);
    check(/Hold ended/.test(await review_.locator('.checkout-status').textContent()), 'after the hold runs out, the review says "Hold ended"');
    check(/hold on this time has ended/.test(await review_.locator('.checkout-payment-note').textContent()), 'the note explains the hold ended');
    check(await review_.getByRole('button', { name:/Send booking request/ }).isDisabled(), 'Send is disabled once the hold has ended');
    await review_.getByRole('button', { name:'Choose another time' }).tap();
    const form = page.locator('[data-action=bookings]');
    await form.locator('[data-booking-error]').filter({ hasText:/up to date/ }).waitFor();
    const day = await form.locator('input[name=day]:checked').getAttribute('value');
    const shown = await offeredInForm(page);
    const fresh = (await serverTimes(page)).filter(key => new Intl.DateTimeFormat('en-CA',{ timeZone:'America/New_York' }).format(Number(key.split(':')[1])) === day);
    check(shown.length > 0 && JSON.stringify(shown) === JSON.stringify(fresh), 'Choose another time reopens the form with the server’s current times');
    check(await form.locator('input[name=pets]').first().isChecked() && await form.locator('[name=notes]').inputValue() === 'Back door code 4321', 'the pet and notes are kept');
    check(await page.evaluate(() => document.activeElement?.matches('[data-booking-error]')), 'focus moves to the message');
    await ctx.close();
  });

  // 2. A refused send (another tab replaced the hold) reopens the form with fresh times, and the retry succeeds.
  await scenario('refused send', async () => {
    await ana.page.goto(server.base + '/portal/index.html?fresh=' + Date.now() + '#book'); // a real reload: each scenario starts fresh
    await review(ana.page, 3, 'Ring twice');
    const tab2 = await ana.ctx.newPage();
    watch(tab2, 'ana-tab2');
    await tab2.goto(server.base + '/portal/index.html#book');
    await tab2.locator('[data-action=bookings]').waitFor();
    await review(tab2, 6);
    await tab2.close(); // closing the tab gives its hold back too
    await ana.page.getByRole('button', { name:/Send booking request/ }).tap();
    const form = ana.page.locator('[data-action=bookings]');
    const notice = form.locator('[data-booking-error]');
    await notice.filter({ hasText:/up to date/ }).waitFor();
    check(/hold expired or the visit changed/i.test(await notice.textContent()), 'a refused send explains why, inside the booking form');
    check(await form.locator('[data-booking-inputs]').isVisible() && !(await form.locator('[data-booking-review]').isVisible()), 'the form reopens instead of leaving the stale review');
    check(await form.locator('[name=notes]').inputValue() === 'Ring twice', 'notes survive the recovery');
    await review(ana.page, 3);
    await ana.page.getByRole('button', { name:/Send booking request/ }).tap();
    // The confirmation appears after the portal reloads its data, slightly after the address changes.
    const sent = await ana.page.waitForFunction(() => /Request sent/.test(document.querySelector('#feedback').textContent), null, { timeout:10_000 }).then(() => true, () => false);
    check(sent && await ana.page.evaluate(() => location.hash === '#upcoming'), 'reviewing again and sending succeeds');
  });

  // 3. Abandoning a review by reloading gives the time back straight away.
  await scenario('abandoned review', async () => {
    await ana.page.goto(server.base + '/portal/index.html?fresh=' + Date.now() + '#book'); // a real reload: each scenario starts fresh
    const held = await review(ana.page, 8);
    check(!(await serverTimes(ben.page)).includes(held), 'while Ana reviews, Ben is not offered her time');
    await ana.page.reload();
    await ana.page.locator('#app > section:not([hidden])').waitFor();
    await ben.page.waitForTimeout(300);
    check((await serverTimes(ben.page)).includes(held), 'after Ana reloads away from the review, Ben is offered the time at once');
  });

  // 4. A redraw that discards an open review (saving something in another section) gives the time back.
  await scenario('redraw', async () => {
    await ana.page.goto(server.base + '/portal/index.html?fresh=' + Date.now() + '#book'); // a real reload: each scenario starts fresh
    const held = await review(ana.page, 10);
    check(!(await serverTimes(ben.page)).includes(held), 'held again for the redraw check');
    await ana.page.evaluate(() => { location.hash = 'pets'; });
    await ana.page.locator('#pets summary', { hasText:'Edit profile' }).first().tap();
    const editor = ana.page.locator('#pets form[data-action=pets]:not([data-id=""])').first();
    await editor.locator('[name=behavior]').fill('Loves the park');
    await editor.getByRole('button', { name:/Save changes/ }).tap();
    await ana.page.waitForFunction(() => /Saved/.test(document.querySelector('#feedback').textContent));
    await ben.page.waitForTimeout(300);
    check((await serverTimes(ben.page)).includes(held), 'a redraw that discards the review gives the time back');
  });
  // 5. Staff can't start a visit until 30 minutes (the visit buffer) before it; the button opens on its own.
  await scenario('early start', async () => {
    // Ana books the last offered time (days ahead); staff confirm it.
    const id = await ana.page.evaluate(async () => {
      const data = await fetch('/api/portal').then(r => r.json());
      const slot = data.slots.at(-1);
      const response = await fetch('/api/bookings', { method:'POST', headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ service:data.services[0].id, cents:data.services[0].cents, pets:[data.pets[0].id], slot:slot.id, start:slot.starts, notes:'' }) });
      return (await response.json()).id;
    });
    await staff.evaluate(id => fetch('/api/status', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id, status:'Confirmed' }) }), id);
    const ctx = await phone();
    const page = await ctx.newPage();
    watch(page, 'staff-clock', [/status of 409/]);
    await page.clock.install();
    await page.goto(server.base + '/portal/index.html?staff=1');
    await page.locator('[data-action=login] [name=email]').fill(adminLogin.email);
    await page.locator('[data-action=login] [name=password]').fill(adminLogin.password);
    await page.locator('[data-action=login] button').tap();
    await page.locator('#staff-home').waitFor();
    await page.evaluate(() => { location.hash = 'upcoming'; });
    const card = page.locator('#upcoming article').filter({ has:page.locator(`form[data-id="${id}"]`) }).first();
    const button = card.getByRole('button', { name:'Start visit' });
    check(await button.isDisabled(), 'Start visit is disabled for a visit that is days away');
    check(/You can start this visit from .+ ET/.test(await card.locator('.start-note').textContent()), 'the card says when the visit can start');
    const opensAt = Number(await button.getAttribute('data-start-after'));
    // Jump the page clock just past the opening time (fastForward refuses jumps of weeks), then let the 15-second check run.
    await page.clock.setSystemTime(opensAt + 1_000);
    await page.clock.runFor(16_000);
    check(await button.isEnabled() && /now/.test(await card.locator('.start-note').textContent()), 'the button enables itself when that time comes');
    // The page clock was moved, the server's was not: the server still refuses, so the rule doesn't depend on the device.
    await button.tap();
    await page.waitForFunction(() => /can start from/.test(document.querySelector('#feedback').textContent));
    check(true, 'the server refuses an early start even when the device clock is ahead');
    await ctx.close();
  });
  // 6. Two pets: the total includes the extra-pet price, ticking a pet keeps the chosen time, and the request goes through.
  await scenario('extra pet', async () => {
    await staff.evaluate(() => fetch('/api/services', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ name:'Dog walking', minutes:30, cents:3000, extra_pet_cents:1500 }) }));
    await ben.page.evaluate(() => fetch('/api/pets', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ name:'Bean', species:'Dog', details:'' }) }));
    await ben.page.goto(server.base + '/portal/index.html?fresh=' + Date.now() + '#book');
    const form = ben.page.locator('[data-action=bookings]');
    await form.waitFor();
    await tapLabel(form.locator('input[name=pets]').nth(0));
    await tapLabel(form.locator('input[name=slot]').nth(2));
    const chosen = await form.locator('input[name=slot]:checked').getAttribute('value');
    await tapLabel(form.locator('input[name=pets]').nth(1));
    check(await form.locator('input[name=slot]:checked').getAttribute('value') === chosen, 'ticking a second pet keeps the chosen time');
    check(/\$45\.00/.test(await form.locator('[data-quote]').textContent()), 'the total shows $45.00 for two pets');
    await form.locator('[data-booking-inputs] button[type=submit]').tap();
    await form.locator('[data-booking-review] .checkout-card').waitFor();
    check(/\$45\.00/.test(await form.locator('.checkout-total').textContent()), 'the review shows the server’s $45.00 total');
    await ben.page.getByRole('button', { name:/Send booking request/ }).tap();
    const sent = await ben.page.waitForFunction(() => /Request sent/.test(document.querySelector('#feedback').textContent), null, { timeout:10_000 }).then(() => true, () => false);
    check(sent, 'the two-pet request is accepted at that price');
  });
} catch (error) {
  failures.push('unexpected: ' + error.message.split('\n')[0]);
  console.error(error);
} finally {
  await browser.close();
  await server.stop();
}
if (problems.length) console.error('\nBrowser problems:\n' + problems.join('\n'));
if (failures.length || problems.length) { console.error(`\n${failures.length} check(s) failed.`); process.exitCode = 1; }
else console.log('\nAll hold checks passed; no console errors.');
