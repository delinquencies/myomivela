// Payments, refunds and tips (C3.1). Customers pay a booking's balance in the provider's hosted checkout; the
// signed webhook is the only thing that records card money. Staff can also record cash or check payments and
// refunds by hand, which works with online payment switched off.
import { get, run, transaction } from '../db.mjs';
import { config } from '../config.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { bookingFor } from '../bookings.mjs';
import { addEntry, bookingPayment, ledgerFor, refundableCardPayments } from '../ledger.mjs';
import { provider, requireProvider, verifyWebhook } from '../payments.mjs';
import { purchaseSettled } from '../packages.mjs';
import { notify } from '../outbox.mjs';
import { isOwner } from '../auth.mjs';

const manualMethods = ['cash','check','other'];
const maxTipCents = 50_000;
// Bookings that can take money: accepted ones, and cancelled ones that still owe a fee.
// Bookings that can take money: accepted ones, cancelled ones that still owe a fee, and requests owing a deposit.
const payable = booking => ['Confirmed','In Progress','Completed','Cancelled'].includes(booking.status)
  || (booking.status === 'Requested' && booking.deposit_cents > 0);
export const returnUrls = (url, hash = 'upcoming') => {
  const origin = config.origin || url.origin;
  return { successUrl:origin + '/portal/index.html?payment=success#' + hash, cancelUrl:origin + '/portal/index.html?payment=cancelled#' + hash };
};
// Adds a tip line to a booking and raises its total, so the tip is paid like the rest of the balance.
export function addTip(bookingId, cents, label = 'Tip') {
  const booking = get('SELECT * FROM bookings WHERE id=?', bookingId);
  const tipped = get("SELECT COALESCE(SUM(cents),0) AS cents FROM booking_lines WHERE booking=? AND code='tip'", bookingId).cents;
  requireThat(tipped + cents <= maxTipCents, 'Tips on one visit are limited to $' + maxTipCents / 100 + '.', 400, 'tip_too_large');
  const position = (get('SELECT MAX(position) AS last FROM booking_lines WHERE booking=?', bookingId)?.last ?? -1) + 1;
  run("INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,'tip',?,1,?)", bookingId, position, label, cents);
  run('UPDATE bookings SET cents=? WHERE id=?', booking.cents + cents, bookingId);
}

// Applies one verified provider event. Runs inside a transaction; returns what it did, for the response and tests.
function applyEvent(event, now) {
  const object = event.data.object;
  if (event.type.startsWith('checkout.session.')) {
    const session = get('SELECT * FROM checkout_sessions WHERE provider_id=?', object.id);
    if (!session) return 'ignored';
    const paid = ['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && object.payment_status === 'paid';
    if (paid) {
      run("UPDATE checkout_sessions SET status='paid',updated=? WHERE id=?", now, session.id);
      const amount = Number.isSafeInteger(object.amount_total) ? object.amount_total : session.amount;
      const reference = typeof object.payment_intent === 'string' ? object.payment_intent : object.id;
      if (session.booking) addEntry({ booking:session.booking, owner:session.owner, kind:'payment', cents:amount, method:'card', provider_ref:reference, now });
      notify(session.owner, 'payment_received', { cents:amount }, 'payment:' + reference);
      if (session.package) purchaseSettled(session, reference, amount, now);
      return 'paid';
    }
    // A completed-but-unpaid session (a slow bank payment) stays open until its async result arrives.
    const ended = event.type === 'checkout.session.expired' ? 'expired' : event.type === 'checkout.session.async_payment_failed' ? 'failed' : null;
    if (ended) run("UPDATE checkout_sessions SET status=?,updated=? WHERE id=? AND status='open'", ended, now, session.id);
    return ended || 'ignored';
  }
  // Refunds, including ones made in the provider's dashboard. Our own refunds are already recorded: ignored here.
  if (['refund.created','refund.updated','charge.refund.updated'].includes(event.type) && object.status === 'succeeded') {
    const payment = get("SELECT * FROM ledger_entries WHERE kind='payment' AND provider_ref=?", object.payment_intent);
    if (!payment) return 'ignored';
    return addEntry({ booking:payment.booking, owner:payment.owner, kind:'refund', cents:object.amount, method:'card',
      provider_ref:object.id, payment_ref:payment.provider_ref, note:'Refunded by the payment provider', now }) ? 'refunded' : 'duplicate';
  }
  return 'ignored';
}

export default [
  // Starts (or resumes) a hosted checkout for a booking's balance and returns where to send the customer.
  { method:'POST', path:'/api/payments/start', access:'user', handler:async ({ user, data, url }) => {
    requireThat(!user.admin, 'Use a customer account to pay.', 403);
    const pay = requireProvider();
    const booking = bookingFor(user, data.booking);
    const summary = bookingPayment(booking.id);
    requireThat(payable(booking) && summary.balance_cents > 0, 'Nothing is due on this booking.', 409, 'nothing_due');
    const now = Date.now();
    const open = get("SELECT * FROM checkout_sessions WHERE booking=? AND status='open' AND amount=? AND expires>? ORDER BY id DESC LIMIT 1",
      booking.id, summary.balance_cents, now + 60_000);
    if (open) return { redirect_url:open.url };
    const service = get('SELECT name FROM services WHERE id=?', booking.service);
    const attempt = get('SELECT COUNT(*) AS count FROM checkout_sessions WHERE booking=?', booking.id).count;
    const session = await pay.createCheckout({
      amount:summary.balance_cents, description:'myo. ' + service.name + (summary.stage === 'deposit' ? ' deposit' : '') + ' (booking ' + booking.id + ')', reference:'booking-' + booking.id,
      metadata:{ booking:String(booking.id) }, email:user.email, ...returnUrls(url),
      idempotencyKey:'checkout-' + booking.id + '-' + attempt + '-' + summary.balance_cents,
    });
    run("INSERT INTO checkout_sessions(provider_id,owner,booking,amount,url,status,expires,created,updated) VALUES(?,?,?,?,?,'open',?,?,?) ON CONFLICT(provider_id) DO NOTHING",
      session.id, user.id, booking.id, summary.balance_cents, session.url, session.expires, now, now);
    return { redirect_url:session.url };
  } },

  // The provider's signed events. Public (the provider has no session); the signature is the authentication.
  { method:'POST', path:'/api/payments/webhook', access:'public', rawBody:true, idempotent:false, handler:async ({ request, rawBody }) => {
    const event = await verifyWebhook(rawBody, request.headers.get('stripe-signature'));
    return transaction(() => {
      const now = Date.now();
      if (get('SELECT id FROM payment_events WHERE id=?', event.id)) return { received:true, result:'duplicate' };
      run('INSERT INTO payment_events(id,type,received) VALUES(?,?,?)', event.id, event.type, now);
      return { received:true, result:applyEvent(event, now) };
    });
  } },

  // Staff record money taken another way (cash, check or anything else), or online payment while it is off.
  { method:'POST', path:'/api/payments/record', access:'owner', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user, data.booking);
    // A request can take money only for its deposit (launch terms); otherwise confirm it first.
    requireThat(booking.status !== 'Requested' || booking.deposit_cents > 0, 'Confirm the booking before recording a payment.', 409, 'nothing_due');
    requireThat(manualMethods.includes(data.method), 'Choose cash, check or other.', 400, 'invalid_method');
    addEntry({ booking:booking.id, owner:booking.owner, kind:'payment', cents:integer(data.cents, 1_000_000), method:data.method,
      note:data.note === undefined ? '' : field(data.note, 200, false), recorded_by:user.id });
    return { payment:bookingPayment(booking.id) };
  }) },

  // Refunds. Card refunds go back through the provider (split across the booking's card payments, newest first);
  // cash, check and other refunds record money Myomi returned by hand.
  { method:'POST', path:'/api/refunds', access:'owner', recentAuth:true, handler:async ({ user, data }) => {
    const booking = bookingFor(user, data.booking);
    const cents = integer(data.cents, 1_000_000);
    const note = data.note === undefined ? '' : field(data.note, 200, false);
    const summary = bookingPayment(booking.id);
    requireThat(cents <= summary.paid_cents - summary.refunded_cents, 'You can refund at most what was paid.', 400, 'refund_too_large');
    if (data.method !== 'card') {
      requireThat(manualMethods.includes(data.method), 'Choose card, cash, check or other.', 400, 'invalid_method');
      transaction(() => addEntry({ booking:booking.id, owner:booking.owner, kind:'refund', cents, method:data.method, note, recorded_by:user.id }));
      return { payment:bookingPayment(booking.id) };
    }
    const pay = requireProvider();
    const payments = refundableCardPayments(booking.id);
    requireThat(cents <= payments.reduce((sum, row) => sum + row.remaining, 0), 'That is more than the card payments left to refund.', 400, 'refund_too_large');
    const refunds = [];
    let left = cents;
    for (const row of payments) {
      if (!left) break;
      const amount = Math.min(left, row.remaining);
      // The key is fixed by what is already refunded, so a retry after a lost response reuses the same refund.
      const refund = await pay.refund({ paymentRef:row.provider_ref, amount, metadata:{ booking:String(booking.id) },
        idempotencyKey:'refund-' + booking.id + '-' + row.provider_ref + '-' + row.remaining + '-' + amount });
      refunds.push({ ...refund, amount, payment_ref:row.provider_ref });
      left -= amount;
    }
    transaction(() => {
      for (const refund of refunds) addEntry({ booking:booking.id, owner:booking.owner, kind:'refund', cents:refund.amount, method:'card',
        provider_ref:refund.id, payment_ref:refund.payment_ref, note, recorded_by:user.id });
    });
    return { payment:bookingPayment(booking.id) };
  } },

  // A one-time tip on a visit that has started or finished. It joins the booking's balance.
  { method:'POST', path:'/api/tips', access:'user', handler:({ user, data }) => transaction(() => {
    requireThat(!user.admin, 'Use a customer account to tip.', 403);
    const booking = bookingFor(user, data.booking);
    requireThat(['In Progress','Completed'].includes(booking.status), 'You can tip once the visit has started.', 409, 'tip_not_open');
    addTip(booking.id, integer(data.cents, maxTipCents, 100));
    return { payment:bookingPayment(booking.id) };
  }) },

  // A standing tip, as a percentage added to each visit when it is completed (0 turns it off).
  { method:'POST', path:'/api/auto-tip', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to tip.', 403);
    const percent = integer(data.percent, 30, 0);
    run('UPDATE users SET auto_tip_percent=? WHERE id=?', percent, user.id);
    return { auto_tip_percent:percent };
  } },

  { method:'GET', path:'/api/ledger', access:'user', handler:({ user, url }) => {
    requireThat(!user.admin || isOwner(user), 'Only the owner can do this.', 403, 'owner_only');
    const booking = bookingFor(user, Number(url.searchParams.get('booking')));
    return { entries:ledgerFor(booking.id), payment:bookingPayment(booking.id), payments_enabled:Boolean(provider()) };
  } },
];
