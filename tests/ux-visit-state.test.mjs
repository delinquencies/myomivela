import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';
import { allowedActions, timeline, nextSteps, customerSummary, staffWorkQueue, visitReference } from '../assets/visit-state.js';

// CUX-05: visit actions, timeline and next steps (pure), the booking resource and request confirmation (API), the
// client receipt queued once, and stale actions refused with codes. Catalog pricing mode, both runtimes.
const now = Date.parse('2026-12-01T15:00:00Z');
const booking = (status, extra = {}) => ({ id:7, status, starts:now + hours(48), ends:now + hours(48.5), cents:3000, service_kind:'visit', created:now - 1000, ...extra });

test('actions follow role, status and time', () => {
  const context = role => ({ role, now, earlyStartMinutes:30, paymentsEnabled:true });
  assert.deepEqual(allowedActions(booking('Requested'), context('customer')), ['cancel','reschedule']);
  assert.deepEqual(allowedActions(booking('Confirmed', { payment:{ status:'due', balance_cents:3000 } }), context('customer')), ['cancel','request_change','pay']);
  assert.deepEqual(allowedActions(booking('Requested'), context('owner')), ['approve','decline','reschedule']);
  assert.deepEqual(allowedActions(booking('Requested'), context('sitter')), []);
  assert.ok(!allowedActions(booking('Confirmed'), context('sitter')).includes('start'), 'not inside the start window yet');
  const soon = booking('Confirmed', { starts:now + 10 * 60_000, ends:now + 40 * 60_000 });
  assert.deepEqual(allowedActions(soon, context('sitter')), ['start','reveal_access']);
  assert.deepEqual(allowedActions(booking('In Progress'), context('sitter')), ['publish_update','complete','reveal_access']);
  const done = booking('Completed', { departed:now - hours(1), payment:{ status:'paid', balance_cents:0 } });
  assert.deepEqual(allowedActions(done, context('customer')), ['tip','feedback','book_again']);
  assert.deepEqual(allowedActions(done, context('owner')), ['record_payment','refund']);
});

test('the timeline shows where a booking stands, including cancellation', () => {
  const steps = ({ status, ...extra }) => timeline(booking(status, extra)).map(step => [step.step, step.done, step.current]);
  assert.deepEqual(steps({ status:'Requested' }), [['requested',true,true],['confirmed',false,false],['started',false,false],['completed',false,false]]);
  assert.deepEqual(steps({ status:'In Progress', confirmed_at:now, arrived:now }), [['requested',true,false],['confirmed',true,false],['started',true,true],['completed',false,false]]);
  assert.deepEqual(steps({ status:'Cancelled', cancelled_at:now }), [['requested',true,false],['cancelled',true,true]]);
});

test('next steps tell the customer what happens next, without promising a deposit', () => {
  const codes = (b, context) => nextSteps(b, context).map(step => step.code);
  assert.deepEqual(codes(booking('Requested'), { intakeState:'incomplete', paymentsEnabled:false }), ['awaiting_review','complete_intake','payment_arranged','updates_in_diary']);
  assert.deepEqual(codes(booking('Requested'), { intakeState:'complete', paymentsEnabled:true }), ['awaiting_review','pay_after_confirmation','updates_in_diary']);
  assert.deepEqual(codes(booking('Requested', { service_kind:'meet', cents:0 }), {}), ['awaiting_review','book_care_after_meet','updates_in_diary']);
  assert.deepEqual(codes(booking('Cancelled'), {}), []);
  assert.equal(nextSteps(booking('Requested'), {})[0].href, '#visit/7');
  assert.equal(visitReference(7), 'MYO-00007');
});

test('dashboards are built from the same bookings', () => {
  const bookings = [
    booking('In Progress', { id:1, arrived:now - 600_000 }),
    booking('Requested', { id:2, starts:now + hours(30) }),
    booking('Confirmed', { id:3, starts:now + 10 * 60_000, pending_change:{ id:9 } }),
    booking('Completed', { id:4, departed:now - hours(2), payment:{ status:'refund_due', balance_cents:-500 } }),
    booking('Completed', { id:5, departed:now - hours(3), payment:{ status:'due', balance_cents:3000 } }),
  ];
  const owner = staffWorkQueue({ bookings, role:'owner', now });
  assert.deepEqual(owner.workQueue.map(item => [item.type, item.booking]), [['in_progress',1],['start_now',3],['request',2],['change',3],['refund_due',4],['payment_due',5]]);
  assert.deepEqual(staffWorkQueue({ bookings, role:'sitter', now }).workQueue.map(item => item.type), ['in_progress','start_now']);
  const summary = customerSummary({ bookings, events:[{ id:1, booking:1, published:now - 100 }, { id:2, booking:1, published:now - 50 }], now, paymentsEnabled:true, intakeState:'incomplete', meetStatus:'needed' });
  assert.deepEqual(summary.activeCare, [1]);
  assert.equal(summary.nextBooking, 3);
  assert.equal(summary.latestUpdate.id, 2);
  assert.deepEqual(summary.nextActions.map(action => action.code), ['complete_intake','book_meet','feedback','pay','feedback']);
});

let app, request;
const call = (...args) => app.call(...args);
before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(6)) });
  for (const name of ['ann','bob']) await call(name,'POST','/api/register',{ name, email:name + '@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const portal = (await call('ann','GET','/api/portal')).json;
  const slot = portal.windows.find(w => w.starts === starts);
  request = { service:portal.services[0].id, pets:[portal.pets[0].id], slot:slot.id, start:starts, cents:3000, notes:'' };
});
after(() => app.stop());

test('a request returns its reference, stable link, timeline, next steps and receipt delivery', async () => {
  const key = 'request-key-0001-abcdef';
  const made = await call('ann','POST','/api/bookings', request, { 'Idempotency-Key':key });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const { id } = made.json;
  assert.equal(made.json.reference, visitReference(id));
  assert.equal(made.json.href, '#book/done/' + id);
  assert.deepEqual(made.json.next_steps.map(step => step.code), ['awaiting_review','payment_arranged','updates_in_diary']);
  assert.deepEqual(made.json.timeline.map(step => step.step), ['requested','confirmed','started','completed']);
  assert.ok(made.json.timeline[0].at > Date.now() - 60_000, 'the request time is recorded');
  assert.deepEqual(made.json.notifications, { client:'unavailable', staff:'unavailable' }, 'no email provider: recorded, not sent');
  // A replay returns the same answer and queues the receipt once.
  const replay = await call('ann','POST','/api/bookings', request, { 'Idempotency-Key':key });
  assert.equal(replay.json.id, id);
  const receipts = (await call('staff','GET','/api/outbox')).json.messages.filter(m => m.template === 'request_received_client');
  assert.equal(receipts.length, 1);
  assert.match(receipts[0].text, /Myomi has your request/);
});

test('the booking resource is the owner’s and staff’s only, and reloads to the same next steps', async () => {
  const id = (await call('ann','GET','/api/portal')).json.bookings[0].id;
  const mine = await call('ann','GET','/api/bookings/' + id);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.allowed_actions, ['cancel','reschedule']);
  assert.deepEqual(mine.json.next_steps.map(step => step.code), ['awaiting_review','payment_arranged','updates_in_diary']);
  assert.equal(mine.json.booking.id, id);
  assert.equal((await call('ann','GET','/api/bookings/' + id)).json.revision, mine.json.revision, 'nothing changed, same revision');
  assert.equal((await call('bob','GET','/api/bookings/' + id)).status, 404);
  assert.equal((await call('bob','GET','/api/bookings/999999')).status, 404);
  const staffView = (await call('staff','GET','/api/bookings/' + id)).json;
  assert.deepEqual(staffView.allowed_actions, ['approve','decline','reschedule']);
  assert.equal('next_steps' in staffView, false);
  await call('staff','POST','/api/status',{ id, status:'Confirmed' });
  const after = (await call('ann','GET','/api/bookings/' + id)).json;
  assert.notEqual(after.revision, mine.json.revision);
  assert.deepEqual(after.timeline.map(step => [step.step, step.done]).slice(0, 2), [['requested',true],['confirmed',true]]);
});

test('stale actions are refused with a code', async () => {
  const id = (await call('ann','GET','/api/portal')).json.bookings[0].id;
  await call('staff','POST','/api/status',{ id, status:'In Progress' });
  const pet = (await call('staff','GET','/api/bookings/' + id)).json.booking.pet_ids[0];
  await call('staff','POST','/api/status',{ id, status:'Completed', summary:'Good walk', secured:true });
  const again = await call('staff','POST','/api/status',{ id, status:'Completed', summary:'Again', secured:true });
  assert.deepEqual([again.status, again.json.code, again.json.status], [409, 'invalid_transition', 'Completed']);
  const late = await call('staff','POST','/api/events',{ id, pet, kind:'Walk completed', notes:'Late note' });
  assert.deepEqual([late.status, late.json.code], [409, 'visit_not_active']);
});
