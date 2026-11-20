import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer,adminLogin,password} from '../helpers.mjs';

const playwright = await import('playwright').catch(() =>
  import(pathToFileURL(join(execSync('npm root -g').toString().trim(),'playwright','index.mjs'))));
const browser = await playwright.chromium.launch();
// Catalog fixtures isolate routing from the launch meeting/intake requirements.
const server = await startServer();
const problems = [];
const post = async (who,path,body) => {
  const result = await server.call(who,'POST','/api/'+path,body);
  assert.equal(result.status,200,result.json?.error);
  return result.json;
};
async function menuLink(page, selector) {
  await page.locator('.menu-toggle').click();
  await page.locator('.site-nav').locator(selector).click();
}
function watch(page) {
  page.on('pageerror',error => problems.push(error.message));
  page.on('console',message => {if (message.type() === 'error') problems.push(message.text());});
}
async function checkShell(page, language, width) {
  // Link activation can finish before deferred locale modules initialize.
  await page.waitForFunction(value => document.documentElement.lang === value,language);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  assert.equal(await page.locator('html').getAttribute('lang'),language);
  const header = await page.locator('.site-header--sticky').boundingBox();
  assert.equal(Math.round(header.width),width);
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main').evaluate(element => element === document.activeElement),true);
  await page.locator('.menu-toggle').click();
  const destinations = await page.locator('.site-nav a').evaluateAll(links => links.map(link =>
    new URL(link.href).pathname.replace(/index\.html$/,'')+new URL(link.href).search+new URL(link.href).hash));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-toggle').evaluate(element => element === document.activeElement),true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),true);
  return destinations;
}
try {
  await post('staff','login',adminLogin);
  await post('staff','services',{name:'Dog walking',minutes:30,cents:3000});
  await post('staff','schedule',{days:[0,1,2,3,4,5,6],opens:'08:00',closes:'18:00',buffer:0});
  await post('staff','staff',{name:'Sam',email:'nav-sitter@example.test',password,role:'sitter'});
  await post('sitter','login',{email:'nav-sitter@example.test',password});
  const parent = await post('customer','register',{name:'Camila',email:'nav-parent@example.test',password});
  await post('customer','pets',{name:'Coco',species:'Dog',details:''});
  const {services,pets,slots} = (await server.call('customer','GET','/api/portal')).json;
  const visit = await post('customer','bookings',{
    service:services[0].id,pets:[pets[0].id],slot:slots[0].id,start:slots[0].starts,cents:3000,notes:'',
  });
  await post('staff','status',{id:visit.id,status:'Confirmed'});

  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    for (const language of ['en','es']) {
      const context = await browser.newContext({
        viewport,isMobile:viewport.width === 390,hasTouch:viewport.width === 390,reducedMotion:'reduce',
      });
      try {
        const page = await context.newPage();
        watch(page);
        await page.goto(server.base);
        await page.locator('[data-language="'+language+'"]').click();
        const publicLinks = await checkShell(page,language,viewport.width);
        await menuLink(page,'a[href$="myo/about/index.html"]');
        assert.deepEqual(await checkShell(page,language,viewport.width),publicLinks);
        await page.locator('a[href*="client_journal_cute_lively"]').click();
        assert.deepEqual(await checkShell(page,language,viewport.width),publicLinks);
        await menuLink(page,'a[href$="myo/safety_first_faq/index.html"]');
        assert.deepEqual(await checkShell(page,language,viewport.width),publicLinks);
        await menuLink(page,'a[href$="myo/launch/index.html"]');
        assert.deepEqual(await checkShell(page,language,viewport.width),publicLinks);
        await page.locator('.menu-toggle').click();
        assert.equal(await page.locator('.site-nav a[aria-current=page]').count(),1);
        await page.locator('.site-nav a[href$="portal/index.html"]').click();
        await page.locator('[data-action=login]').waitFor();
        await checkShell(page,language,viewport.width);

        // A private destination carries through sign-in and retains its section title.
        await page.goto(server.base+'/portal/index.html#care');
        await page.locator('[data-action=login] [name=email]').fill('nav-parent@example.test');
        await page.locator('[data-action=login] [name=password]').fill(password);
        await page.locator('[data-action=login] button').click();
        await page.locator('#care:visible').waitFor();
        await checkShell(page,language,viewport.width);
        assert.match(await page.title(),language === 'es' ? /Datos de cuidado/ : /Care details/);

        // Use the real menu for history. Invalid and disallowed destinations show recovery views.
        await menuLink(page,'a[href="#upcoming"]');
        await page.locator('#upcoming:visible').waitFor();
        await page.goBack();
        await page.locator('#care:visible').waitFor();
        await page.goForward();
        await page.locator('#upcoming:visible').waitFor();
        // Menus are short (audit UX-05): the diary opens from each pet, filtered to that pet.
        assert.deepEqual(await page.locator('#portal-links a').evaluateAll(links => links.map(link => link.hash)),['#client-home','#upcoming','#pets']);
        await page.goto(server.base+'/portal/index.html#pets');
        await page.locator('#pets [data-diary-pet="'+pets[0].id+'"]').click();
        await page.locator('#diary:visible').waitFor();
        await page.waitForFunction(id => document.querySelector('#diary-filter')?.value === 'pet:'+id, pets[0].id);
        await page.goto(server.base+'/portal/index.html#not-a-route');
        await page.locator('#route-status').waitFor();
        assert.match(await page.locator('#route-status h2').innerText(),language === 'es' ? /No encontramos/ : /couldn’t find/);
        await page.locator('#route-status a').click();
        await page.locator('#client-home:visible').waitFor();
        await page.goto(server.base+'/portal/index.html#settings');
        await page.locator('#route-status').waitFor();
        assert.match(await page.locator('#route-status h2').innerText(),language === 'es' ? /tu cuenta/ : /your account/);

        // Both old identifiers and the new canonical links open the existing screens.
        await page.goto(server.base+'/portal/index.html?service=dog-walking#checkout-'+visit.id);
        await page.locator('.checkout-card:visible').waitFor();
        assert.equal(new URL(page.url()).hash,'#visit/'+visit.id);
        assert.equal(new URL(page.url()).searchParams.get('service'),'dog-walking');
        await page.goto(server.base+'/portal/index.html#pet-'+pets[0].id);
        await page.locator('[data-timeline][data-loaded="1"]').waitFor();
        assert.equal(new URL(page.url()).hash,'#pet/'+pets[0].id);
        await page.goto(server.base+'/portal/index.html#pet-intake');
        await page.locator('#pets:visible').waitFor();
        assert.equal(new URL(page.url()).hash,'#pets/new');
        await page.goto(server.base+'/portal/index.html#visit/99999999');
        await page.locator('#route-status').waitFor();
        assert.equal(await page.locator('.checkout-card:visible').count(),0);
        console.log('Shared shell and customer routes '+language+' '+viewport.width+'px passed');
      } finally {
        await context.close();
      }
    }
  }
  for (const role of ['staff','sitter']) {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    try {
      await context.addCookies([...server.cookies(role)].map(([name,value]) => ({name,value,url:server.base})));
      const page = await context.newPage();
      watch(page);
      await page.goto(server.base+'/portal/index.html#clients');
      await page.locator('[data-client-list] [data-client]').first().waitFor();
      await page.locator('[data-client="'+parent.id+'"]').click();
      await page.locator('[data-client-record] h3').waitFor();
      assert.equal(new URL(page.url()).hash,'#client/'+parent.id);
      await page.reload();
      await page.locator('[data-client-record] h3').waitFor();
      await page.goto(server.base+'/portal/index.html#care');
      await page.locator('#route-status').waitFor();
      if (role === 'sitter') {
        await page.goto(server.base+'/portal/index.html#settings/hours');
        await page.locator('#route-status').waitFor();
      } else {
        await page.goto(server.base+'/portal/index.html#settings/hours');
        await page.locator('#settings:visible').waitFor();
        // Settings is grouped (audit UX-03): a group shows only its own forms, and #settings lists the groups.
        await page.locator('[data-action="schedule"]:visible').waitFor();
        assert.equal(await page.locator('#settings [data-action="services"]:visible, #settings [data-staff-panel]:visible').count(),0,'hours shows only hours');
        assert.equal(await page.locator('#settings h2').innerText(),'Hours & dates');
        const height = await page.locator('#settings').evaluate(element => element.getBoundingClientRect().height);
        assert.ok(height < 3000,'the hours group is a fraction of the old 4,770px page: '+height);
        console.log('settings/hours height at 390px: '+Math.round(height));
        await page.goto(server.base+'/portal/index.html#settings');
        await page.locator('[data-settings-index]:visible').waitFor();
        assert.equal(await page.locator('#settings form:visible').count(),0,'the settings index has no forms');
        await page.locator('[data-settings-index] a[href="#settings/team"]').click();
        await page.locator('[data-staff-panel] .staff-list').waitFor();
        await page.locator('#settings').getByRole('link',{name:'All settings'}).click();
        await page.locator('[data-settings-index]:visible').waitFor();
      }
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(problems,[]);
  console.log('Registry navigation and recovery passed');
} finally {
  await browser.close();
  await server.stop();
}
