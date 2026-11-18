import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, password } from './helpers.mjs';

// Walks the route table so a new route cannot skip its access rule unnoticed.
let app, routes, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'myo-routes-'));
  process.env.MYO_DB = join(dir, 'import-only.sqlite'); // importing the table opens a database; keep it out of the repo
  ({ routes } = await import('../lib/api.mjs'));
  app = await startServer();
  await app.call('customer','POST','/api/register',{ name:'c', email:'c@example.test', password });
});
after(async () => { await app.stop(); await rm(dir, { recursive:true, force:true }); });

const concrete = route => route.path instanceof RegExp ? route.path.source.replace(/\\\//g,'/').replace('(\\d+)','1').replace('([\\w.-]+)','name').replace(/^\^|\$$/g,'') : route.path;
const send = (who, route) => app.call(who, route.method, concrete(route), route.method === 'POST' ? {} : undefined);

test('every route declares a known access level', () => {
  assert.ok(routes.length >= 15);
  for (const route of routes) {
    assert.ok(['public','user','staff'].includes(route.access), concrete(route));
    assert.match(concrete(route), /^\/api\/[\w/-]+$/, 'the tests below must be able to call ' + concrete(route));
  }
});

test('signed-out callers get 401 from every non-public route', async () => {
  for (const route of routes.filter(r => r.access !== 'public')) {
    assert.equal((await send('anonymous', route)).status, 401, route.method + ' ' + concrete(route));
  }
});

test('customers get 403 from every staff route', async () => {
  for (const route of routes.filter(r => r.access === 'staff')) {
    assert.equal((await send('customer', route)).status, 403, route.method + ' ' + concrete(route));
  }
});

test('unknown API routes return 404 once signed in', async () => {
  assert.equal((await app.call('anonymous','GET','/api/nope')).status, 401);
  assert.equal((await app.call('customer','GET','/api/nope')).status, 404);
});
