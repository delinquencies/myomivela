import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, adminLogin, password } from './helpers.mjs';

// Staff customer records and private notes (C2.7). Both runtimes.
let app, annId, annPet;
const call = (...args) => app.call(...args);
const ok = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const note = 'Prefers texts; dog is reactive to bikes';

before(async () => {
  app = await startServer();
  await call('staff','POST','/api/login',adminLogin);
  // 21 customers plus Ann: two pages, and well under the sign-in rate limit of 30 requests a minute per address.
  for (let i = 0; i < 21; i++) {
    const name = 'Customer ' + String(i).padStart(2, '0');
    await call('c' + i,'POST','/api/register',{ name, email:'c' + i + '@example.test', password });
  }
  await call('ann','POST','/api/register',{ name:'Ann Lee', email:'ann.lee@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:JSON.stringify({ profileVersion:1, vet:'Main St Vet' }) });
  annId = (await call('ann','GET','/api/session')).json.id;
  annPet = (await call('ann','GET','/api/portal')).json.pets[0].id;
});
after(() => app.stop());

test('customers are listed by name in pages, without staff', async () => {
  const names = [];
  let cursor = '';
  do {
    const page = await ok(call('staff','GET','/api/clients' + (cursor ? '?before=' + cursor : '')));
    names.push(...page.clients.map(c => c.name));
    assert.ok(page.clients.length <= 20);
    cursor = page.next;
  } while (cursor);
  assert.equal(names.length, 22);
  assert.equal(new Set(names).size, 22);
  assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.ok(!names.includes('Myomi'), 'the staff account is not a customer');
  assert.equal((await call('staff','GET','/api/clients?before=abc')).status, 400);
});

test('search matches name or email, and treats % literally', async () => {
  assert.deepEqual((await ok(call('staff','GET','/api/clients?q=ann.lee'))).clients.map(c => c.name), ['Ann Lee']);
  assert.deepEqual((await ok(call('staff','GET','/api/clients?q=lee'))).clients.map(c => c.name), ['Ann Lee']);
  assert.equal((await ok(call('staff','GET','/api/clients?q=%25'))).clients.length, 0, 'a % in the search is not a wildcard');
  const ann = (await ok(call('staff','GET','/api/clients?q=Ann'))).clients[0];
  assert.deepEqual(ann.pets, [{ id:annPet, name:'Rex', species:'Dog' }]);
  assert.equal(ann.upcoming, 0);
  assert.equal(ann.last_visit, null);
});

test('one customer’s record, and private notes on the customer and their pets', async () => {
  const onClient = await ok(call('staff','POST','/api/staff-notes',{ subject_type:'client', subject_id:annId, body:note }));
  const onPet = await ok(call('staff','POST','/api/staff-notes',{ subject_type:'pet', subject_id:annPet, body:'Pulls toward squirrels' }));
  await ok(call('staff','POST','/api/staff-notes',{ id:onPet.id, subject_type:'pet', subject_id:annPet, body:'Pulls toward squirrels; use the harness' }));
  const record = await ok(call('staff','GET','/api/clients/' + annId));
  assert.equal(record.client.email, 'ann.lee@example.test');
  assert.equal(JSON.parse(record.pets[0].details).vet, 'Main St Vet');
  assert.deepEqual(record.pets[0].vaccines, []);
  assert.equal(record.home_access, null);
  assert.deepEqual(record.notes.map(n => n.body).sort(), [note, 'Pulls toward squirrels; use the harness'].sort());
  await ok(call('staff','POST','/api/staff-notes/delete',{ id:onClient.id }));
  assert.equal((await ok(call('staff','GET','/api/clients/' + annId))).notes.length, 1);
  await ok(call('staff','POST','/api/staff-notes',{ subject_type:'client', subject_id:annId, body:note }));
  assert.equal((await call('staff','POST','/api/staff-notes',{ subject_type:'household', subject_id:annId, body:'x' })).json.code, 'invalid_subject');
  assert.equal((await call('staff','POST','/api/staff-notes',{ subject_type:'pet', subject_id:99999, body:'x' })).status, 404);
  assert.equal((await call('staff','GET','/api/clients/99999')).status, 404);
  const staffId = (await call('staff','GET','/api/session')).json.id;
  assert.equal((await call('staff','GET','/api/clients/' + staffId)).status, 404, 'the staff account has no customer record');
});

test('customers can’t reach records or notes, and notes never appear in anything a customer receives', async () => {
  for (const [method, path, body] of [['GET','/api/clients'],['GET','/api/clients/' + annId],['POST','/api/staff-notes',{ subject_type:'client', subject_id:annId, body:'x' }]]) {
    assert.equal((await call('ann', method, path, body)).status, 403, path);
  }
  for (const path of ['/api/portal','/api/diary','/api/session','/api/home-access','/api/history','/api/pets/' + annPet + '/timeline']) {
    const response = await call('ann','GET',path);
    assert.ok(!response.bytes.toString().includes('Prefers texts') && !response.bytes.toString().includes('harness'), path + ' must not contain staff notes');
  }
});
