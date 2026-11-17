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
const expected = []; // problems a step causes on purpose (the simulated dropped connection)
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
// Unsaved typing survives other saves. Start a new pet and edit an existing one, half-fill a booking,
// then save the edited pet: the new-pet draft and the whole booking draft (pet, chosen time, notes) must remain.
const section = (page, id) => page.evaluate(id => { location.hash = id; }, id); // hash only, as the portal nav does
await cust.goto(server.base + '/portal/index.html#pets');
await cust.locator('#pets form[data-id=""] [name=name]').fill('Draft pet');
await cust.locator('#pets details:has-text("Edit profile") summary').first().click();
await cust.locator('#pets form[data-action=pets]:not([data-id=""]) [name=behavior]').first().fill('Pulls on the lead');
await section(cust, 'book');
await book.locator('input[name=pets]').locator('xpath=..').click();
const secondCount = await book.locator('[data-booking-times] input[name=slot]').count();
const chosenTime = await book.locator('[data-booking-times] input[name=slot]').nth(3).getAttribute('value');
await book.locator('[data-booking-times] input[name=slot]').nth(3).locator('xpath=..').click();
await book.locator('[name=notes]').fill('Gate code 1234');
await section(cust, 'pets');
await cust.locator('#pets form[data-action=pets]:not([data-id=""]) button[type=submit]').first().click();
await waitSaved(cust);
const keptPet = await cust.locator('#pets form[data-id=""] [name=name]').inputValue();
const savedNote = await cust.locator('#pets form[data-action=pets]:not([data-id=""]) [name=behavior]').first().inputValue();
await section(cust, 'book');
const keptBooking = {
  pet: await book.locator('input[name=pets]').isChecked(),
  time: await book.locator('[data-booking-times] input[name=slot]:checked').getAttribute('value') === chosenTime,
  notes: await book.locator('[name=notes]').inputValue(),
};
log('after saving a pet: new-pet draft', JSON.stringify(keptPet), '· saved edit', JSON.stringify(savedNote), '· booking draft', JSON.stringify(keptBooking));
if (keptPet !== 'Draft pet' || savedNote !== 'Pulls on the lead' || !keptBooking.pet || !keptBooking.time || keptBooking.notes !== 'Gate code 1234') {
  throw new Error('Unsaved form input was lost after another save');
}
await book.locator('button[type=submit]').click();
await waitSaved(cust);
log('second booking placed; times offered before it:', secondCount);
await section(cust, 'pets');
if (await cust.locator('#pets form[data-id=""] [name=name]').inputValue() !== 'Draft pet') throw new Error('New-pet draft lost after booking');
await section(cust, 'book');
if (await book.locator('[name=notes]').inputValue() !== '') throw new Error('The booking form should be empty after it was submitted');
await cust.goto(server.base + '/portal/index.html#upcoming');

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
// A half-written diary note and chosen photo survive saving something else, and the note survives a reload.
await ev.locator('[name=notes]').fill('Half-written note');
await ev.locator('input[name=photo]').setInputFiles({ name:'draft.png', mimeType:'image/png', buffer:png });
// Switch sections by hash: a full navigation is a reload, which cannot keep a chosen file
// (on Cloudflare /portal/index.html redirects to /portal/, so goto() would reload).
await section(staff, 'settings');
await staff.locator('[data-action=services] [name=minutes]').fill('45');
await staff.locator('[data-action=services] [name=price]').fill('32');
await staff.locator('[data-action=services] button[type=submit]').click();
await waitSaved(staff);
await section(staff, 'diary');
const noteAfterSave = await ev.locator('[name=notes]').inputValue();
const photoAfterSave = await ev.locator('[data-photo-status]').textContent();
await staff.reload();
await ev.waitFor();
const noteAfterReload = await ev.locator('[name=notes]').inputValue();
log('diary draft after another save:', JSON.stringify(noteAfterSave), '·', JSON.stringify(photoAfterSave), '· after reload:', JSON.stringify(noteAfterReload));
if (noteAfterSave !== 'Half-written note' || !photoAfterSave.includes('draft.png') || noteAfterReload !== 'Half-written note') throw new Error('Unsaved diary note or photo was lost');
await ev.locator('input[name=kind]').first().locator('xpath=..').click();
await ev.locator('[name=notes]').fill('Great walk');
await ev.locator('input[name=photo]').setInputFiles({ name:'p.png', mimeType:'image/png', buffer:png });
// Simulate a phone losing signal: the first publish reaches the server and is saved, but the answer never
// arrives. The portal must retry on its own with the same Idempotency-Key, and the update must appear once.
let dropped = false;
await staff.route('**/api/events', async route => {
  if (dropped) return route.continue();
  dropped = true;
  await route.fetch();
  await route.abort('connectionreset');
});
await ev.locator('button:has-text("Publish diary update")').click();
await waitSaved(staff);
await staff.unroute('**/api/events');
expected.push(/\/api\/events.*(ERR_CONNECTION_RESET|net::ERR_FAILED)|ERR_CONNECTION_RESET/);
const published = await staff.locator('#diary-feed li:has-text("Great walk")').count();
log('dropped connection on publish → diary shows the update', published, 'time(s)');
if (published !== 1) throw new Error('Expected the retried diary update once, found ' + published);
const noteAfterPublish = await ev.locator('[name=notes]').inputValue();
if (noteAfterPublish !== '') throw new Error('The diary form should be empty after publishing, found ' + JSON.stringify(noteAfterPublish));
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

// Account: change the password from the portal; another browser signed in to the same account is signed out.
const otherBrowser = await (await ctx()).newPage(); watch(otherBrowser,'customer-2');
await otherBrowser.goto(server.base + '/portal/index.html');
await otherBrowser.locator('[data-action=login] [name=email]').fill('casey@example.test');
await otherBrowser.locator('[data-action=login] [name=password]').fill(password);
await otherBrowser.locator('[data-action=login] button').click();
await otherBrowser.locator('h1', { hasText:'My account' }).waitFor();
await cust.reload(); // the device count is part of the page data, so it updates on the next load
await cust.locator('#account-link').click();
await cust.locator('#account').getByText('signed in on 2 devices').waitFor();
await cust.locator('[data-action=password] [name=current]').fill(password);
await cust.locator('[data-action=password] [name=password]').fill('casey-new-password-1');
await cust.locator('[data-action=password] button').click();
await feedback(cust).filter({ hasText:'Password changed' }).waitFor();
const stillSignedIn = await cust.locator('#account').getByText('signed in on 1 device').isVisible();
await otherBrowser.reload();
const otherSignedOut = await otherBrowser.locator('[data-action=login]').first().isVisible();
log('password changed in the portal: this device still signed in', stillSignedIn, '· other browser signed out', otherSignedOut);
if (!stillSignedIn || !otherSignedOut) throw new Error('Password change did not keep this session and end the other');
const passwordStored = await cust.evaluate(() => Object.entries(sessionStorage).some(([key, value]) => key.startsWith('myo-drafts:') && value.includes('casey-new-password')));
if (passwordStored) throw new Error('A password was kept in draft storage');

// Signing out forgets drafts, so nothing typed lingers for the next person on a shared phone.
await cust.goto(server.base + '/portal/index.html#pets');
await cust.locator('#logout').click();
await feedback(cust).filter({ hasText:/^Signed out\.$/ }).waitFor(); // exact: other messages also mention "signed out"
const leftover = await cust.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('myo-drafts:')).length);
await cust.locator('[data-action=login] [name=email]').fill('casey@example.test');
await cust.locator('[data-action=login] [name=password]').fill('casey-new-password-1');
await cust.locator('[data-action=login] button').click();
await cust.locator('h1', { hasText:'My account' }).waitFor();
await cust.goto(server.base + '/portal/index.html#pets');
const afterSignIn = await cust.locator('#pets form[data-id=""] [name=name]').inputValue();
log('after sign-out and back in: stored drafts', leftover, '· new pet form', JSON.stringify(afterSignIn));
if (leftover || afterSignIn) throw new Error('Drafts survived sign-out');

// Sign out everywhere from the Account section ends this session too.
await cust.locator('#account-link').click();
await cust.locator('[data-action="signout-all"] button').click();
await feedback(cust).filter({ hasText:'Signed out on every device' }).waitFor();
log('sign out everywhere: back at sign-in', await cust.locator('[data-action=login]').first().isVisible());

await browser.close();
await server.stop();
const unexpected = problems.filter(problem => !expected.some(pattern => pattern.test(problem)));
if (problems.length !== unexpected.length) log('ignored', problems.length - unexpected.length, 'expected problem(s) from the simulated dropped connection');
problems.splice(0, problems.length, ...unexpected);
if (problems.length) {
  console.error('\nBrowser problems (' + problems.length + '):\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('\nNo console errors, CSP violations or failed requests.');
