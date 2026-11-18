import test from 'node:test';
import assert from 'node:assert/strict';
import { isPeakDate, calculateEstimate, myoConfig } from '../assets/myo-config.js';
import { en, es } from '../assets/myo-copy.js';
import {policyText} from '../assets/policy-copy.js';

const periods = [
  ['2026-11-25','2026-11-30'], ['2026-12-30','2027-01-02'], ['2027-01-15','2027-01-18'],
  ['2027-02-12','2027-02-15'], ['2027-03-26','2027-03-29'], ['2027-05-28','2027-05-31'],
  ['2027-06-18','2027-06-20'], ['2027-07-01','2027-07-05'], ['2027-09-03','2027-09-06'],
  ['2027-11-20','2027-11-28'], ['2027-12-23','2028-01-02'],
];
const day = 86_400_000;
const iso = timestamp => new Date(timestamp).toISOString().slice(0, 10);

test('the eleven approved periods contain exactly 58 inclusive peak dates', () => {
  assert.deepEqual(myoConfig.peakPeriods.map(([, start, end]) => [start, end]), periods);
  const expected = new Set();
  for (const [start, end] of periods) {
    for (let d = Date.parse(start); d <= Date.parse(end); d += day) expected.add(iso(d));
    assert.equal(isPeakDate(iso(Date.parse(start) - day)), false);
    assert.equal(isPeakDate(iso(Date.parse(end) + day)), false);
  }
  assert.equal(expected.size, 58);
  for (let d = Date.parse('2026-01-01'); d <= Date.parse('2028-12-31'); d += day) {
    const date = iso(d);
    assert.equal(isPeakDate(date), expected.has(date), date);
  }
  assert.equal(isPeakDate('2027-02-29'), false);
});

const dog = {kind: 'dog'};
const cat = {kind: 'cat'};
const exotic = {kind: 'exotic'};
const regular = '2027-07-06';
const peak = '2027-07-05';
const estimate = (overrides = {}) => calculateEstimate({service: 'walk', date: regular, pets: [dog], ...overrides});

test('walks and drop-ins replace the base on peak dates; extensions are additive', () => {
  for (const service of ['walk', 'dropIn']) {
    for (const [date, price] of [[regular, 3000], [peak, 4400]]) {
      const pets = service === 'walk' ? [dog] : [cat];
      assert.equal(estimate({service, date, pets, duration: 30}).totalCents, price);
      assert.equal(estimate({service, date, pets, duration: 60}).totalCents, price + 2000);
    }
  }
  const puppy = {...dog, ageYears: 0.9};
  assert.equal(estimate({pets: [puppy]}).totalCents, 3900);
  assert.equal(estimate({date: peak, pets: [puppy]}).totalCents, 4400);
  assert.equal(estimate({pets: [{...puppy, ageYears: 1}]}).totalCents, 3000);
});

test('overnight pricing applies only to the peak nights and charges extra pets per night', () => {
  assert.equal(estimate({service: 'overnight'}).totalCents, 9500);
  assert.equal(estimate({service: 'overnight', date: peak}).totalCents, 13900);
  const result = estimate({service: 'overnight', date: peak, nights: 2, pets: [dog, dog, cat], lastMinute: true});
  assert.equal(result.totalCents, 31700);
  assert.deepEqual(result.lines, [
    {code: 'base', cents: 19000}, {code: 'peakNights', cents: 4400},
    {code: 'extraPets', cents: 6800}, {code: 'lastMinute', cents: 1500},
  ]);
});

test('drop-in extras and last-minute charges determine deposit and balance', () => {
  const result = estimate({service: 'dropIn', pets: [cat, dog, cat, exotic], lastMinute: true});
  assert.equal(result.totalCents, 9200);
  assert.equal(result.depositCents, 4600);
  assert.equal(result.balanceCents, 4600);
  assert.equal(estimate({service: 'dropIn', pets: [exotic, exotic]}).totalCents, 4300);
  assert.throws(() => estimate({date: '2027-02-29'}), RangeError);
  assert.throws(() => estimate({pets: [cat]}), RangeError);
});

test('English and Spanish cover the same keys, template values, policies and fields', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  const placeholders = text => (text.match(/\{\w+\}/g) ?? []).sort();
  for (const key of Object.keys(en)) {
    assert.ok(es[key].trim(), key);
    assert.deepEqual(placeholders(en[key]), placeholders(es[key]), key);
  }
  assert.equal(myoConfig.policyKeys.length, 16);
  assert.equal(myoConfig.intakeFields.length, 11);
  for (const key of myoConfig.policyKeys) {
    assert.ok(en[key === 'peak' ? 'peakTitlePolicy' : key + 'Title'], key);
    assert.ok(en[key + 'Body'], key);
  }
  for (const [key] of myoConfig.intakeFields) assert.ok(en[key], key);
  for (const [key] of myoConfig.peakPeriods) assert.ok(en[key], key);
  for(const language of ['en','es']){
    const agreement=policyText(language);
    assert.doesNotMatch(agreement,/\{\w+\}/);
    assert.ok(agreement.includes('$30'));
    assert.ok(agreement.includes('$139'));
    assert.ok(agreement.includes('01108'));
    for(const key of myoConfig.policyKeys)assert.ok(agreement.includes((language==='es'?es:en)[key==='peak'?'peakTitlePolicy':key+'Title']));
  }
});
