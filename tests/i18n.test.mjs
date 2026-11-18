import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogs, t, hasKey, formatDate, formatMoney, locale, setLocale } from '../assets/i18n.js';
import { renderDiaryVisits } from '../assets/diary.js';
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

test('English and Spanish recursively match, including errors, policies and plural forms, without empty values', () => {
  function compare(en, es, path = '') {
    assert.equal(typeof es, typeof en, path);
    if (typeof en === 'string') {
      assert.ok(en.trim(), 'Empty English translation at ' + path);
      assert.ok(es.trim(), 'Empty Spanish translation at ' + path);
      const placeholders = value => (value.match(/\{\w+\}/g) ?? []).sort();
      assert.deepEqual(placeholders(es), placeholders(en), 'Placeholder mismatch at ' + path);
      return;
    }
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), path);
    for (const key of Object.keys(en)) compare(en[key], es[key], path + '.' + key);
  }
  compare(catalogs.en, catalogs.es);
});

test('placeholders, plurals and fallbacks', () => {
  assert.equal(t('booking.nights', { count:1 }, 'en'), '1 night');
  assert.equal(t('booking.nights', { count:3 }, 'es'), '3 noches');
  assert.equal(t('status.Requested', {}, 'es'), 'Esperando a Myomi');
  assert.equal(t('status.Requested', {}, 'fr'), 'Waiting for Myomi', 'an unknown language falls back to English');
  assert.equal(t('no.such.key', {}, 'es'), 'no.such.key');
});

test('language selection updates html, persists, and still switches when storage is blocked', () => {
  const stored = new Map();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{
      getItem:key => stored.get(key),
      setItem:(key,value) => stored.set(key,value),
    }});
    Object.defineProperty(globalThis, 'document', {configurable:true, value:{documentElement:{lang:'en'}}});
    assert.equal(locale(), 'en');
    setLocale('es');
    assert.equal(stored.get('myo-language'), 'es');
    assert.equal(document.documentElement.lang, 'es');
    assert.equal(locale(), 'es');
    Object.defineProperty(globalThis, 'localStorage', {configurable:true, get() { throw new Error('Storage blocked'); }});
    setLocale('en');
    assert.equal(locale(), 'en');
    setLocale('es');
    assert.equal(locale(), 'es');
    assert.equal(document.documentElement.lang, 'es');
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
    setLocale('en');
  }
});

test('Spanish diary translates system labels and preserves owner and sitter content', () => {
  setLocale('es');
  try {
    const html = renderDiaryVisits([{
      id:1, status:'Completed', service_name:'Dog walking', starts:Date.now(), pet_ids:[1],
      summary:'Summary in the sitter’s words.',
    }], new Map([[1,[{
      pet:1, kind:'Feeding', published:Date.now(), notes:'Notes in the sitter’s words.',
      fields:[{type:'choice',label:'Ate',value:'Most'}],
    }]]]), () => 'Water', () => null);
    assert.match(html, /Paseo de Perros/);
    assert.match(html, /Completada/);
    assert.match(html, /Comió: La mayor parte/);
    assert.match(html, /Water/);
    assert.match(html, /Summary in the sitter’s words\./);
    assert.match(html, /Notes in the sitter’s words\./);
  } finally {
    setLocale('en');
  }
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
