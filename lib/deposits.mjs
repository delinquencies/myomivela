// Deposits and launch terms (CUX-04; owner decisions of Nov 19, 2026). A paid request in launch mode owes 50% of its
// total within 48 hours of being sent. Myomi confirms only once the deposit is received. With online payment on, an
// unpaid request expires at its deadline and its time is released; with online payment off, the deposit is arranged
// with Myomi directly and nothing expires on its own (she can still decline). Cancelling 7 or more days ahead returns
// the deposit; later, Myomi keeps 50% of what was paid. Myomi cancelling always refunds in full.
import { createHash } from 'node:crypto';
import { all, run } from './db.mjs';
import { config } from './config.mjs';
import { myoConfig } from '../assets/myo-config.js';
import { provider } from './payments.mjs';
import { bookingPayment } from './ledger.mjs';
import { notify, bookingParams } from './outbox.mjs';
import { returnCredit } from './packages.mjs';

const hour = 60 * 60_000;
export const launchTerms = () => config.pricingMode !== 'catalog';
export const depositApplies = (service, total) => launchTerms() && service.kind !== 'meet' && total > 0;
export const depositFor = total => Math.round(total * myoConfig.booking.depositRatio);
// 'online': the client can pay the deposit through the payment provider; 'manual': Myomi records it.
export const depositCollection = () => provider() ? 'online' : 'manual';

// The terms a client accepts with a request. The version changes whenever any of these numbers change.
export function terms(starts = null) {
  const { depositRatio, depositHours, cancellationDays, meetScope, meetNoticeHours } = myoConfig.booking;
  const retention = myoConfig.flags.lateCancellationDepositRetentionRatio;
  const body = { deposit_ratio:depositRatio, deposit_due_hours:depositHours, deposit_clock:'request', cancellation_days:cancellationDays,
    late_retention_ratio:retention, meet_scope:meetScope, meet_notice_hours:meetNoticeHours };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return { version, ...body, deposit_collection:depositCollection(),
    ...(starts === null ? {} : { free_cancellation_until:starts - cancellationDays * 24 * hour }) };
}

// Sends reminders and expires unpaid requests. Synchronous: run it inside a transaction. Returns what it did.
export function enforceDeposits(now = Date.now()) {
  if (!launchTerms()) return { reminded:0, expired:0 };
  const due = all("SELECT * FROM bookings WHERE status='Requested' AND deposit_cents>0 AND deposit_due_at IS NOT NULL AND deposit_due_at<=?", now + 24 * hour);
  let reminded = 0, expired = 0;
  for (const booking of due) {
    const payment = bookingPayment(booking.id);
    if (payment.deposit_paid) continue;
    if (booking.deposit_due_at > now) {
      // A day before the deadline (once).
      notify(booking.owner, 'deposit_reminder', { ...bookingParams(booking.id), deposit_cents:booking.deposit_cents, due_at:booking.deposit_due_at,
        collection:depositCollection() }, 'deposit-reminder:' + booking.id);
      reminded++;
      continue;
    }
    if (depositCollection() !== 'online') continue; // manual collection: Myomi decides
    run("UPDATE bookings SET status='Cancelled', cancelled_at=?, cancel_reason='deposit_expired', cancel_fee_cents=0 WHERE id=? AND status='Requested'", now, booking.id);
    run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE booking=? AND status='Pending'", now, booking.id);
    run("DELETE FROM checkout_holds WHERE owner=? AND starts=? AND ends=?", booking.owner, booking.starts, booking.ends);
    returnCredit(booking, now);
    notify(booking.owner, 'deposit_expired', bookingParams(booking.id), 'deposit-expired:' + booking.id);
    notify('staff', 'deposit_expired_staff', bookingParams(booking.id), 'deposit-expired-staff:' + booking.id);
    expired++;
  }
  return { reminded, expired };
}
