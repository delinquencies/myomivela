import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createIntent, reduce, flowState, serialize, restore, requestKey } from '../assets/booking-flow-state.js';
import { startServer, adminLogin, password } from './helpers.mjs';
import { requiredFields } from '../assets/intake-model.js';

// CUX-02: the booking-intent controller (pure), and a first-time client walked through it against the real server.
const now = Date.parse('2026-12-01T15:00:00Z');
const pick = (intent, changes) => reduce(intent, { type:'select', changes }, now);

test('choosing care moves the flow forward, and a price or time change drops the old quote and hold', () => {
  let intent = createIntent({ service:4, now, id:'abc' });
  assert.deepEqual(flowState(intent, now).nextAction, { code:'choose_care', href:'#book/service' });
  intent = pick(intent, { pets:[7] });
  assert.equal(flowState(intent, now).nextAction.code, 'choose_time');
  intent = pick(intent, { date:'2026-12-04', slot:11, start:now + 3 * 86_400_000 });
  assert.equal(flowState(intent, now).nextAction.code, 'refresh_quote');
  const revision = intent.revision;
  intent = reduce(intent, { type:'quoted', revision, quote:{ total_cents:3000, blockers:[] }, signedIn:true }, now);
  intent = reduce(intent, { type:'held', expires:now + 600_000 }, now);
  assert.deepEqual(flowState(intent, now).nextAction, { code:'send_request', href:'#book/review' });
  intent = pick(intent, { notes:'Side gate' });
  assert.ok(flowState(intent, now).quote, 'notes do not change the price');
  intent = pick(intent, { pets:[7, 8] });
  const state = flowState(intent, now);
  assert.deepEqual([state.quote, state.hold, state.nextAction.code], [null, null, 'refresh_quote']);
});

test('a late quote answer for an earlier choice is ignored', () => {
  let intent = pick(createIntent({ service:4, now }), { pets:[7], start:now + 86_400_000, slot:1 });
  const old = intent.revision;
  intent = pick(intent, { start:now + 2 * 86_400_000 });
  const ignored = reduce(intent, { type:'quoted', revision:old, quote:{ total_cents:9999, blockers:[] }, signedIn:true }, now);
  assert.equal(ignored, intent);
  assert.equal(flowState(ignored, now).quote, null);
});

test('requirements come from the server, in order, with a way back to review', () => {
  let intent = pick(createIntent({ service:4, now }), { pets:[7], start:now + 86_400_000, slot:1 });
  intent = reduce(intent, { type:'quoted', revision:intent.revision, signedIn:true, meetStatus:'scheduled', quote:{ total_cents:3000, blockers:[
    { code:'agreement_required' }, { code:'meet_required', status:'scheduled' }, { code:'vaccine_missing', pet_id:7, vaccine:'Rabies' },
    { code:'vaccine_expired', pet_id:7, vaccine:'DHPP' }, { code:'intake_required', reason:'incomplete', missing:['vet'] },
  ] } }, now);
  const state = flowState(intent, now);
  assert.deepEqual(state.prerequisites.map(item => [item.id, item.status]), [['intake','todo'],['meet','scheduled'],['vaccines','todo'],['agreement','todo']]);
  assert.deepEqual(state.prerequisites[0].detail, { reason:'incomplete', missing:['vet'] });
  assert.equal(state.prerequisites[2].href, '#pet/7');
  assert.ok(state.prerequisites.every(item => item.returnTo === '#book/review'));
  assert.deepEqual([state.currentStep, state.nextAction], ['requirements', { code:'resolve_intake', href:'#book/intake/1' }]);
  const signedOut = reduce(pick(createIntent({ service:4, now }), { pets:[7], start:now + 86_400_000, slot:1 }), { type:'quoted', revision:1, signedIn:false, quote:{ total_cents:3000, blockers:[] } }, now);
  assert.equal(flowState(signedOut, now).nextAction.code, 'resolve_account');
});

test('saved intents restore only for the same account, keep no prices, and expire after a day', () => {
  let intent = pick(createIntent({ service:4, now, id:'keep' }), { pets:[7], primaryPet:7, start:now + 86_400_000, slot:1, notes:'Gate' });
  intent = reduce(intent, { type:'quoted', revision:intent.revision, signedIn:false, quote:{ total_cents:3000, blockers:[] } }, now);
  const text = serialize(intent);
  assert.doesNotMatch(text, /3000|blockers/);
  const back = restore(text, 42, now + 1000);
  assert.deepEqual([back.intentId, back.selection.notes, back.selection.primaryPet, back.quote], ['keep', 'Gate', 7, null], 'a signed-out intent is adopted at sign-in');
  const owned = serialize(reduce(intent, { type:'signed_in', userId:42 }, now));
  assert.equal(restore(owned, 43, now), null, 'never another account’s');
  assert.equal(restore(owned, 42, now + 2 * 86_400_000), null, 'expired');
  assert.equal(restore('{bad', 42, now), null);
  const other = reduce(reduce(intent, { type:'signed_in', userId:42 }, now), { type:'signed_in', userId:43 }, now);
  assert.deepEqual([other.userId, other.selection.pets], [43, []], 'switching account starts a fresh task');
  assert.equal(serialize(reduce(intent, { type:'sent', booking:{ id:9 } }, now)), null);
  assert.equal(requestKey(intent), 'intent-keep-' + intent.revision);
});

let app;
const call = (...args) => app.call(...args);
before(async () => {
  app = await startServer({ MYO_PRICING_MODE:'launch' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  for (const name of ['Dog walking','Meet & Greet']) await call('staff','POST','/api/services',{ name, minutes:30, cents:0 });
});
after(() => app.stop());

test('a first-time client resumes after each requirement and ends at a sent request', async () => {
  const services = (await call('guest','GET','/api/catalog')).json;
  const [walk, meet] = ['visit','meet'].map(kind => services.find(s => s.kind === kind));
  const days = (await call('guest','GET','/api/availability/days?service=' + walk.id)).json;
  const day = days.days.find(d => d.date === days.default_day);
  const time = (await call('guest','GET',`/api/availability/times?service=${walk.id}&date=${day.date}`)).json.times[0];
  // Signed out: choose care and see a price.
  let intent = createIntent({ service:walk.id });
  intent = reduce(intent, { type:'select', changes:{ pets:[-1], date:day.date, slot:time.slot, start:time.start } });
  const guest = (await call('guest','POST','/api/public-quote',{ service:walk.id, pets:[{ kind:'dog', age_years:4 }], start:time.start })).json;
  intent = reduce(intent, { type:'quoted', revision:intent.revision, quote:guest, signedIn:false });
  assert.equal(flowState(intent).nextAction.code, 'resolve_account');
  const saved = serialize(intent);
  // Register, add the pet, and carry the choice over.
  const user = (await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password })).json;
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'{"age":"4"}' });
  const pet = (await call('ann','GET','/api/portal')).json.pets[0].id;
  intent = reduce(restore(saved, user.id), { type:'signed_in', userId:user.id });
  intent = reduce(intent, { type:'select', changes:{ pets:[pet] } });
  const quoteNow = async () => {
    const body = { service:walk.id, pets:intent.selection.pets, slot:intent.selection.slot, start:intent.selection.start };
    const [quote, portal] = [(await call('ann','POST','/api/quote', body)).json, (await call('ann','GET','/api/portal')).json];
    intent = reduce(intent, { type:'quoted', revision:intent.revision, quote, signedIn:true, meetStatus:portal.meet_status });
    return quote;
  };
  await quoteNow();
  assert.deepEqual(flowState(intent).prerequisites.map(p => p.id), ['intake','meet']);
  // Care intake, then the Meet & Greet.
  await call('ann','POST','/api/intake',{ service:'walk', ...Object.fromEntries(requiredFields('walk').map(k => [k, k === 'spendingLimit' ? 0 : k === 'vetAuthorization' ? 'no' : 'Sample'])) });
  intent = reduce(intent, { type:'requirement_done', id:'intake' });
  await quoteNow();
  assert.deepEqual(flowState(intent).prerequisites.map(p => [p.id, p.status]), [['meet','todo']]);
  const meetDays = (await call('ann','GET','/api/availability/days?service=' + meet.id)).json;
  const meetTime = (await call('ann','GET',`/api/availability/times?service=${meet.id}&date=${meetDays.days.find(d => d.open).date}`)).json.times[0];
  const meeting = (await call('ann','POST','/api/bookings',{ service:meet.id, pets:[pet], slot:meetTime.slot, start:meetTime.start, cents:0, notes:'' })).json;
  await quoteNow();
  assert.equal(flowState(intent).prerequisites[0].status, 'scheduled');
  for (const status of ['Confirmed','In Progress']) await call('staff','POST','/api/status',{ id:meeting.id, status });
  await call('staff','POST','/api/status',{ id:meeting.id, status:'Completed', summary:'Hello Rex', secured:true });
  const quote = await quoteNow();
  assert.deepEqual([flowState(intent).nextAction.code, flowState(intent).currentStep], ['review', 'review']);
  // Review: hold, then send with the terms seen.
  const body = { service:walk.id, pets:intent.selection.pets, slot:intent.selection.slot, start:intent.selection.start, cents:quote.total_cents };
  const hold = (await call('ann','POST','/api/checkout-hold', body)).json;
  intent = reduce(intent, { type:'held', expires:hold.expires });
  assert.equal(flowState(intent).nextAction.code, 'send_request');
  const sent = await call('ann','POST','/api/bookings',{ ...body, hold:hold.expires, notes:'', accept_terms_version:quote.terms.version }, { 'Idempotency-Key':requestKey(intent) });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  intent = reduce(intent, { type:'sent', booking:sent.json });
  assert.deepEqual(flowState(intent).nextAction, { code:'view_confirmation', href:'#book/done/' + sent.json.id });
});
