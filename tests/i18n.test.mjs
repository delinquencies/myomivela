import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogs, t, hasKey, formatDate, formatMoney } from '../assets/i18n.js';
import { startServer, password } from './helpers.mjs';

// Language plumbing (C2.6): the catalogs, formatting, and each account's saved language.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every error code the server can send has a Spanish message', () => {
  const sources = [join(root, 'lib'), join(root, 'lib', 'routes')].flatMap(dir =>
    readdirSync(dir).filter(name => name.endsWith('.mjs')).map(name => readFileSync(join(dir, name), 'utf8')));
  // requireThat(condition, message, status, 'code' …): a three-digit status followed by a quoted code.
  const codes = new Set(sources.flatMap(source => [...source.matchAll(/\b\d{3},\s*'([a-z_]+)'/g)].map(match => match[1])));
  assert.ok(codes.size >= 20, 'found the codes: ' + [...codes].join(', '));
  const missing = [...codes].filter(code => !hasKey('error.' + code, 'es'));
  assert.deepEqual(missing, [], 'Spanish messages are missing for these codes');
});

test('both catalogs have the same keys outside error messages', () => {
  const keys = language => Object.keys(catalogs[language]).filter(key => !key.startsWith('error.')).sort();
  assert.deepEqual(keys('es'), keys('en'));
});

test('placeholders, plurals and fallbacks', () => {
  assert.equal(t('booking.nights', { count:1 }, 'en'), '1 night');
  assert.equal(t('booking.nights', { count:3 }, 'es'), '3 noches');
  assert.equal(t('status.Requested', {}, 'es'), 'Esperando a Myomi');
  assert.equal(t('status.Requested', {}, 'fr'), 'Waiting for Myomi', 'an unknown language falls back to English');
  assert.equal(t('no.such.key', {}, 'es'), 'no.such.key');
});

test('dates are in Massachusetts time and money in dollars, in either language', () => {
  const noon = Date.parse('2026-11-18T17:00:00Z'); // 12:00 PM in Massachusetts
  assert.equal(formatDate(noon, 'time', 'en'), '12:00 PM');
  assert.match(formatDate(noon, 'day', 'es'), /mi[eé]/i, 'Spanish weekday');
  assert.equal(formatMoney(3050, 'en'), '$30.50');
  assert.match(formatMoney(3050, 'es'), /30[.,]50/);
});

let app;
before(async () => { app = await startServer(); });
after(() => app.stop());

test('each account keeps its language', async () => {
  await app.call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  assert.equal((await app.call('ann','GET','/api/session')).json.locale, 'en');
  assert.equal((await app.call('ann','POST','/api/locale',{ locale:'es' })).status, 200);
  assert.equal((await app.call('ann','GET','/api/session')).json.locale, 'es');
  assert.equal((await app.call('ann','POST','/api/locale',{ locale:'fr' })).json.code, 'invalid_locale');
  await app.call('ann','POST','/api/logout',{});
  await app.call('ann','POST','/api/login',{ email:'ann@example.test', password });
  assert.equal((await app.call('ann','GET','/api/session')).json.locale, 'es', 'kept across sign-in');
});
