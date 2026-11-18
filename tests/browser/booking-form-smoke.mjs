import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password } from '../helpers.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  const npmRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(join(npmRoot,'playwright','index.mjs')));
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const server = await startServer();
const post = async (who,path,body) => {
  const result = await server.call(who,'POST','/api/'+path,body);
  assert.equal(result.status,200,result.json?.error);
};
const label = input => input.locator('xpath=..');

try {
  await post('staff','login',adminLogin);
  await post('staff','services',{ name:'Dog walking', minutes:30, cents:3000 });
  await post('customer','register',{ name:'Casey', email:'booking-form@example.test', password });
  await post('customer','pets',{ name:'Cooper', species:'Dog', details:'' });

  const context = await browser.newContext({
    viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, timezoneId:'America/New_York',
  });
  await context.addCookies([...server.cookies('customer')].map(([name,value]) => ({ name,value,url:server.base })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(server.base + '/portal/index.html#book');

  const booking = page.locator('form[data-action="bookings"]');
  const checkAgain = booking.getByRole('button',{ name:'Check again' });
  await checkAgain.waitFor();
  assert.match(await booking.locator('[data-availability-message]').textContent(),/hasn't published times for Dog walking yet/);
  assert.equal(await booking.locator('[name=notes]').isVisible(),false);
  assert.equal(await booking.getByRole('button',{ name:'Review booking' }).isVisible(),false);
  await checkAgain.tap();
  await booking.getByRole('status').filter({ hasText:'Still no times' }).waitFor();

  await post('staff','schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  await page.evaluate(() => { window.bookingFormStillOpen = true; });
  await checkAgain.tap();
  await booking.getByRole('status').filter({ hasText:'Available times updated.' }).waitFor();
  assert.equal(await page.evaluate(() => window.bookingFormStillOpen),true);
  assert.equal(await booking.locator('[name=notes]').isVisible(),true);

  const days = booking.locator('[data-booking-days] label:visible input');
  const earlier = booking.getByRole('button',{ name:'Earlier', exact:true });
  const later = booking.getByRole('button',{ name:'Later dates' });
  assert.equal(await days.count(),7);
  assert.equal(await earlier.isDisabled(),true);
  const firstWeek = await days.evaluateAll(inputs => inputs.map(input => input.value));
  await later.tap();
  assert.equal(await days.count(),7);
  const secondWeek = await days.evaluateAll(inputs => inputs.map(input => input.value));
  assert.ok(secondWeek[0] > firstWeek.at(-1));
  await label(days.first()).tap();
  const chosenDay = await label(days.first()).innerText();
  const chosen = booking.getByRole('group',{ name:'Evening', exact:true }).locator('[name=slot]').last();
  await label(chosen).tap();
  const chosenTime = await label(chosen).innerText();
  const chosenKey = await chosen.inputValue();
  assert.equal(await booking.locator('[data-quote]').textContent(),[chosenDay,chosenTime,'$30.00'].join(' · '));
  const review = booking.getByRole('button',{ name:'Review booking' });
  assert.equal(await review.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  }),true,'Review stays within the viewport after choosing a slot');
  await booking.locator('[name=notes]').fill('Ring twice');

  // Saving an existing pet redraws the portal while a booking draft is open.
  await page.evaluate(() => { location.hash = 'pets'; });
  await page.locator('#pets article').getByText('Edit profile',{ exact:true }).tap();
  const pet = page.locator('#pets article form[data-action=pets]');
  for (let section = 2; section <= 5; section++) {
    await pet.getByRole('button',{ name:'Next section' }).tap();
    await pet.getByText('Section '+section+' of 5',{ exact:true }).waitFor();
  }
  await pet.locator('[name=behavior]').fill('Waits by the door');
  await pet.locator('button[type=submit]').tap();
  await page.locator('#feedback').filter({ hasText:'Saved' }).waitFor();
  await page.evaluate(() => { location.hash = 'book'; });
  await booking.waitFor();
  assert.deepEqual(await days.evaluateAll(inputs => inputs.map(input => input.value)),secondWeek);
  assert.equal(await booking.locator('[name=day]:checked').inputValue(),secondWeek[0]);
  assert.equal(await booking.locator('[name=slot]:checked').inputValue(),chosenKey);
  assert.equal(await booking.locator('[name=notes]').inputValue(),'Ring twice');
  await page.setViewportSize({ width:320, height:568 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Booking form passed at 390px and 320px');
} finally {
  await browser.close();
  await server.stop();
}
