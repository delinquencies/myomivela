import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes, routesFor, resolveLocation, roleOf, hrefFor } from '../assets/portal-route-state.js';

// CUX-01: one route registry for every portal destination, role, legacy link and invalid location. Pure; no server.
const signedOut = null;
const customer = { admin:false };
const owner = { admin:true, role:'owner' };
const sitter = { admin:true, role:'sitter' };
const at = (hash, session, search = '') => resolveLocation({ hash, search }, session);

test('roles come from the session', () => {
  assert.equal(roleOf(signedOut), 'signed_out');
  assert.equal(roleOf(customer), 'customer');
  assert.equal(roleOf(owner), 'owner');
  assert.equal(roleOf({ admin:true }), 'owner', 'staff created before roles are owners');
  assert.equal(roleOf(sitter), 'sitter');
});

test('each role gets a short menu of goals; the rest open in context (audit UX-05)', () => {
  const ids = session => routesFor(session).map(route => route.id);
  // Account is its own header link, so each role has four destinations.
  assert.deepEqual(ids(customer), ['client-home','upcoming','pets']);
  assert.deepEqual(ids(owner), ['staff-home','upcoming','clients','more']);
  assert.deepEqual(ids(sitter), ['staff-home','upcoming','clients','more']);
  assert.deepEqual(ids(signedOut), []);
  // Off the menu but still reachable, and owner-only screens still refuse sitters.
  for (const hash of ['#book','#care','#diary']) assert.equal(resolveLocation({ hash, search:'' }, customer).outcome, 'ready', hash);
  for (const hash of ['#history','#diary','#more']) assert.equal(resolveLocation({ hash, search:'' }, sitter).outcome, 'ready', hash);
  for (const hash of ['#settings','#financials']) assert.equal(resolveLocation({ hash, search:'' }, owner).outcome, 'ready', hash);
  assert.equal(resolveLocation({ hash:'#financials', search:'' }, sitter).outcome, 'forbidden');
  assert.ok(routesFor(customer).every(route => route.href.startsWith('#') && route.labelKey));
});

test('every route can be resolved from its own href', () => {
  const sample = { step:'service', booking:7, pet:3, client:9, group:'hours' };
  for (const route of routes) {
    const params = Object.fromEntries((route.params || []).map(name => [name, route.id === 'book-intake' ? '2' : sample[name]]));
    const session = route.roles.includes('customer') ? customer : route.roles.includes('owner') ? owner : signedOut;
    const resolved = resolveLocation({ hash:hrefFor(route.id, params) }, session);
    assert.equal(resolved.id, route.id, route.id);
    assert.equal(resolved.outcome, 'ready', route.id);
  }
});

test('legacy links map to canonical routes and keep their identifiers', () => {
  assert.deepEqual(pick(at('#checkout-12', customer)), { id:'visit', params:{ booking:12 }, canonical:'#visit/12', outcome:'ready', legacy:true });
  assert.deepEqual(pick(at('#pet-3', customer)), { id:'pet', params:{ pet:3 }, canonical:'#pet/3', outcome:'ready', legacy:true });
  assert.deepEqual(pick(at('#pet-intake', customer)), { id:'pet-new', params:{}, canonical:'#pets/new', outcome:'ready', legacy:true });
  assert.equal(at('#upcoming', customer).legacy, false);
});

test('booking intent in the query is kept through canonicalization', () => {
  const resolved = at('#book', signedOut, '?service=dog-walking&rate=4&utm=x');
  assert.equal(resolved.outcome, 'ready', 'signed-out visitors may start booking');
  assert.deepEqual(resolved.query, { service:'dog-walking', rate:'4' });
  assert.equal(resolved.canonical, '?service=dog-walking&rate=4#book');
  assert.equal(at('', customer, '?service=meet').id, 'book', 'a service link without a hash opens booking');
  assert.equal(at('#diary', signedOut, '?staff=1').query.staff, '1');
});

test('signed-out visitors are sent to sign in with a way back', () => {
  const resolved = at('#visit/5', signedOut);
  assert.deepEqual([resolved.id, resolved.outcome, resolved.returnTo], ['sign-in', 'sign_in_required', '#visit/5']);
  assert.equal(at('#book/intake/2', signedOut).returnTo, '#book/intake/2');
  assert.equal(at('#book/details', signedOut).outcome, 'ready', 'choosing a time works signed out');
});

test('roles without access get an explicit refusal and their home', () => {
  assert.deepEqual([at('#settings', sitter).id, at('#settings', sitter).outcome], ['staff-home', 'forbidden']);
  assert.equal(at('#financials', sitter).outcome, 'forbidden');
  assert.equal(at('#settings/team', owner).outcome, 'ready');
  assert.deepEqual([at('#book', owner).outcome, at('#care', owner).outcome], ['forbidden', 'forbidden']);
  assert.deepEqual([at('#clients', customer).id, at('#clients', customer).outcome], ['client-home', 'forbidden']);
  assert.deepEqual([at('#sign-in', customer).id, at('#sign-in', customer).outcome], ['client-home', 'ready']);
});

test('invalid locations resolve to an explicit not_found with the role home', () => {
  for (const hash of ['#nope', '#visit/0', '#visit/abc', '#book/intake/4', '#settings/money', '#visit/99999999999999999999', '#<script>', '#%E0%A4%A']) {
    const resolved = at(hash, customer);
    assert.equal(resolved.outcome, 'not_found', hash);
    assert.equal(resolved.id, 'client-home', hash);
    assert.equal(resolved.canonical, '#client-home', hash);
  }
  assert.equal(at('#nope', owner).id, 'staff-home');
  assert.equal(at('', signedOut).id, 'sign-in');
  assert.equal(at('', sitter).id, 'staff-home');
});

test('URL strings resolve the same as Location objects', () => {
  assert.equal(resolveLocation('https://myo.example/portal/index.html?service=meet#book/details', customer).canonical, '?service=meet#book/details');
  assert.equal(resolveLocation('#checkout-4', owner).canonical, '#visit/4');
});

function pick(resolved) {
  const { id, params, canonical, outcome, legacy } = resolved;
  return { id, params, canonical, outcome, legacy };
}
