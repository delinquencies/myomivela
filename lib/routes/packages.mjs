// Packages (C3.5): staff define them; customers buy one online or Myomi grants one paid another way.
import { all, get, run, transaction } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { requireProvider } from '../payments.mjs';
import { returnUrls } from './payments.mjs';
import { grantPackage, balancesFor } from '../packages.mjs';

const listing = user => all('SELECT p.*, s.name AS service_name FROM packages p JOIN services s ON s.id=p.service' +
  (user.admin ? '' : ' WHERE p.active=1') + ' ORDER BY s.name, p.credits').map(row => ({ ...row, active:Boolean(row.active) }));

export default [
  { method:'GET', path:'/api/packages', access:'user', handler:({ user }) => ({ packages:listing(user), balances:user.admin ? [] : balancesFor(user.id) }) },

  // { id?, name, service, credits, cents, expires_days, active? }. Changing a package never changes balances already bought.
  { method:'POST', path:'/api/packages', access:'staff', handler:({ data }) => {
    const service = get('SELECT * FROM services WHERE id=?', integer(data.service));
    requireThat(service, 'Service not found.', 404);
    requireThat(service.kind === 'visit', 'Packages are for walks and drop-in visits.', 400, 'package_visits_only');
    const values = [field(data.name, 80), service.id, integer(data.credits, 100), integer(data.cents, 10_000_000, 0),
      integer(data.expires_days, 730), data.active === false ? 0 : 1];
    if (data.id !== undefined) {
      requireThat(run('UPDATE packages SET name=?,service=?,credits=?,cents=?,expires_days=?,active=? WHERE id=?', ...values, integer(data.id)).changes, 'Package not found.', 404);
      return { id:data.id };
    }
    return { id:run('INSERT INTO packages(name,service,credits,cents,expires_days,active,created) VALUES(?,?,?,?,?,?,?)', ...values, Date.now()).lastInsertRowid };
  } },

  // Online purchase: a hosted checkout; the credits arrive with the provider's signed webhook.
  { method:'POST', path:'/api/packages/buy', access:'user', handler:async ({ user, data, url }) => {
    requireThat(!user.admin, 'Use a customer account to buy a package.', 403);
    const pay = requireProvider();
    const offer = get('SELECT * FROM packages WHERE id=? AND active=1', integer(data.package));
    requireThat(offer, 'Package not found.', 404);
    requireThat(offer.cents > 0, 'This package is free: ask Myomi to add it.', 409, 'nothing_due');
    const attempt = get('SELECT COUNT(*) AS count FROM checkout_sessions WHERE owner=? AND package=?', user.id, offer.id).count;
    const session = await pay.createCheckout({ amount:offer.cents, description:'myo. ' + offer.name, reference:'package-' + offer.id + '-user-' + user.id,
      metadata:{ package:String(offer.id), user:String(user.id) }, email:user.email, ...returnUrls(url, 'account'),
      idempotencyKey:'package-' + offer.id + '-' + user.id + '-' + attempt });
    const now = Date.now();
    run("INSERT INTO checkout_sessions(provider_id,owner,package,amount,url,status,expires,created,updated) VALUES(?,?,?,?,?,'open',?,?,?) ON CONFLICT(provider_id) DO NOTHING",
      session.id, user.id, offer.id, offer.cents, session.url, session.expires, now, now);
    return { redirect_url:session.url };
  } },

  // Staff add a package a customer paid for another way (or as a gift, with cents 0).
  { method:'POST', path:'/api/packages/grant', access:'staff', handler:({ user, data }) => transaction(() => {
    const customer = get('SELECT id FROM users WHERE id=? AND admin=0', integer(data.user));
    requireThat(customer, 'Customer not found.', 404);
    requireThat(['cash','check','other'].includes(data.method), 'Choose cash, check or other.', 400, 'invalid_method');
    const offer = get('SELECT * FROM packages WHERE id=?', integer(data.package));
    requireThat(offer, 'Package not found.', 404);
    const cents = data.cents === undefined ? offer.cents : integer(data.cents, 10_000_000, 0);
    const id = grantPackage({ owner:customer.id, packageId:offer.id, method:data.method, cents, recorded_by:user.id });
    return { id, balances:balancesFor(customer.id) };
  }) },
];
