// Prepaid packages (C3.5): a number of visit credits for one service, valid for a number of days after purchase.
// A credit is held when a request uses it, written to the ledger as a `credit` line when the booking is confirmed
// (covering the service's base price; extra pets and fees are still paid), and given back if the booking is cancelled.
import { all, get, run } from './db.mjs';
import { requireThat } from './validate.mjs';
import { addEntry } from './ledger.mjs';

const dayMs = 86_400_000;
export const balancesFor = (owner, now = Date.now()) => all(`SELECT pb.id, pb.package, p.name, p.service, s.name AS service_name,
    pb.credits, pb.remaining, pb.expires, pb.purchased, pb.expires<=? AS expired
  FROM package_balances pb JOIN packages p ON p.id=pb.package JOIN services s ON s.id=p.service WHERE pb.owner=? ORDER BY pb.expires`, now, owner)
  .map(row => ({ ...row, expired:Boolean(row.expired) }));

// Gives a customer a package's credits. `provider_ref` makes an online purchase count once however often it is reported.
export function grantPackage({ owner, packageId, method, cents, provider_ref = null, recorded_by = null, now = Date.now() }) {
  const offer = get('SELECT * FROM packages WHERE id=?', packageId);
  requireThat(offer, 'Package not found.', 404);
  if (provider_ref && get('SELECT id FROM package_balances WHERE provider_ref=?', provider_ref)) return null;
  const id = run('INSERT INTO package_balances(owner,package,credits,remaining,expires,purchased,cents,method,provider_ref) VALUES(?,?,?,?,?,?,?,?,?)',
    owner, offer.id, offer.credits, offer.credits, now + offer.expires_days * dayMs, now, cents, method, provider_ref).lastInsertRowid;
  addEntry({ owner, kind:'payment', cents, method, provider_ref, note:'Package: ' + offer.name, recorded_by, now });
  return id;
}
// Called by the payment webhook when a package checkout is paid.
export function purchaseSettled(session, reference, amount, now) {
  grantPackage({ owner:session.owner, packageId:session.package, method:'card', cents:amount, provider_ref:reference, now });
}

// Holds a credit for a new booking of `service` starting at `starts`: the balance that expires first and is still
// valid then. Returns the balance id. Runs inside the booking's transaction.
export function holdCredit(owner, serviceId, starts, now = Date.now()) {
  const balance = get(`SELECT pb.id FROM package_balances pb JOIN packages p ON p.id=pb.package
    WHERE pb.owner=? AND p.service=? AND pb.remaining>0 AND pb.expires>? AND pb.expires>? ORDER BY pb.expires, pb.id LIMIT 1`, owner, serviceId, now, starts);
  requireThat(balance, 'You have no package credit for this service that is valid on that date.', 409, 'no_package_credit');
  run('UPDATE package_balances SET remaining=remaining-1 WHERE id=?', balance.id);
  return balance.id;
}
// On confirmation: the held credit becomes a ledger line worth the base price.
export function applyCredit(booking, now = Date.now()) {
  if (!booking.package_balance || get("SELECT id FROM ledger_entries WHERE booking=? AND kind='credit'", booking.id)) return;
  const base = get("SELECT cents FROM booking_lines WHERE booking=? AND code='base'", booking.id)?.cents ?? booking.cents;
  const name = get('SELECT p.name FROM package_balances pb JOIN packages p ON p.id=pb.package WHERE pb.id=?', booking.package_balance).name;
  addEntry({ booking:booking.id, owner:booking.owner, kind:'credit', cents:Math.min(base, booking.cents), method:'package', note:'Package: ' + name, now });
}
// On cancellation: the credit goes back to the balance, and an applied credit is reversed in the ledger.
export function returnCredit(booking, now = Date.now()) {
  if (!booking.package_balance) return;
  run('UPDATE package_balances SET remaining=MIN(credits, remaining+1) WHERE id=?', booking.package_balance);
  const applied = get("SELECT COALESCE(SUM(cents),0) AS cents FROM ledger_entries WHERE booking=? AND kind='credit' AND method='package'", booking.id).cents;
  if (applied > 0) addEntry({ booking:booking.id, owner:booking.owner, kind:'credit', cents:-applied, method:'package', note:'Package credit returned', now });
}
