// Run with node --no-warnings tests/browser/i18n-smoke.mjs.
// Uses isolated test storage and the same Playwright loading convention as the other browser suites.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password } from '../helpers.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  return import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
}
const {chromium} = await loadPlaywright();
const server = await startServer();
const browser = await chromium.launch();
const errors = [];

async function layout(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, label + ' page overflow');
  const clipped = await page.locator('button, a.button, .tap-link').evaluateAll(nodes =>
    nodes.filter(node => node.getClientRects().length && !node.closest('[inert]') &&
      node.scrollWidth > node.clientWidth + 2).map(node => node.textContent.trim()));
  assert.deepEqual(clipped, [], label + ' clipped controls');
  assert.doesNotMatch(await page.locator('main').innerText(), /\{(?:count|service|price|minutes|aloneMin|aloneMax|current|total)\}|(?:launch|error|status)\.[A-Za-z_]+/);
  const unknown = await page.evaluate(async () => {
    const {hasKey} = await import('/assets/i18n.js');
    return [...document.querySelectorAll('[data-i18n]')]
      .map(node => node.dataset.i18n).filter(key => !hasKey(key));
  });
  assert.deepEqual(unknown, [], label + ' unknown keys');
}
async function change(page, language) {
  await page.locator('[data-language="' + language + '"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), language);
  assert.equal(await page.locator('[data-language="' + language + '"]').getAttribute('aria-pressed'), 'true');
}
async function visitSection(page, hash) {
  await page.evaluate(hash => { location.hash = hash; }, hash);
  await page.locator(hash).waitFor();
}

try {
  await server.call('staff', 'POST', '/api/login', adminLogin);
  for (const [name, cents] of [['Dog walking',3000], ['Drop-in visit',3000], ['Overnight pet sitting',9500], ['Meet & Greet',0]]) {
    assert.equal((await server.call('staff', 'POST', '/api/services', {name, minutes:30, cents})).status, 200);
  }
  assert.equal((await server.call('staff', 'POST', '/api/schedule', {
    days:[0,1,2,3,4,5,6], opens:'06:00', closes:'22:00', buffer:0,
    overnight_days:[0,1,2,3,4,5,6], late_pickup_grace:120,
  })).status, 200);

  for (const viewport of [{width:1440,height:900}, {width:390,height:844}]) {
    const context = await browser.newContext({
      viewport, timezoneId:'America/New_York', isMobile:viewport.width === 390, hasTouch:viewport.width === 390,
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const path of ['/', '/myo/about/', '/myo/safety_first_faq/', '/myo/client_journal_cute_lively/', '/myo/launch/']) {
      await page.goto(server.base + path, {waitUntil:'networkidle'});
      for (const language of ['en', 'es', 'en', 'es']) {
        await change(page, language);
        await page.locator('main details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
        await layout(page, path + ' ' + language);
      }
      const menu = page.locator('.site-menu');
      if (await menu.count()) {
        await menu.evaluate(node => { node.open = true; });
        await layout(page, path + ' Spanish navigation');
        await menu.evaluate(node => { node.open = false; });
      }
    }
    // Intake validation, conditional overnight acknowledgment, and answer preservation.
    await page.locator('#intake-fields-service').selectOption('overnight');
    await page.locator('#intake-form button').click();
    assert.equal(await page.locator('#intake-fields [aria-invalid=true]').count(), 14);
    await page.locator('#intake-fields-pets').fill('Water, dog, 3 years');
    await change(page, 'en');
    assert.equal(await page.locator('#intake-fields-pets').inputValue(), 'Water, dog, 3 years');
    await change(page, 'es');
    assert.equal(await page.locator('#peak-dates li').count(), 11);
    assert.equal(await page.locator('#policy-list details').count(), 16);
    await page.locator('#estimate-fields-date').fill('2027-07-05');
    await page.locator('#estimate-fields-duration').selectOption('60');
    await page.locator('#estimate-form button').click();
    assert.match(await page.locator('#estimate-result').innerText(), /\$64\.00/);

    await page.goto(server.base + '/portal/index.html');
    await page.locator('[data-action=register]').waitFor();
    const registration = page.locator('[data-action=register]');
    await registration.locator('button').click();
    assert.match(await registration.locator('[name=name]').evaluate(node => node.validationMessage), /Completa/);
    await registration.locator('[name=name]').fill('Test Client');
    await registration.locator('[name=email]').fill('bilingual-' + viewport.width + '@example.test');
    await registration.locator('[name=password]').fill(password);
    await change(page, 'en');
    assert.equal(await registration.locator('[name=password]').inputValue(), password);
    await change(page, 'es');
    await registration.locator('button').click();
    await page.locator('#client-home').waitFor();
    await layout(page, 'Spanish client dashboard');
    await page.getByRole('button', {name:'día siguiente'}).click();
    await page.locator('#client-home [data-card-position]').filter({hasText:'Día 2 de 7'}).waitFor();

    await visitSection(page, '#pets');
    const pet = page.locator('form[data-action=pets][data-id=""]');
    await pet.locator('button[type=submit]').click();
    assert.match(await pet.locator('.pet-field-error').first().innerText(), /nombre/);
    await pet.locator('[name=name]').fill('Water');
    await pet.locator('[name=species]').fill('Dog');
    await pet.getByLabel('Ayuda para Especie').click();
    assert.match(await pet.locator('#pet-new-species-tip').innerText(), /perro, gato/);
    await pet.locator('button[type=submit]').click();
    await pet.locator('[name=health]').fill('Care note in the owner’s words');
    await change(page, 'en');
    assert.equal(await pet.locator('[name=health]').inputValue(), 'Care note in the owner’s words');
    assert.match(await pet.locator('[data-pet-step-count]').innerText(), /Step 2 of 5/);
    await change(page, 'es');
    for (let i=0; i<4; i++) await pet.locator('button[type=submit]').click();
    await page.locator('#feedback').filter({hasText:'Guardado.'}).waitFor();
    assert.equal(await page.locator('#pets article h3').innerText(), 'Water');

    await visitSection(page, '#book');
    const booking = page.locator('[data-action=bookings]');
    await booking.locator('[name=service]').first().check();
    await booking.locator('[name=pets]').first().check();
    assert.match(await booking.locator('[name=pets]').first().locator('xpath=..').innerText(), /Water/);
    await booking.locator('[name=slot]').first().check();
    await booking.locator('[name=notes]').fill('Please keep my notes verbatim.');
    await booking.locator('[data-booking-inputs] button[type=submit]').click();
    await booking.locator('[data-booking-review] .checkout-card').waitFor();
    const expires = await booking.locator('[data-booking-review]').getAttribute('data-expires');
    await change(page, 'en');
    assert.equal(await booking.locator('[data-booking-review]').getAttribute('data-expires'), expires);
    assert.equal(await booking.locator('[name=notes]').inputValue(), 'Please keep my notes verbatim.');
    await change(page, 'es');
    await layout(page, 'Spanish booking review');
    assert.equal(await booking.locator('[data-booking-review]').getAttribute('data-expires'), expires);
    await booking.locator('[data-booking-review] button[type=submit]').click();
    await page.locator('#feedback').filter({hasText:/Solicitud enviada/}).waitFor();
    await layout(page, 'Spanish bookings');
    for (const hash of ['#pets', '#diary', '#account']) {
      await visitSection(page, hash);
      await layout(page, 'Spanish ' + hash);
      assert.doesNotMatch(await page.locator(hash).innerText(), /About your pet|Medical requirements|Change password|No updates|Filter diary/);
    }
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    await context.close();
    console.log(viewport.width + '×' + viewport.height + ' bilingual pages and customer flow passed');
  }
  assert.deepEqual(errors, [], 'browser errors');
} finally {
  await browser.close();
  await server.stop();
}
