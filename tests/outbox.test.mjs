import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Notification outbox (C3.6): messages are queued with the change, once, in the recipient's language. Both runtimes.
let app, walk, pet, slot, nextStart;
const call = (...args) => app.call(...args);
const messages = async () => (await call('staff','GET','/api/outbox')).json.messages;
async function request() {
  const start = nextStart; nextStart += hours(1);
  const made = await call('ann','POST','/api/bookings',{ service:walk.id, pets:[pet], slot:slot.id, start, cents:3000, notes:'' });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  return made.json.id;
}

before(async () => {
  app = await startServer({ MYO_EMAIL:'log' });
  await call('staff','POST','/api/login',adminLogin);
  await call('staff','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('staff','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(12)) });
  nextStart = starts;
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  walk = data.services[0];
  pet = data.pets[0].id;
  slot = data.windows.find(w => w.starts === starts);
});
after(() => app.stop());

test('a request, its confirmation, start and completion each queue one message for the right person', async () => {
  const id = await request();
  for (const status of ['Confirmed','In Progress']) await call('staff','POST','/api/status',{ id, status });
  await call('staff','POST','/api/status',{ id, status:'Completed', summary:'Good walk', secured:true });
  const queued = (await messages()).reverse();
  assert.deepEqual(queued.map(m => [m.template, m.recipient]), [
    ['request_received','Staff'], ['booking_confirmed','Ann'], ['visit_started','Ann'], ['visit_completed','Ann'],
  ].map(([template, who]) => [template, who === 'Staff' ? queued[0].recipient : who]));
  assert.match(queued[0].subject, /New booking request/);
  assert.match(queued[1].text, /Myomi confirmed Dog walking on .* ET\./);
  assert.ok(queued.every(m => m.status === 'pending'));
  assert.equal((await call('ann','GET','/api/outbox')).status, 403);
});

test('draining sends what is due once; Spanish speakers get Spanish', async () => {
  const first = (await call('staff','POST','/api/outbox/drain',{})).json;
  assert.ok(first.sent >= 4);
  assert.equal(first.waiting, 0);
  assert.equal((await call('staff','POST','/api/outbox/drain',{})).json.sent, 0);
  assert.ok((await messages()).every(m => m.status === 'sent' && m.sent_at));
  await call('ann','POST','/api/locale',{ locale:'es' });
  const id = await request();
  await call('ann','POST','/api/status',{ id, status:'Cancelled' });
  await call('staff','POST','/api/status',{ id:await request(), status:'Cancelled' });
  const latest = await messages();
  assert.equal(latest[0].template, 'booking_cancelled');
  assert.equal(latest[0].language, 'es');
  assert.match(latest[0].subject, /Tu reserva fue cancelada/);
  assert.ok(latest.some(m => m.template === 'customer_cancelled'));
});

test('a change decision is reported to the customer', async () => {
  const id = await request();
  await call('staff','POST','/api/status',{ id, status:'Confirmed' });
  const moved = await call('ann','POST','/api/reschedule',{ id, slot:slot.id, start:nextStart });
  nextStart += hours(1);
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  await call('staff','POST','/api/changes/decide',{ id:moved.json.change.id, decision:'approve' });
  const decided = (await messages()).find(m => m.template === 'change_decided');
  assert.match(decided.subject, /nuevo horario/);
});
