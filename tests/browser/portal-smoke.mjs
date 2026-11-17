// End-to-end smoke test of the public pages and the care portal in a real browser.
// Run with `npm run test:browser`. Needs Playwright with Chromium; it is not part of `npm test`.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to a global install */ }
  try { return await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs'))); }
  catch { console.error('Playwright is not installed. Run `npm install --no-save playwright && npx playwright install chromium`.'); process.exit(1); }
}
const { chromium } = await loadPlaywright();
import { startServer, adminLogin, password, target } from '../helpers.mjs';
console.log('Target: ' + target);
import { deflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const server = await startServer();
const problems = [];
const log = (...a) => console.log('•', ...a);
const browser = await chromium.launch();
function watch(page, who) {
  page.on('console', m => { if (['error','warning'].includes(m.type())) problems.push(`[${who} console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[${who} pageerror] ${e.message}`));
  page.on('requestfailed', r => problems.push(`[${who} requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`[${who} HTTP ${r.status()}] ${r.url()}`); });
}
// Phone-sized viewport in the business's time zone.
const ctx = () => browser.newContext({ timezoneId:'America/New_York', viewport:{ width:390, height:844 } });
const feedback = page => page.locator('#feedback');
async function waitSaved(page, text = /Saved|Request sent|Published|Pet added/) {
  await feedback(page).filter({ hasText:text }).waitFor({ timeout:5000 });
}

// Public pages under the CSP
const pub = await (await ctx()).newPage(); watch(pub,'public');
for (const path of ['/', '/myo/safety_first_faq/', '/myo/client_journal_cute_lively/']) {
  await pub.goto(server.base + path, { waitUntil:'networkidle' });
  log('loaded', path, await pub.title());
}

// Staff: service + window
const staff = await (await ctx()).newPage(); watch(staff,'staff');
await staff.goto(server.base + '/portal/index.html?staff=1');
await staff.fill('[name=email]', adminLogin.email);
await staff.fill('[name=password]', adminLogin.password);
await staff.click('button:has-text("Sign in")');
await staff.locator('h1', { hasText:'dashboard' }).waitFor();
await staff.goto(server.base + '/portal/index.html#settings');
await staff.locator('#settings').waitFor();
await staff.locator('[data-action=services] input[value="Dog walking"]').locator('xpath=..').click();
await staff.fill('[data-action=services] [name=minutes]', '30');
await staff.fill('[data-action=services] [name=price]', '25');
await staff.click('[data-action=services] button[type=submit]');
await waitSaved(staff);
const t = new Date(Date.now() + 2*86400e3); // two days out, local NY time
const pad = n => String(n).padStart(2,'0');
const local = h => `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(h)}:00`;
await staff.fill('[data-action=slots] [name=starts]', local(9));
await staff.fill('[data-action=slots] [name=ends]', local(12));
await staff.locator('[data-action=slots] button:has-text("Publish window")').click();
await waitSaved(staff);
log('staff windows listed:', await staff.locator('button:has-text("Remove window")').count());

// Customer: register, pet, book
const cust = await (await ctx()).newPage(); watch(cust,'customer');
await cust.goto(server.base + '/portal/index.html');
const reg = cust.locator('[data-action=register]');
await reg.locator('[name=name]').fill('Casey');
await reg.locator('[name=email]').fill('casey@example.test');
await reg.locator('[name=password]').fill(password);
await reg.locator('button').click();
await cust.locator('h1', { hasText:'My account' }).waitFor();
await cust.goto(server.base + '/portal/index.html#pets');
const add = cust.locator('#pets form[data-id=""]');
await add.locator('[name=name]').fill('Biscuit');
await add.locator('[name=species]').fill('Dog');
await add.locator('[name=vet]').fill('Main St Vet');
await add.locator('button[type=submit]').click();
await waitSaved(cust);
await cust.goto(server.base + '/portal/index.html#book');
const book = cust.locator('[data-action=bookings]');
await book.waitFor();
const times = await book.locator('[data-booking-times] input[name=slot]').count();
log('customer sees', times, 'start times for a 3h window');
if (times !== 6) throw new Error('Expected 6 bookable starts in a 3-hour window, got ' + times);
await book.locator('input[name=pets]').locator('xpath=..').click();
await book.locator('[data-booking-times] input[name=slot]').nth(0).locator('xpath=..').click();
await book.locator('button[type=submit]').click();
await waitSaved(cust);
// Second booking later in same window
await cust.goto(server.base + '/portal/index.html#book');
await book.locator('input[name=pets]').locator('xpath=..').click();
const secondCount = await book.locator('[data-booking-times] input[name=slot]').count();
await book.locator('[data-booking-times] input[name=slot]').nth(3).locator('xpath=..').click();
await book.locator('button[type=submit]').click();
await waitSaved(cust);
log('second booking placed; times offered before it:', secondCount);

// Staff: approve both, reschedule one, start one
await staff.goto(server.base + '/portal/index.html#upcoming');
await staff.reload();
await staff.locator('#upcoming article').first().waitFor();
for (let i = 0; i < 2; i++) {
  await staff.locator('button:has-text("Approve request")').first().click();
  await waitSaved(staff);
}
log('confirmed cards:', await staff.locator('#upcoming h3:has-text("Confirmed")').count());
const resched = staff.locator('#upcoming article').nth(1).locator('details.reschedule-options');
await resched.locator('summary').click();
const options = await resched.locator('input[name=slot]').count();
await resched.locator('input[name=slot]').last().locator('xpath=..').click();
await resched.locator('button:has-text("Confirm new time")').click();
await waitSaved(staff);
log('staff reschedule offered', options, 'options');

// Customer cancels one (dialog)
await cust.reload();
await cust.locator('#upcoming button:has-text("Cancel booking")').first().click();
await cust.locator('#cancel-booking button[value=confirm]').click();
await waitSaved(cust);
log('customer cancelled; statuses:', await cust.locator('#upcoming article h3').allTextContents());

// Start visit — requires starts in the past? no guard; status flow
await staff.reload();
await staff.locator('button:has-text("Start visit")').first().click();
await waitSaved(staff);
// Publish a diary update with a photo
const png = (() => { // 1x1 PNG
  const crc = b => { let c, t = []; for (let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;} let x=0xffffffff; for (const v of b) x=t[(x^v)&255]^(x>>>8); return (x^0xffffffff)>>>0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0]))), chunk('IEND', Buffer.alloc(0))]);
})();
const ev = staff.locator('#diary form[data-action=events]').first();
await ev.waitFor();
await ev.locator('input[name=kind]').first().locator('xpath=..').click();
await ev.locator('[name=notes]').fill('Great walk');
await ev.locator('input[name=photo]').setInputFiles({ name:'p.png', mimeType:'image/png', buffer:png });
await ev.locator('button:has-text("Publish diary update")').click();
await waitSaved(staff);
await staff.goto(server.base + '/portal/index.html#upcoming');
const done = staff.locator('form[data-action=status]:has(input[value=Completed])').first();
await done.locator('[name=summary]').fill('All good');
await done.locator('button').click();
await waitSaved(staff);

// Customer diary
await cust.goto(server.base + '/portal/index.html#diary');
await cust.reload();
const img = cust.locator('#diary-feed img').first();
await img.waitFor();
log('customer diary photo loaded:', await img.evaluate(i => i.complete && i.naturalWidth > 0));
await cust.locator('#refresh-diary').click();
await feedback(cust).filter({ hasText:'up to date' }).waitFor();

// Staff downloads a backup from the settings page.
await staff.goto(server.base + '/portal/index.html#settings');
await staff.reload();
const [download] = await Promise.all([staff.waitForEvent('download'), staff.click('a:has-text("Download backup")')]);
const archive = JSON.parse(gunzipSync(await readFile(await download.path())));
log('backup downloaded:', download.suggestedFilename(), '·', archive.tables.events.length, 'diary updates,', Object.keys(archive.photos).length, 'photo(s)');
if (archive.format !== 'myo-backup' || Object.values(archive.photos).some(photo => !photo)) throw new Error('Backup download is incomplete');

// Paging (Node only, it seeds the database file): older completed visits load through the "Show older" buttons.
if (server.dbPath) {
  const db = new DatabaseSync(server.dbPath);
  const owner = db.prepare("SELECT id FROM users WHERE email='casey@example.test'").get().id;
  const pet = db.prepare('SELECT id FROM pets WHERE owner=?').get(owner).id;
  const service = db.prepare('SELECT id FROM services').get().id;
  for (let i = 1; i <= 25; i++) {
    const starts = Date.now() - i * 86400e3;
    const id = db.prepare("INSERT INTO bookings(owner,service,starts,ends,cents,notes,status,summary) VALUES(?,?,?,?,2500,'','Completed','Old visit')")
      .run(owner, service, starts, starts + 1800e3).lastInsertRowid;
    db.prepare('INSERT INTO booking_pets VALUES(?,?)').run(id, pet);
  }
  db.close();
await cust.goto(server.base + '/portal/index.html#upcoming');
await cust.reload();
const pastCards = () => cust.locator('#upcoming article:has-text("Old visit")').count();
const beforeMore = await pastCards();
await cust.click('#more-history');
await cust.locator('#upcoming article:has-text("Old visit")').nth(beforeMore).waitFor();
log('past visits shown:', beforeMore, '→', await pastCards(), '(older button gone:', !(await cust.locator('#more-history').count()) + ')');
if (await pastCards() !== 25) throw new Error('Expected all 25 seeded visits after loading older bookings');
await cust.goto(server.base + '/portal/index.html#diary');
const diaryVisits = () => cust.locator('#diary-feed article.diary-visit').count();
const firstPage = await diaryVisits();
await cust.click('#more-diary');
await cust.locator('#diary-feed article.diary-visit').nth(firstPage).waitFor();
log('diary visits:', firstPage, '→', await diaryVisits());
if (firstPage !== 10) throw new Error('Expected a first diary page of 10 visits, got ' + firstPage);
}

await browser.close();
await server.stop();
if (problems.length) {
  console.error('\nBrowser problems (' + problems.length + '):\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('\nNo console errors, CSP violations or failed requests.');
