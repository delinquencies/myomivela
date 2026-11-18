import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password } from '../helpers.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  const npmRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(join(npmRoot,'playwright','index.mjs')));
}
const { chromium } = await loadPlaywright();
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const phone = { width:390, height:844 };
const smallPhone = { width:320, height:568 };
const portal = '/portal/index.html';
const failures = [];

const browser = await chromium.launch();
const server = await startServer();
const post = async (who,path,body) => {
  const result = await server.call(who,'POST','/api/'+path,body);
  assert.equal(result.status,200,result.json?.error);
  return result.json;
};
async function openPhone(who) {
  const context = await browser.newContext({
    viewport:phone, isMobile:true, hasTouch:true, timezoneId:'America/New_York', reducedMotion:'reduce',
  });
  if (who) await context.addCookies([...server.cookies(who)].map(([name,value]) => ({ name,value,url:server.base })));
  return context.newPage();
}
async function checkLayout(page, name) {
  const { width } = page.viewportSize();
  const defects = await page.evaluate(() => {
    const defects = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) defects.push(`horizontal overflow (${root.scrollWidth} > ${root.clientWidth})`);
    const controls = document.querySelectorAll(
      'a[href], button, summary, input, select, textarea, [role="button"], [role="link"], [role="tab"]',
    );
    for (const control of controls) {
      if (!control.checkVisibility({ visibilityProperty:true })) continue;
      // Custom radio and checkbox controls are visually hidden inside their large, clickable labels.
      const hitArea = control.matches('.tap-choices input') ? control.closest('label') : control;
      const bounds = hitArea.getBoundingClientRect();
      if (bounds.width >= 24 && bounds.height >= 24) continue;
      const identifier = control.id ? '#'+control.id : control.localName+
        (control.name ? '[name="'+control.name+'"]' : '')+
        (control.classList.length ? '.'+[...control.classList].join('.') : '');
      const label = control.getAttribute('aria-label') || control.textContent.trim();
      defects.push(`${identifier} ${JSON.stringify(label)} is ${Math.round(bounds.width)}×${Math.round(bounds.height)}px`);
    }
    return defects;
  });
  failures.push(...defects.map(defect => `${name} at ${width}px: ${defect}`));
}
async function checkScreen(page, name) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const { violations } = await window.axe.run();
    return violations.filter(rule => ['critical','serious'].includes(rule.impact))
      .map(rule => `${rule.id} (${rule.impact}): ${rule.nodes.map(node => node.target.join(' > ')).join(', ')}`);
  });
  failures.push(...violations.map(violation => `${name}: ${violation}`));
  await checkLayout(page,name);
  await page.setViewportSize(smallPhone);
  await checkLayout(page,name);
  await page.setViewportSize(phone);
  console.log(`Checked ${name}`);
}
async function checkHomeText(page, language, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const problems = await page.evaluate(() => {
    const problems = [];
    const wordmark = document.querySelector('.site-header .wordmark').getBoundingClientRect();
    const booking = document.querySelector('.header-booking').getBoundingClientRect();
    if (wordmark.left < booking.right && wordmark.right > booking.left &&
        wordmark.top < booking.bottom && wordmark.bottom > booking.top) {
      problems.push('the wordmark overlaps the booking link');
    }
    const width = document.documentElement.clientWidth;
    for (const span of document.querySelectorAll('.hero h1 span')) {
      const text = document.createRange();
      text.selectNodeContents(span);
      if ([span.getBoundingClientRect(), ...text.getClientRects()].some(rect => rect.left < 0 || rect.right > width)) {
        problems.push('hero text is clipped: '+span.textContent);
      }
    }
    return problems;
  });
  failures.push(...problems.map(problem => `${language} homepage at 200% and ${viewport.width}px: ${problem}`));
  await checkLayout(page,`${language} homepage at 200%`);
  await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
  await page.setViewportSize(phone);
}
async function openPortalSection(page, hash, ready = '#'+hash+' h2') {
  await page.goto(server.base+portal+'#'+hash);
  await page.locator(ready).waitFor();
}

try {
  const publicPage = await openPhone();
  await publicPage.goto(server.base);
  await checkScreen(publicPage,'English homepage');
  // Language controls are now visible beside the menu on mobile.
  for (const language of ['en', 'es']) {
    const button = publicPage.locator('[data-language="'+language+'"]');
    assert.equal(await button.isVisible(), true);
    const bounds = await button.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Language controls need thumb-sized targets');
  }
  const menu = publicPage.locator('.menu-toggle');
  assert.equal(await menu.getAttribute('aria-label'),'Menu','The icon-only homepage menu needs an accessible name');
  for (const viewport of [phone,smallPhone]) await checkHomeText(publicPage,'English',viewport);
  await menu.tap();
  await publicPage.locator('[data-language="es"]').tap();
  await menu.tap();
  assert.equal(await publicPage.locator('html').getAttribute('lang'),'es');
  assert.equal(await menu.getAttribute('aria-label'),'Menú');
  await checkScreen(publicPage,'Spanish homepage');
  for (const viewport of [phone,smallPhone]) await checkHomeText(publicPage,'Spanish',viewport);

  for (const [name,path,ready] of [
    ['About','/myo/about/','h1'],
    ['FAQ','/myo/safety_first_faq/','h1'],
    ['Sample diary','/myo/client_journal_cute_lively/','h1'],
    ['Signed-out portal',portal,'[data-action="login"]'],
  ]) {
    await publicPage.goto(server.base+path);
    await publicPage.locator(ready).waitFor();
    await checkScreen(publicPage,name);
  }

  await post('staff','login',adminLogin);
  await post('staff','services',{ name:'Dog walking', minutes:30, cents:3000 });
  await post('staff','schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  await post('customer','register',{ name:'Casey', email:'a11y@example.test', password });
  await post('customer','pets',{ name:'Cooper', species:'Dog', details:'' });
  const { services,pets,slots } = (await server.call('customer','GET','/api/portal')).json;
  const visit = await post('customer','bookings',{
    service:services[0].id, pets:[pets[0].id], slot:slots[0].id, start:slots[0].starts, cents:3000, notes:'',
  });
  await post('staff','status',{ id:visit.id, status:'Confirmed' });
  await post('staff','status',{ id:visit.id, status:'In Progress' });

  const customer = await openPhone('customer');
  for (const [name,section] of [
    ['Customer home','client-home'], ['My bookings','upcoming'], ['Pet Diary','diary'], ['Account','account'],
    ['Booking form','book'],
  ]) {
    await openPortalSection(customer,section);
    await checkScreen(customer,name);
  }
  await customer.locator('[name="pets"]').locator('xpath=..').tap();
  await customer.getByRole('button',{ name:'Review booking' }).tap();
  await customer.locator('[data-booking-review] .checkout-card').waitFor();
  await checkScreen(customer,'Booking review');

  const staff = await openPhone('staff');
  for (const [name,section,ready] of [
    ['Staff home','staff-home'], ['Staff Today','upcoming'], ['Staff Publish','diary','#diary [data-action="events"]'],
    ['Staff Settings','settings'],
  ]) {
    await openPortalSection(staff,section,ready);
    await checkScreen(staff,name);
  }
  assert.deepEqual(failures,[],failures.join('\n'));
  console.log('Accessibility and layout checks passed');
} finally {
  await browser.close();
  await server.stop();
}
