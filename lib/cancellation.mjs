// Cancellation policy (C3.2). A customer cancelling a confirmed booking inside its service's cutoff owes a
// percentage of it: of the whole booking for a visit, of one night for an overnight stay. Requests are always
// free to cancel, staff cancellations waive the fee, and a change request is never a cancellation.
import { all, get } from './db.mjs';
import { config } from './config.mjs';
import { myoConfig } from '../assets/myo-config.js';
import { bookingPayment } from './ledger.mjs';

// The service part of a booking's price: everything but tips (fees from fee rules are part of the visit).
const servicedCents = bookingId => all("SELECT code, quantity, cents FROM booking_lines WHERE booking=? AND code<>'tip'", bookingId);

export function cancellationTerms(booking, now = Date.now()) {
  const service = get('SELECT * FROM services WHERE id=?', booking.service);
  // Launch terms (owner decision, Nov 19 2026): free 7 or more days ahead; later, Myomi keeps 50% of the deposit
  // actually paid (never more than was paid). Applies to requests and confirmed bookings alike.
  if (config.pricingMode !== 'catalog') {
    const days = myoConfig.booking.cancellationDays;
    const ratio = myoConfig.flags.lateCancellationDepositRetentionRatio;
    const cutoff = booking.starts - days * 24 * 60 * 60_000;
    const payment = bookingPayment(booking.id);
    const received = Math.max(0, payment.paid_cents - payment.refunded_cents);
    const late = now >= cutoff && ['Requested','Confirmed'].includes(booking.status);
    return { model:'deposit', cutoff, cutoff_days:days, cutoff_hours:days * 24, percent:Math.round(ratio * 100),
      deposit_cents:booking.deposit_cents || 0, received_cents:received,
      fee_cents:late ? Math.min(Math.round((booking.deposit_cents || 0) * ratio), received) : 0 };
  }
  const cutoff = booking.starts - service.cancel_cutoff_hours * 60 * 60_000;
  const terms = { model:'service', cutoff, cutoff_hours:service.cancel_cutoff_hours, percent:service.cancel_fee_percent, fee_cents:0 };
  if (booking.status !== 'Confirmed' || now < cutoff || !service.cancel_fee_percent) return terms;
  const lines = servicedCents(booking.id);
  let base = lines.length ? lines.reduce((sum, line) => sum + line.cents, 0) : booking.cents;
  if (service.kind === 'overnight') {
    const nights = lines.find(line => line.code === 'nightly')?.quantity || 1;
    base = Math.round(base / nights);
  }
  return { ...terms, model:'service', fee_cents:Math.round(base * service.cancel_fee_percent / 100) };
}
