import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, adminLogin, password, iso, hours } from '../helpers.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const server = await startServer();
const browser = await chromium.launch();
const errors = [];
const post = async (who, path, body) => {
  const result = await server.call(who, 'POST', '/api/' + path, body);
  assert.equal(result.status, 200, path + ': ' + JSON.stringify(result.json));
  return result.json;
};
async function saved(page) {
  try {
    await page
      .locator('#feedback')
      .filter({ hasText: /Saved\.|Guardado\./ })
      .waitFor({ timeout: 5000 });
  } catch (error) {
    console.log('Save status', await page.locator('[data-care-status],#feedback').allTextContents());
    console.log(
      'Invalid fields',
      await page
        .locator('form[data-care-action] :invalid')
        .evaluateAll((nodes) => nodes.map((node) => [node.name, node.validationMessage, node.value]))
    );
    console.log('Browser errors', errors);
    throw error;
  }
}
async function section(page, id) {
  await page.evaluate((id) => {
    location.hash = id;
  }, id);
  await page.locator(id).waitFor();
}
async function check(page, label) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    label + ' overflow'
  );
  await page.evaluate(axeSource);
  const results = await page.evaluate(() =>
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })
  );
  assert.deepEqual(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact)).map((item) => item.id),
    [],
    label + ' accessibility'
  );
}
try {
  await post('staff', 'login', adminLogin);
  await post('staff', 'services', { name: 'Dog walking', minutes: 30, cents: 3000 });
  await post('staff', 'schedule', {
    days: [0, 1, 2, 3, 4, 5, 6],
    opens: '06:00',
    closes: '22:00',
    buffer: 0,
  });
  await post('staff', 'vaccine-requirements', { species: 'dog', names: ['Rabies'] });
  await post('staff', 'agreements', {
    title: 'Care agreement',
    body_en: 'Read this demo agreement.',
    body_es: 'Lee este acuerdo de demostración.',
  });
  for (const width of [1440, 390]) {
    const who = 'care' + width;
    const account = await post(who, 'register', {
      name: 'Client ' + width,
      email: who + '@example.test',
      password,
    });
    await post(who, 'pets', {
      name: 'Water',
      species: 'Dog',
      details: JSON.stringify({
        profileVersion: 1,
        age: '3 years',
        health: 'No conditions',
        medication: 'None',
      }),
    });
    const data = (await server.call(who, 'GET', '/api/portal')).json;
    const petId = data.pets[0].id;
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      timezoneId: 'America/New_York',
    });
    await context.addCookies(
      [...server.cookies(who)].map(([name, value]) => ({ name, value, url: server.base }))
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(server.base + '/portal/index.html#care');
    await page.locator('#care').waitFor();
    await page.locator('[data-language=es]').click();
    await page.locator('#care').getByText('Lee este acuerdo de demostración.', { exact: true }).waitFor();
    const agreement = page.locator('[data-care-action="agreement/accept"]');
    await agreement.locator('[name=accepted]').check();
    await agreement.locator('button').click();
    await saved(page);
    const intake = page.locator('[data-care-action=intake]');
    await intake.locator('[name=service][value=walk]').check();
    for (const field of await intake.locator('textarea').all()) {
      if (await field.isEnabled()) await field.fill('Sample care details');
    }
    await intake.locator('[name=vetAuthorization]').selectOption('yes');
    await intake.locator('[name=spendingLimit]').fill('100');
    await intake.locator('button').click();
    await saved(page);
    assert.equal((await server.call(who, 'GET', '/api/intake')).json.spendingLimit, 100);
    await page.locator('[data-load-access]').click();
    const access = page.locator('[data-care-action="home-access"]');
    await access.locator('[name=method][value=lockbox]').check();
    await access.locator('[name=instructions]').fill('Secret code 4821');
    await access.locator('button').click();
    await page.locator('[data-access-editor]').filter({ hasText: '' }).waitFor();
    const drafts = await page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith('myo-drafts:'))
        .map(([, value]) => value)
        .join('')
    );
    assert.ok(!drafts.includes('4821'));
    await check(page, 'care ' + width);
    await section(page, '#pets');
    await page
      .locator('.care-vaccines')
      .first()
      .evaluate((node) => (node.open = true));
    const vaccine = page.locator('[data-care-action=vaccines]').first();
    await vaccine.locator('[name=given]').fill('2026-01-01');
    await vaccine.locator('[name=expires]').fill('2030-12-31');
    await vaccine.locator('[name=document]').setInputFiles({
      name: 'record.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    await vaccine.locator('button').click();
    await saved(page);
    const updated = (await server.call(who, 'GET', '/api/portal')).json;
    const record = updated.pets[0].vaccines.find((row) => row.name === 'Rabies');
    assert.equal(record.has_document, true);
    const verification = await post('staff', 'vaccines/verify', { id: record.id });
    await page.reload();
    await page
      .locator('.care-vaccines')
      .first()
      .evaluate((node) => (node.open = true));
    await page.getByText('Verificado por Myomi', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Historial de cuidados', exact: true }).click();
    await page.locator('[data-timeline] article').first().waitFor();
    await check(page, 'history ' + width);

    const starts = Math.ceil((Date.now() + hours(240) + width * 60000) / hours(1)) * hours(1);
    await post('staff', 'slots', { starts: iso(starts), ends: iso(starts + hours(3)) });
    const portal = (await server.call(who, 'GET', '/api/portal')).json;
    const window = portal.windows.find((row) => row.starts === starts);
    const booking = await post(who, 'bookings', {
      service: portal.services[0].id,
      pets: [petId],
      slot: window.id,
      start: starts,
      cents: 3000,
      notes: '',
    });
    await post('staff', 'status', { id: booking.id, status: 'Confirmed' });
    await post('staff', 'status', { id: booking.id, status: 'In Progress' });
    const publishingContext = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
    });
    await publishingContext.addCookies(
      [...server.cookies('staff')].map(([name, value]) => ({ name, value, url: server.base }))
    );
    const publisher = await publishingContext.newPage();
    await publisher.goto(server.base + '/portal/index.html?staff=1#diary');
    const update = publisher.locator('[data-action=events]').first();
    await update.locator('[name=kind][value="Walk completed"]').check();
    await update.locator('[name=report_pee][value=true]').check();
    await update.locator('[name=report_poop][value=false]').check();
    await update.locator('[name=report_minutes]').fill('25');
    await update.locator('[name=notes]').fill('Sitter notes');
    await update.locator('button[type=submit]').click();
    await publisher
      .locator('#feedback')
      .filter({ hasText: /Published/ })
      .waitFor();
    await publishingContext.close();
    await post('staff', 'status', {
      id: booking.id,
      status: 'Completed',
      summary: 'A lovely visit',
      secured: true,
    });
    await section(page, '#diary');
    await page.locator('.diary-visit').waitFor();
    const feedback = page.locator('[data-care-action=feedback]');
    await feedback.locator('xpath=..').evaluate((node) => (node.open = true));
    await feedback.locator('[name=score][value="1"]').check();
    await feedback.locator('[name=comment]').fill('Thank you');
    await feedback.locator('button').click();
    await saved(page);
    assert.equal((await server.call(who, 'GET', '/api/diary')).json.visits[0].feedback.score, 1);
    await check(page, 'diary ' + width);

    const staffContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
    await staffContext.addCookies(
      [...server.cookies('staff')].map(([name, value]) => ({ name, value, url: server.base }))
    );
    const staff = await staffContext.newPage();
    staff.on('pageerror', (error) => errors.push(error.message));
    await staff.goto(server.base + '/portal/index.html#clients');
    await staff.locator('[data-client-list] button[data-client]').first().waitFor();
    await staff.getByRole('button', { name: 'Client ' + width, exact: true }).click();
    await staff.locator('[data-client-record] h3').waitFor();
    const note = staff.locator('[data-care-action="staff-notes"]').last();
    await note.locator('[name=body]').fill('Private note');
    await note.locator('button[type=submit]').click();
    await staff.locator('[data-client-record]').getByText('Private note', { exact: true }).waitFor();
    await check(staff, 'staff clients ' + width);
    await staffContext.close();
    await context.close();
    console.log(
      width + 'px care intake, agreement, vaccines, secure access, history, feedback and staff records passed'
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.stop();
}
