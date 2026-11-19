import assert from 'node:assert/strict';
import {fillCareIntake} from './intake-steps.mjs';
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
async function checkRepairContrast(page, label) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const { violations } = await window.axe.run(document,{runOnly:['color-contrast']});
    return violations.map(rule => rule.nodes.map(node => node.target.join(' > ')).join(', '));
  });
  assert.deepEqual(violations,[],label+' has a contrast failure');
}
async function checkRepairMenu(page, role) {
  const toggle = page.locator('.portal-menu summary');
  await toggle.click();
  const menu = page.locator('.portal-menu nav');
  assert.equal(await menu.locator('a[href="#care"]:visible').count(),role === 'customer' ? 1 : 0);
  assert.equal(await page.locator('#account-link').isVisible(),role !== 'public');
  const destinations = await menu.locator('a[href^="#"]:visible').evaluateAll(links => links.map(link => link.hash));
  assert.equal(new Set(destinations).size,destinations.length,'Menu destinations must be unique');
  await page.keyboard.press('Escape');
  assert.equal(await toggle.evaluate(element => element === document.activeElement),true);
  for (const destination of destinations) {
    await toggle.click();
    await menu.locator('a[href="'+destination+'"]').click();
    await page.locator(destination).waitFor();
    await page.locator(destination+' > h2:focus').waitFor();
  }
}
async function checkUxRepairs(petId, visitId) {
  const sitter = {name:'Sam',email:'a11y-sitter@example.test',password,role:'sitter'};
  await post('staff','staff',sitter);
  await post('sitter','login',{email:sitter.email,password});
  await post('staff','events',{
    id:visitId,pet:petId,kind:'Walk completed',notes:'A gentle walk.',data:{pee:true,poop:false,minutes:25},
  });
  await post('staff','services',{name:'Overnight pet sitting',minutes:720,cents:9500});
  await post('staff','schedule',{days:[0,1,2,3,4,5,6],opens:'08:00',closes:'18:00',buffer:0,overnight_days:[0,1,2,3,4,5,6]});
  for (const viewport of [{width:1440,height:900},phone]) {
    for (const language of ['en','es']) {
      for (const role of ['public','customer','staff','sitter']) {
        const context = await browser.newContext({
          viewport,isMobile:viewport.width === 390,hasTouch:viewport.width === 390,
          timezoneId:'America/New_York',reducedMotion:'reduce',
        });
        try {
          if (role !== 'public') {
            await context.addCookies([...server.cookies(role)].map(([name,value]) => ({name,value,url:server.base})));
          }
          const page = await context.newPage();
          const problems = [];
          page.on('pageerror',error => problems.push(error.message));
          page.on('console',message => { if (message.type() === 'error') problems.push(message.text()); });
          await page.goto(server.base+portal);
          await page.locator(role === 'public' ? '[data-action=login]' : '#portal-links a').first()
            .waitFor({state:role === 'public' ? 'visible' : 'attached'});
          await page.locator('[data-language="'+language+'"]').click();
          await checkRepairMenu(page,role);
          if (role === 'customer') {
            await page.goto(server.base+portal+'#care');
            await fillCareIntake(page,{notes:'Audit care instructions'});
            await page.locator('.portal-feedback.is-notice #feedback')
              .filter({hasText:language === 'es' ? 'Guardado.' : 'Saved.'}).waitFor();
            // The success notice stays present while the real menu and language control are used.
            await page.locator('.portal-menu summary').click({timeout:5000});
            await page.keyboard.press('Escape');
            const nextLanguage = language === 'es' ? 'en' : 'es';
            await page.locator('[data-language="'+nextLanguage+'"]').click({timeout:5000});
            assert.equal(await page.locator('html').getAttribute('lang'),nextLanguage);
            await page.locator('[data-language="'+language+'"]').click();
            await page.goto(server.base+portal+'?service=pet-sitting#book');
            const dates = page.locator('[data-stay-date]:not([disabled])');
            await dates.first().waitFor();
            await dates.nth(3).click();
            await dates.nth(5).click();
            assert.equal(await page.locator('[data-stay-date][aria-pressed=true]').count(),2);
            await checkRepairContrast(page,'Selected stay dates '+viewport.width+' '+language);
            await page.goto(server.base+portal+'#diary');
            await page.locator('.diary-visit').waitFor();
            assert.equal(await page.locator('.diary-field-hidden').count(),0,'Clients must not see staff-only answers');
          }
          if (['staff','sitter'].includes(role)) {
            await page.goto(server.base+portal+'#diary');
            const hiddenAnswer = page.locator('.diary-field-hidden').first();
            await hiddenAnswer.waitFor();
            assert.match(await hiddenAnswer.textContent(),language === 'es' ? /Oculto para el cliente/ : /Hidden from the client/);
            assert.equal(await hiddenAnswer.evaluate(element => getComputedStyle(element).opacity),'1');
            await checkRepairContrast(page,'Staff-only answers '+viewport.width+' '+language);
          }
          assert.deepEqual(problems,[],role+' browser errors');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),true);
          console.log('DUX-01 '+role+' '+language+' '+viewport.width+'px passed');
        } finally {
          await context.close();
        }
      }
    }
  }
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
  await customer.locator('[data-action=bookings] [name="pets"]').locator('xpath=..').tap();
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
  await checkUxRepairs(pets[0].id,visit.id);
  assert.deepEqual(failures,[],failures.join('\n'));
  console.log('Accessibility and layout checks passed');
} finally {
  await browser.close();
  await server.stop();
}
