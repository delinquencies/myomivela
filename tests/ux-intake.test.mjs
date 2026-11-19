import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password } from './helpers.mjs';
import { myoConfig } from '../assets/myo-config.js';
import { intakeFields, requiredFields, validateIntake, draftPolicy, intakeStatus } from '../assets/intake-model.js';

// CUX-03: the shared intake model, every field error at once, partial saves that only count once complete, and
// blockers that say whether intake is absent or incomplete. Launch pricing mode, both runtimes.
let app, walk, slotStart;
const call = (...args) => app.call(...args);
const full = () => Object.fromEntries(requiredFields('walk').map(key => [key, key === 'spendingLimit' ? 0 : key === 'vetAuthorization' ? 'no' : 'Sample ' + key]));

before(async () => {
  app = await startServer({ MYO_PRICING_MODE:'launch' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/schedule',{ days:[0,1,2,3,4,5,6], opens:'08:00', closes:'18:00', buffer:0 });
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'{"age":"4"}' });
  walk = (await call('ann','GET','/api/catalog')).json[0];
  slotStart = (await call('ann','GET','/api/availability/days?service=' + walk.id)).json;
});
after(() => app.stop());

test('the model inventories every configured field once, with a draft policy for each', () => {
  const keys = intakeFields.map(field => field.key);
  for (const [key] of myoConfig.intakeFields) assert.ok(keys.includes(key), key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(requiredFields('walk').length, 11);
  assert.deepEqual(requiredFields('overnight').slice(-3), ['overnightAlone','overnightBehavior','overnightAcknowledgment']);
  assert.equal(draftPolicy('feeding'), 'session');
  assert.equal(draftPolicy('medication'), 'memory');
  assert.equal(draftPolicy('emergency'), 'memory');
  for (const secret of ['password','instructions','code','token','card']) assert.equal(draftPolicy(secret), 'never', secret);
  assert.deepEqual(validateIntake({ ...full(), service:'walk', spendingLimit:0 }).fieldErrors, [], 'zero is a valid spending limit');
  assert.deepEqual(validateIntake({ ...full(), service:'walk', overnightAcknowledgment:false }).fieldErrors, [], 'an unticked overnight box is fine for a walk');
  assert.deepEqual(validateIntake({ ...full(), service:'overnight', overnightAlone:'4 h', overnightBehavior:'Calm', overnightAcknowledgment:false }).fieldErrors,
    [{ field:'overnightAcknowledgment', code:'acknowledge' }], 'but required for an overnight');
});

test('a full save reports every problem at once, by field', async () => {
  const bad = await call('ann','POST','/api/intake',{ service:'walk', feeding:'x'.repeat(20001), spendingLimit:-5, vetAuthorization:'maybe' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'invalid_field');
  const byField = Object.fromEntries(bad.json.fieldErrors.map(error => [error.field, error]));
  assert.deepEqual(byField.feeding, { field:'feeding', code:'too_long', params:{ max:20000 } });
  assert.equal(byField.spendingLimit.code, 'number_range');
  assert.equal(byField.vetAuthorization.code, 'choose_one');
  for (const key of ['pets','health','medication','behavior','vaccines','vet','emergency','decisionMakers']) assert.equal(byField[key]?.code, 'required', key);
  assert.equal((await call('ann','GET','/api/intake')).json, null, 'nothing is saved after a failed full save');
});

test('without intake, a request is blocked with reason absent', async () => {
  assert.deepEqual(pick((await call('ann','GET','/api/intake/status')).json), { state:'absent', blocking:true });
  const blocker = await intakeBlocker();
  assert.equal(blocker.reason, 'absent');
  assert.ok(blocker.missing.includes('feeding'));
});

test('partial saves merge group by group and count as complete only when everything required is there', async () => {
  const first = await call('ann','POST','/api/intake',{ partial:true, service:'walk', pets:'Rex, 4, dog', feeding:'Two cups', behavior:'Pulls on the lead' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.complete, false);
  assert.equal(first.json.status.state, 'incomplete');
  assert.deepEqual(first.json.status.groups.map(g => [g.id, g.complete]), [['routines', true], ['health', false], ['emergency', false]]);
  assert.equal((await call('ann','GET','/api/intake')).json.complete, false);
  const blocker = await intakeBlocker();
  assert.equal(blocker.reason, 'incomplete');
  assert.ok(blocker.missing.includes('vet') && !blocker.missing.includes('feeding'));
  // A bad value in a partial save is still refused, and the earlier answers stay.
  assert.equal((await call('ann','POST','/api/intake',{ partial:true, spendingLimit:'lots' })).json.fieldErrors[0].code, 'number_range');
  const rest = await call('ann','POST','/api/intake',{ partial:true, health:'None known', medication:'None', vaccines:'Rabies 2026', vet:'Forest Park Vet 413-555-0199',
    emergency:'Sam 413-555-0100', decisionMakers:'Sam', vetAuthorization:'yes', spendingLimit:0 });
  assert.equal(rest.json.complete, true);
  assert.equal(rest.json.status.state, 'complete');
  const saved = (await call('ann','GET','/api/intake')).json;
  assert.deepEqual([saved.feeding, saved.spendingLimit, saved.complete], ['Two cups', 0, true]);
  assert.equal(await intakeBlocker(), undefined, 'a complete intake no longer blocks');
});

test('an overnight needs its own answers; a changed pet makes the intake outdated without blocking', async () => {
  const overnight = (await call('ann','GET','/api/intake/status?service=overnight')).json;
  assert.equal(overnight.state, 'incomplete');
  assert.deepEqual(overnight.missing, ['overnightAlone','overnightBehavior','overnightAcknowledgment']);
  await new Promise(done => setTimeout(done, 5));
  await call('ann','POST','/api/pets',{ name:'Pip', species:'Cat', details:'' });
  const after = (await call('ann','GET','/api/intake/status')).json;
  assert.deepEqual(pick(after), { state:'outdated', blocking:false });
  assert.equal((await call('ann','GET','/api/intake/status?service=boat')).json.code, 'invalid_field');
  assert.equal((await call('staff','GET','/api/intake/status')).status, 403);
});

test('the status helper treats records saved before partial saves as complete', () => {
  const legacy = { ...full(), service:'walk', updated:1 };
  assert.equal(intakeStatus(legacy).state, 'complete');
  assert.equal(intakeStatus({ ...legacy, complete:false }).state, 'incomplete');
  assert.equal(intakeStatus(null).state, 'absent');
});

async function intakeBlocker() {
  const portal = (await call('ann','GET','/api/portal')).json;
  const start = slotStart.days.find(day => day.date === slotStart.default_day).first_start;
  const slot = portal.slots.find(row => row.starts === start);
  const quote = (await call('ann','POST','/api/quote',{ service:walk.id, pets:[portal.pets[0].id], slot:slot.id, start })).json;
  return quote.blockers.find(blocker => blocker.code === 'intake_required');
}
function pick({ state, blocking }) { return { state, blocking }; }
