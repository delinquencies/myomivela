import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, adminLogin, password, iso, hours } from './helpers.mjs';

// Staff accounts and roles: the owner adds a sitter, who can run visits but not change prices, settings, money or
// accounts; accounts can be switched off and given a new password. Both runtimes.
let app, routes, dir, booking;
const call = (...args) => app.call(...args);
const sitter = { email:'sam@example.test', password:'sitter-pass-123456' };
const concrete = route => route.path instanceof RegExp ? route.path.source.replace(/\\\//g,'/').replace('(\\d+)','1').replace('([\\w.-]+)','name').replace(/^\^|\$$/g,'') : route.path;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'myo-staff-'));
  process.env.MYO_DB = join(dir, 'import-only.sqlite');
  ({ routes } = await import('../lib/api.mjs'));
  app = await startServer();
  await call('owner','POST','/api/login',adminLogin);
  await call('owner','POST','/api/services',{ name:'Dog walking', minutes:30, cents:3000 });
  const starts = Math.ceil((Date.now() + hours(72)) / hours(1)) * hours(1);
  await call('owner','POST','/api/slots',{ starts:iso(starts), ends:iso(starts + hours(6)) });
  await call('ann','POST','/api/register',{ name:'Ann', email:'ann@example.test', password });
  await call('ann','POST','/api/pets',{ name:'Rex', species:'Dog', details:'' });
  const data = (await call('ann','GET','/api/portal')).json;
  const slot = data.windows.find(w => w.starts === starts);
  booking = (await call('ann','POST','/api/bookings',{ service:data.services[0].id, pets:[data.pets[0].id], slot:slot.id, start:starts, cents:3000, notes:'' })).json.id;
});
after(async () => { await app.stop(); await rm(dir, { recursive:true, force:true }); });

test('the first staff account is the owner; the owner adds a sitter', async () => {
  assert.equal((await call('owner','GET','/api/session')).json.role, 'owner');
  assert.equal((await call('owner','POST','/api/staff',{ name:'Sam', email:sitter.email, password:'short', role:'sitter' })).status, 400);
  assert.equal((await call('owner','POST','/api/staff',{ name:'Sam', email:sitter.email, password:sitter.password, role:'boss' })).json.code, 'invalid_role');
  const added = await call('owner','POST','/api/staff',{ name:'Sam', email:sitter.email, password:sitter.password, role:'sitter' });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.deepEqual(added.json.staff.map(s => [s.name, s.role, s.you]), [['Myomi','owner',true],['Sam','sitter',false]]);
  assert.equal((await call('owner','POST','/api/staff',{ name:'Ann', email:'ann@example.test', password:sitter.password, role:'sitter' })).json.code, 'email_taken');
  const signedIn = await call('sam','POST','/api/login',sitter);
  assert.equal(signedIn.status, 200);
  assert.deepEqual([signedIn.json.admin, signedIn.json.role], [true, 'sitter']);
  assert.equal((await call('ann','GET','/api/session')).json.role, null);
});

test('a sitter gets 403 from every owner route', async () => {
  for (const route of routes.filter(r => r.access === 'owner')) {
    const response = await call('sam', route.method, concrete(route), route.method === 'POST' ? {} : undefined);
    assert.equal(response.status, 403, route.method + ' ' + concrete(route));
  }
});

test('a sitter runs visits but does not approve, cancel, move them or see the ledger', async () => {
  assert.equal((await call('sam','POST','/api/status',{ id:booking, status:'Confirmed' })).status, 409);
  assert.equal((await call('owner','POST','/api/status',{ id:booking, status:'Confirmed' })).status, 200);
  assert.equal((await call('sam','POST','/api/status',{ id:booking, status:'Cancelled' })).status, 409);
  assert.equal((await call('sam','POST','/api/reschedule',{ id:booking, slot:1, start:1 })).json.code, 'owner_only');
  assert.equal((await call('sam','GET','/api/ledger?booking=' + booking)).json.code, 'owner_only');
  assert.equal((await call('sam','POST','/api/status',{ id:booking, status:'In Progress' })).status, 200);
  const pet = (await call('sam','GET','/api/portal')).json.bookings.find(b => b.id === booking).pet_ids[0];
  assert.equal((await call('sam','POST','/api/events',{ id:booking, pet, kind:'Walk completed', notes:'Lovely walk' })).status, 200);
  assert.equal((await call('sam','POST','/api/status',{ id:booking, status:'Completed', summary:'All good', secured:true })).status, 200);
  assert.equal((await call('sam','GET','/api/clients')).status, 200, 'sitters can read customer records');
});

test('switching an account off ends its sessions and stops sign-in; switching it on restores access', async () => {
  const sam = (await call('owner','GET','/api/staff')).json.staff.find(s => s.name === 'Sam');
  const me = (await call('owner','GET','/api/staff')).json.staff.find(s => s.you);
  assert.equal((await call('owner','POST','/api/staff/update',{ id:me.id, disabled:true })).json.code, 'staff_self');
  assert.equal((await call('owner','POST','/api/staff/update',{ id:me.id, role:'sitter' })).json.code, 'staff_self');
  assert.equal((await call('owner','POST','/api/staff/update',{ id:sam.id, disabled:true })).status, 200);
  assert.equal((await call('sam','GET','/api/portal')).status, 401);
  const refused = await call('sam','POST','/api/login',sitter);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'account_disabled');
  assert.equal((await call('sam','POST','/api/login',{ ...sitter, password:'wrong-password-123' })).status, 401, 'a wrong password reveals nothing');
  await call('owner','POST','/api/staff/update',{ id:sam.id, disabled:false });
  assert.equal((await call('sam','POST','/api/login',sitter)).status, 200);
});

test('promoting a sitter takes effect at their next sign-in; the owner can set a new password', async () => {
  const sam = (await call('owner','GET','/api/staff')).json.staff.find(s => s.name === 'Sam');
  await call('owner','POST','/api/staff/update',{ id:sam.id, role:'owner' });
  assert.equal((await call('sam','GET','/api/portal')).status, 401, 'the role change ended their session');
  await call('sam','POST','/api/login',sitter);
  assert.equal((await call('sam','GET','/api/financials')).status, 200);
  const reset = await call('owner','POST','/api/staff/password',{ id:sam.id, password:'a-brand-new-pass-1' });
  assert.equal(reset.status, 200);
  assert.equal((await call('sam','GET','/api/portal')).status, 401);
  assert.equal((await call('sam','POST','/api/login',{ email:sitter.email, password:'a-brand-new-pass-1' })).status, 200);
});
