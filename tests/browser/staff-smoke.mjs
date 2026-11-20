// Browser test for staff roles: the owner adds a sitter from Settings; the sitter signs in and sees visits and
// publishing but not Settings, Financials, approvals or money forms. MYO_TARGET=worker runs it on the Worker.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startServer, adminLogin, password, target } from '../helpers.mjs';

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
const watch = (page, who, expected = []) => {
  page.on('pageerror', e => problems.push(`[${who}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !expected.some(pattern => pattern.test(m.text()))) problems.push(`[${who}] console: ${m.text()}`); });
};
const post = (page, path, body) => page.evaluate(async ([path, body]) => {
  const response = await fetch('/api/' + path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return { status:response.status, json:await response.json() };
}, [path, body]);
async function signIn(page, login) {
  await page.goto(server.base + '/portal/index.html?staff=1');
  await page.locator('[data-action=login] [name=email]').fill(login.email);
  await page.locator('[data-action=login] [name=password]').fill(login.password);
  await page.locator('[data-action=login] button').tap();
  await page.locator('#staff-home').waitFor();
}
const sitter = { email:'sam@example.test', password:'sitter-pass-123456' };

try {
  const owner = await (await phone()).newPage();
  watch(owner, 'owner', [/status of 40[13]/]); // the step-up check refuses once and a wrong password is refused
  await signIn(owner, adminLogin);
  await post(owner, 'schedule', { days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  await post(owner, 'services', { name:'Dog walking', minutes:30, cents:3000 });

  // A customer request, through the API from a customer page.
  const ana = await (await phone()).newPage();
  watch(ana, 'ana');
  await ana.goto(server.base + '/portal/index.html');
  await post(ana, 'register', { name:'Ana', email:'ana@example.test', password });
  await post(ana, 'pets', { name:'Cooper', species:'Dog', details:'' });
  const portal = await ana.evaluate(() => fetch('/api/portal').then(r => r.json()));
  const slot = portal.slots[2];
  const request = await post(ana, 'bookings', { service:portal.services[0].id, pets:[portal.pets[0].id], slot:slot.id, start:slot.starts, cents:3000, notes:'' });

  // The owner adds Sam as a sitter in Settings.
  await owner.goto(server.base + '/portal/index.html?staff=1#settings/team');
  await owner.reload();
  const add = owner.locator('form[data-action=staff]');
  await add.waitFor();
  await add.locator('[name=name]').fill('Sam');
  await add.locator('[name=email]').fill(sitter.email);
  await add.locator('[name=password]').fill(sitter.password);
  await add.getByRole('button', { name:'Add staff member' }).tap();
  await owner.locator('#feedback').filter({ hasText:'Staff accounts saved.' }).waitFor();
  await owner.reload();
  await owner.locator('.staff-list li', { hasText:'Sam' }).waitFor();
  check(/Sitter/.test(await owner.locator('.staff-list li', { hasText:'Sam' }).textContent()), 'the owner adds Sam as a sitter from Settings');

  // Sam signs in: visits and publishing, but no Settings, Financials, approvals or money.
  const sam = await (await phone()).newPage();
  watch(sam, 'sam', [/status of 401/]); // the last check expects the switched-off sitter to be refused
  await signIn(sam, sitter);
  const nav = await sam.locator('#portal-links a, nav a').allTextContents();
  check(nav.some(label => /Publish updates/.test(label)) && !nav.some(label => /Services|Financials/.test(label)), 'the sitter’s menu has Publish updates but no Settings or Financials');
  check(await sam.locator('#settings, #financials').count() === 0, 'the Settings and Financials sections are not rendered for a sitter');
  await sam.goto(server.base + '/portal/index.html?staff=1#upcoming');
  await sam.reload();
  await sam.locator('#upcoming article').first().waitFor();
  check(await sam.getByRole('button', { name:'Approve request' }).count() === 0, 'a sitter is not offered Approve request');
  await post(owner, 'status', { id:request.json.id, status:'Confirmed' });
  await sam.reload();
  await sam.locator('#upcoming article').first().waitFor();
  check(await sam.getByRole('button', { name:'Cancel booking' }).count() === 0, 'a sitter is not offered Cancel booking');
  check(await sam.locator('summary', { hasText:'Record a payment' }).count() === 0, 'a sitter is not offered payment forms');
  check(await sam.getByRole('button', { name:/Start visit/ }).count() === 1, 'a sitter can start the visit');

  // Switching Sam off signs them out. On Node, the owner's password check is first made 16 minutes old, so the
  // portal asks for the password again (step-up) before the change goes through.
  await owner.reload();
  await owner.locator('.staff-list li', { hasText:'Sam' }).waitFor(); // let the panel finish loading before the database is touched
  if (target === 'node') {
    const db = new DatabaseSync(server.dbPath);
    db.prepare('UPDATE sessions SET verified=?').run(Date.now() - 16 * 60_000);
    db.close();
  }
  await owner.locator('.staff-list li', { hasText:'Sam' }).getByRole('button', { name:'Switch off' }).tap();
  if (target === 'node') {
    const dialog = owner.locator('#reauth');
    await dialog.waitFor();
    check(await dialog.evaluate(element => element.open), 'an old password check makes the portal ask for the password again');
    await dialog.locator('[name=password]').fill('not-the-password-1');
    await dialog.getByRole('button', { name:'Continue' }).tap();
    await dialog.locator('[data-reauth-error]').filter({ hasText:'incorrect' }).waitFor();
    check(true, 'a wrong password is refused inside the dialog');
    await dialog.locator('[name=password]').fill(adminLogin.password);
    await dialog.getByRole('button', { name:'Continue' }).tap();
  }
  await owner.locator('#feedback').filter({ hasText:'Staff accounts saved.' }).waitFor();
  check((await sam.evaluate(() => fetch('/api/portal').then(r => r.status))) === 401, 'switching the sitter off ends their session');

  if (problems.length) { console.error(problems.join('\n')); failures.push('console errors'); }
} catch (error) {
  failures.push(error.message.split('\n')[0]);
  console.error(error);
} finally {
  await browser.close();
  await server.stop();
}
if (failures.length) { console.error('\n' + failures.length + ' check(s) failed.'); process.exit(1); }
console.log('Staff role checks passed; no console errors.');
