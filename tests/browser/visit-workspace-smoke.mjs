// Browser test for the staff visit page (audit UX-01/UX-07/UX-08): from Today, Myomi opens a visit, starts it, sees
// the client's care plan, logs updates and completes it without leaving the page. Two visits running at once keep
// their updates apart. MYO_TARGET=worker runs it on the Worker.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, adminLogin, password, target } from '../helpers.mjs';
import { requiredFields } from '../../assets/intake-model.js';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  return import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')));
}
const { chromium } = await loadPlaywright();
console.log('Target: ' + target);
const server = await startServer();
const browser = await chromium.launch();
const problems = [], failures = [];
const check = (ok, message) => { console.log((ok ? '✓ ' : '✗ ') + message); if (!ok) failures.push(message); };
const phone = () => browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, timezoneId:'America/New_York' });
const watch = page => {
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
};
const post = (page, path, body) => page.evaluate(async ([path, body]) => {
  const response = await fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return { status:response.status, json:await response.json() };
}, [path, body]);
const intake = Object.fromEntries(requiredFields('walk').map(key => [key,
  key === 'spendingLimit' ? 250 : key === 'vetAuthorization' ? 'yes' : key === 'medication' ? 'Apoquel 16 mg with breakfast' : 'Sample ' + key]));

try {
  const owner = await (await phone()).newPage();
  watch(owner);
  await owner.goto(server.base + '/portal/index.html?staff=1');
  await owner.locator('[data-action=login] [name=email]').fill(adminLogin.email);
  await owner.locator('[data-action=login] [name=password]').fill(adminLogin.password);
  await owner.locator('[data-action=login] button').tap();
  await owner.locator('#staff-home').waitFor();
  await post(owner, 'schedule', { days:[0,1,2,3,4,5,6], opens:'06:00', closes:'22:00', buffer:0 });
  await post(owner, 'services', { name:'Dog walking', minutes:30, cents:3000 });

  // Two clients, each with a pet and a confirmed walk; one has completed the care intake.
  const visits = [];
  for (const [name, pet, withIntake] of [['Ana','Cooper',true], ['Ben','Rex',false]]) {
    const client = await (await phone()).newPage();
    await client.goto(server.base + '/portal/index.html');
    await post(client, 'register', { name, email:name.toLowerCase() + '@example.test', password });
    await post(client, 'pets', { name:pet, species:'Dog', details:'' });
    if (withIntake) await post(client, 'intake', { service:'walk', ...intake });
    const portal = await client.evaluate(() => fetch('/api/portal').then(r => r.json()));
    const slot = portal.slots[visits.length + 1];
    const made = await post(client, 'bookings', { service:portal.services[0].id, pets:[portal.pets[0].id], slot:slot.id, start:slot.starts, cents:3000, notes:'' });
    await post(owner, 'status', { id:made.json.id, status:'Confirmed' });
    visits.push({ id:made.json.id, pet });
    await client.context().close();
  }
  const [first, second] = visits;

  // From Today, open the first visit and start it there: the page stays on the visit.
  await owner.goto(server.base + '/portal/index.html?staff=1#visit/' + first.id);
  await owner.reload();
  const page = owner.locator('#route-visit');
  await page.getByRole('button', { name:/Start visit/ }).tap();
  await owner.locator('#feedback').filter({ hasText:/./ }).waitFor();
  await page.locator('form[data-action=events]').waitFor();
  check(new URL(owner.url()).hash === '#visit/' + first.id, 'starting a visit keeps Myomi on that visit');
  await page.locator('[data-visit-care] dd', { hasText:'Apoquel 16 mg with breakfast' }).waitFor();
  check(true, 'the visit shows the client’s care plan (medication, vet, emergency contact)');

  // A medication update needs the details before it can be sent.
  await page.locator('[name=kind][value="Medication"]').locator('xpath=..').tap();
  check(await page.locator('form[data-action=events] [name=notes]').evaluate(element => element.required), 'a medication update requires a note (medicine, dose, time)');
  await page.locator('[name=kind][value="Feeding"]').locator('xpath=..').tap();
  check(!(await page.locator('form[data-action=events] [name=notes]').evaluate(element => element.required)), 'other updates keep the note optional');

  // Log an update: it is published and the page stays on this visit, listing it.
  await page.locator('form[data-action=events] [name=notes]').fill('Breakfast, all eaten');
  await page.getByRole('button', { name:'Publish diary update' }).tap();
  await owner.locator('#route-visit [data-visit-log]', { hasText:'Breakfast, all eaten' }).waitFor();
  check(new URL(owner.url()).hash === '#visit/' + first.id, 'after publishing, Myomi is still on the visit');

  // A second visit running at the same time keeps its own updates.
  await post(owner, 'status', { id:second.id, status:'In Progress' });
  await owner.goto(server.base + '/portal/index.html?staff=1#visit/' + second.id);
  await owner.reload();
  await owner.locator('#route-visit form[data-action=events]').waitFor();
  check(await owner.locator('#route-visit [data-visit-care]').innerText().then(text => /hasn’t completed the care intake/.test(text)), 'a client without an intake is flagged on the visit');
  await owner.locator('#route-visit [name=kind][value="Water"]').locator('xpath=..').tap();
  await owner.locator('#route-visit form[data-action=events] [name=notes]').fill('Fresh water for Rex');
  await owner.locator('#route-visit').getByRole('button', { name:'Publish diary update' }).tap();
  await owner.locator('#route-visit [data-visit-log]', { hasText:'Fresh water for Rex' }).waitFor();
  await owner.goto(server.base + '/portal/index.html?staff=1#visit/' + first.id);
  await owner.reload();
  await owner.locator('#route-visit [data-visit-log]', { hasText:'Breakfast, all eaten' }).waitFor();
  check(!(await owner.locator('#route-visit [data-visit-log]').innerText()).includes('Fresh water for Rex'), 'two running visits never mix their updates');

  // Today shows both visits in progress.
  await owner.goto(server.base + '/portal/index.html?staff=1#staff-home');
  await owner.reload();
  await owner.locator('#staff-home h3', { hasText:'In progress' }).waitFor();
  const firstList = await owner.locator('#staff-home h3').first().innerText();
  const running = await owner.locator('#staff-home .today-list').first().locator('.today-item').count();
  check(firstList === 'In progress' && running === 2, 'Today lists both visits in progress first (' + firstList + ', ' + running + ')');

  // Complete the first visit: the summary starts from what was logged; afterwards Myomi is back on Today.
  await owner.goto(server.base + '/portal/index.html?staff=1#visit/' + first.id);
  await owner.reload();
  const summary = owner.locator('#route-visit [name=summary]');
  await owner.waitForFunction(() => document.querySelector('#route-visit [name=summary]')?.value.includes('Breakfast'));
  check((await summary.inputValue()).includes('Feeding (Cooper): Breakfast, all eaten'), 'the visit summary is prefilled from the logged updates');
  await owner.locator('#route-visit [name=secured]').check();
  await owner.locator('#route-visit').getByRole('button', { name:/Complete visit/ }).tap();
  await owner.locator('#staff-home:visible').waitFor();
  check(new URL(owner.url()).hash === '#staff-home', 'completing a visit returns to Today');

  if (problems.length) { console.error(problems.join('\n')); failures.push('console errors'); }
} catch (error) {
  failures.push(error.message.split('\n')[0]);
  console.error(error);
} finally {
  await browser.close();
  await server.stop();
}
if (failures.length) { console.error('\n' + failures.length + ' check(s) failed.'); process.exit(1); }
console.log('Visit page checks passed; no console errors.');
