// A booking's money (C3.1), derived from its ledger lines. Nothing is stored as "paid": the balance is always
// what is owed minus what was received, so a replayed event or a refund can never leave a stale flag behind.
import { all, get, run } from './db.mjs';

// What a booking owes: nothing while it is only a request, the cancellation fee once cancelled, else its total.
// What a booking owes now: a request owes its deposit (launch terms; otherwise nothing), a cancelled booking its
// cancellation fee, anything else its total.
export const amountDue = booking => booking.status === 'Requested' ? booking.deposit_cents || 0
  : booking.status === 'Cancelled' ? booking.cancel_fee_cents || 0 : booking.cents;

// SQL columns for bookingRows(): the ledger sums for booking alias `b`.
export const ledgerColumns = `
  (SELECT COALESCE(SUM(cents),0) FROM ledger_entries WHERE booking=b.id AND kind='payment') AS paid_cents,
  (SELECT COALESCE(SUM(cents),0) FROM ledger_entries WHERE booking=b.id AND kind='refund') AS refunded_cents,
  (SELECT COALESCE(SUM(cents),0) FROM ledger_entries WHERE booking=b.id AND kind='credit') AS credit_cents,
  (SELECT MAX(expires) FROM checkout_sessions WHERE booking=b.id AND status='open') AS checkout_expires`;

// status: 'none' (nothing owed yet), 'due', 'pending' (a checkout is open), 'partial', 'paid',
// 'refund_due' (more was received than is owed) or 'refunded'.
export function paymentSummary(row, now = Date.now()) {
  const due = amountDue(row);
  const paid = row.paid_cents || 0, refunded = row.refunded_cents || 0, credit = row.credit_cents || 0;
  const received = paid - refunded + credit;
  const balance = due - received;
  const status = balance < 0 ? 'refund_due'
    : due === 0 && paid > 0 && received === 0 ? 'refunded'
    : due > 0 && balance === 0 ? 'paid'
    : received > 0 ? 'partial'
    : due === 0 ? 'none'
    : row.checkout_expires > now ? 'pending' : 'due';
  const deposit = row.deposit_cents || 0;
  return { status, due_cents:due, paid_cents:paid, refunded_cents:refunded, credit_cents:credit, balance_cents:balance,
    // Deposit (launch terms): how much, whether it is in, and by when. `stage` says which amount `due_cents` is.
    deposit_cents:deposit, deposit_paid:deposit > 0 && received >= deposit, deposit_due_at:row.deposit_due_at ?? null,
    stage:row.status === 'Requested' && deposit > 0 ? 'deposit' : 'total' };
}
export function bookingPayment(bookingId) {
  const row = get(`SELECT b.*, ${ledgerColumns} FROM bookings b WHERE b.id=?`, bookingId);
  return row ? paymentSummary(row) : null;
}
export const ledgerFor = bookingId => all(`SELECT l.id, l.kind, l.cents, l.method, l.provider_ref, l.created, l.note, u.name AS recorded_by
  FROM ledger_entries l LEFT JOIN users u ON u.id=l.recorded_by WHERE l.booking=? ORDER BY l.id`, bookingId);

// Adds a line. A provider reference already recorded for the same kind is ignored (returns false), which is what
// makes webhook replays and our own refund-then-webhook sequence safe.
export function addEntry({ booking = null, owner, kind, cents, method, provider_ref = null, payment_ref = null, note = '', recorded_by = null, now = Date.now() }) {
  if (provider_ref && get('SELECT id FROM ledger_entries WHERE kind=? AND provider_ref=?', kind, provider_ref)) return false;
  run('INSERT INTO ledger_entries(booking,owner,kind,cents,method,provider_ref,payment_ref,created,note,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
    booking, owner, kind, cents, method, provider_ref, payment_ref, now, note, recorded_by);
  return true;
}
// Card money still refundable per provider payment, newest first.
export function refundableCardPayments(bookingId) {
  return all(`SELECT p.provider_ref, p.cents - COALESCE((SELECT SUM(r.cents) FROM ledger_entries r
      WHERE r.kind='refund' AND r.payment_ref=p.provider_ref),0) AS remaining
    FROM ledger_entries p WHERE p.booking=? AND p.kind='payment' AND p.method='card' AND p.provider_ref IS NOT NULL ORDER BY p.id DESC`, bookingId)
    .filter(row => row.remaining > 0);
}
