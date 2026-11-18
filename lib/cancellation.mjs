// Cancellation policy (C3.2). A customer cancelling a confirmed booking inside its service's cutoff owes a
// percentage of it: of the whole booking for a visit, of one night for an overnight stay. Requests are always
// free to cancel, staff cancellations waive the fee, and a change request is never a cancellation.
import { all, get } from './db.mjs';

// The service part of a booking's price: everything but tips (fees from fee rules are part of the visit).
const servicedCents = bookingId => all("SELECT code, quantity, cents FROM booking_lines WHERE booking=? AND code<>'tip'", bookingId);

export function cancellationTerms(booking, now = Date.now()) {
  const service = get('SELECT * FROM services WHERE id=?', booking.service);
  const cutoff = booking.starts - service.cancel_cutoff_hours * 60 * 60_000;
  const terms = { cutoff, cutoff_hours:service.cancel_cutoff_hours, percent:service.cancel_fee_percent, fee_cents:0 };
  if (booking.status !== 'Confirmed' || now < cutoff || !service.cancel_fee_percent) return terms;
  const lines = servicedCents(booking.id);
  let base = lines.length ? lines.reduce((sum, line) => sum + line.cents, 0) : booking.cents;
  if (service.kind === 'overnight') {
    const nights = lines.find(line => line.code === 'nightly')?.quantity || 1;
    base = Math.round(base / nights);
  }
  return { ...terms, fee_cents:Math.round(base * service.cancel_fee_percent / 100) };
}
