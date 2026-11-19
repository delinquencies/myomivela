// @ts-check
// Visit state (CUX-05): what can be done with a booking, where it is in its life, what the customer should do next, and
// the dashboard summaries built from the same bookings. Pure: no DOM, no requests, no translated text. The server uses
// it for GET /api/bookings/:id and request responses; the portal (Codex) renders the same results from portal data.
// The server still checks every action; these lists decide what to offer, not what is allowed.
import { hrefFor } from './portal-route-state.js';

/** @typedef {'customer'|'owner'|'sitter'} Role */
/**
 * @typedef {{ id:number, status:string, starts:number, ends:number, cents:number, service_kind?:string, created?:number|null, deposit_cents?:number, deposit_due_at?:number|null,
 *   confirmed_at?:number|null, cancelled_at?:number|null, arrived?:number|null, departed?:number|null,
 *   pending_change?:object|null, payment?:{ status:string, balance_cents:number, deposit_paid?:boolean }|null }} BookingLike
 */

export const visitReference = (/** @type {number} */ id) => 'MYO-' + String(id).padStart(5, '0');
const active = ['Requested','Confirmed','In Progress'];

/**
 * Actions to offer for a booking, by role. Codes: approve, decline, cancel, reschedule, request_change, withdraw_change,
 * decide_change, start, publish_update, complete, reveal_access, pay, tip, feedback, record_payment, refund, book_again.
 * @param {BookingLike} booking
 * @param {{ role:Role, now?:number, earlyStartMinutes?:number, paymentsEnabled?:boolean }} context
 */
export function allowedActions(booking, { role, now = Date.now(), earlyStartMinutes = 30, paymentsEnabled = false }) {
  const actions = [];
  const { status } = booking;
  const upcoming = booking.starts > now;
  const startOpen = now >= booking.starts - earlyStartMinutes * 60_000;
  if (role === 'customer') {
    if (['Requested','Confirmed'].includes(status) && upcoming) actions.push('cancel', status === 'Confirmed' ? 'request_change' : 'reschedule');
    if (booking.pending_change) actions.push('withdraw_change');
    // A request can be paid only for its deposit; anything accepted can be paid in full.
    if (paymentsEnabled && (booking.payment?.balance_cents ?? 0) > 0 && (status !== 'Requested' || (booking.deposit_cents ?? 0) > 0)) actions.push('pay');
    if (['In Progress','Completed'].includes(status)) actions.push('tip');
    if (status === 'Completed' && booking.departed && now - booking.departed < 7 * 86_400_000) actions.push('feedback');
    if (status === 'Completed') actions.push('book_again');
    return actions;
  }
  // Staff: owners decide and handle money; sitters run visits.
  if (role === 'owner') {
    if (status === 'Requested') actions.push('approve', 'decline', 'reschedule');
    if (status === 'Confirmed') actions.push('cancel', 'reschedule');
    if (booking.pending_change) actions.push('decide_change');
  }
  if (status === 'Confirmed' && startOpen) actions.push('start');
  if (status === 'In Progress') actions.push('publish_update', 'complete');
  if (status === 'In Progress' || (status === 'Confirmed' && startOpen)) actions.push('reveal_access');
  if (role === 'owner' && status !== 'Requested') {
    actions.push('record_payment');
    const payment = booking.payment;
    if (payment && ['paid','partial','refund_due'].includes(payment.status)) actions.push('refund');
  }
  return actions;
}

/**
 * The booking's life so far and ahead: requested → confirmed → started → completed, or requested → cancelled.
 * @param {BookingLike} booking
 * @returns {{ step:'requested'|'confirmed'|'started'|'completed'|'cancelled', at:number|null, done:boolean, current:boolean }[]}
 */
export function timeline(booking) {
  const steps = booking.status === 'Cancelled'
    ? [['requested', booking.created ?? null, true], ...(booking.confirmed_at ? [['confirmed', booking.confirmed_at, true]] : []), ['cancelled', booking.cancelled_at ?? null, true]]
    : [['requested', booking.created ?? null, true],
      ['confirmed', booking.confirmed_at ?? null, booking.status !== 'Requested'],
      ['started', booking.arrived ?? null, ['In Progress','Completed'].includes(booking.status)],
      ['completed', booking.departed ?? null, booking.status === 'Completed']];
  const lastDone = steps.map(([, , done]) => done).lastIndexOf(true);
  return steps.map(([step, at, done], index) => ({ step:/** @type {any} */ (step), at:/** @type {number|null} */ (at), done:/** @type {boolean} */ (done), current:index === lastDone }));
}

/**
 * What the customer should do or expect next, in order. Codes: awaiting_review, complete_intake, book_care_after_meet,
 * pay_deposit / deposit_arranged (with due_at and amount_cents), pay_balance, pay_after_confirmation, payment_arranged,
 * updates_in_diary. Each has an href (portal hash) and `done`.
 * @param {BookingLike} booking
 * @param {{ intakeState?:'absent'|'incomplete'|'outdated'|'complete', paymentsEnabled?:boolean }} context
 */
export function nextSteps(booking, { intakeState = 'complete', paymentsEnabled = false } = {}) {
  const steps = [];
  if (booking.status === 'Cancelled') return steps;
  if (booking.status === 'Requested') steps.push({ code:'awaiting_review', href:hrefFor('visit', { booking:booking.id }), done:false });
  if (intakeState !== 'complete') steps.push({ code:'complete_intake', href:hrefFor('care'), done:false, reason:intakeState });
  if (booking.service_kind === 'meet') steps.push({ code:'book_care_after_meet', href:hrefFor('book'), done:booking.status === 'Completed' });
  else if (booking.cents > 0) {
    const href = hrefFor('visit', { booking:booking.id });
    const paidInFull = booking.payment?.status === 'paid' && booking.status !== 'Requested';
    if ((booking.deposit_cents ?? 0) > 0) {
      // Launch terms: a 50% deposit within 48 hours of the request, then the balance before the visit.
      const depositPaid = Boolean(booking.payment?.deposit_paid);
      steps.push(paymentsEnabled ? { code:'pay_deposit', href, due_at:booking.deposit_due_at ?? null, amount_cents:booking.deposit_cents, done:depositPaid }
        : { code:'deposit_arranged', href:null, due_at:booking.deposit_due_at ?? null, amount_cents:booking.deposit_cents, done:depositPaid });
      steps.push(paymentsEnabled ? { code:'pay_balance', href, due_at:booking.starts, done:paidInFull } : { code:'payment_arranged', href:null, done:paidInFull });
    } else {
      steps.push(paymentsEnabled ? { code:'pay_after_confirmation', href, done:paidInFull } : { code:'payment_arranged', href:null, done:paidInFull });
    }
  }
  steps.push({ code:'updates_in_diary', href:hrefFor('diary'), done:booking.status === 'Completed' });
  return steps;
}

/**
 * The customer's dashboard: care happening now, the next booking, the latest diary update, and the actions waiting on them.
 * @param {{ bookings:BookingLike[], events?:{ id:number, booking:number, published:number }[], now?:number, paymentsEnabled?:boolean, intakeState?:string, meetStatus?:string }} data
 */
export function customerSummary({ bookings, events = [], now = Date.now(), paymentsEnabled = false, intakeState = 'complete', meetStatus }) {
  const activeCare = bookings.filter(booking => booking.status === 'In Progress').sort((a, b) => a.starts - b.starts);
  const nextBooking = bookings.filter(booking => ['Requested','Confirmed'].includes(booking.status) && booking.ends > now).sort((a, b) => a.starts - b.starts)[0] ?? null;
  const latestUpdate = [...events].sort((a, b) => b.published - a.published)[0] ?? null;
  const nextActions = [];
  if (intakeState === 'absent' || intakeState === 'incomplete') nextActions.push({ code:'complete_intake', href:hrefFor('care') });
  if (meetStatus === 'needed') nextActions.push({ code:'book_meet', href:'?service=meet' + hrefFor('book') });
  for (const booking of bookings) {
    if (paymentsEnabled && (booking.payment?.balance_cents ?? 0) > 0 && !['Requested','Cancelled'].includes(booking.status)) nextActions.push({ code:'pay', booking:booking.id, href:hrefFor('visit', { booking:booking.id }) });
    if (booking.status === 'Completed' && booking.departed && now - booking.departed < 7 * 86_400_000) nextActions.push({ code:'feedback', booking:booking.id, href:hrefFor('visit', { booking:booking.id }) });
  }
  return { activeCare:activeCare.map(booking => booking.id), nextBooking:nextBooking?.id ?? null, latestUpdate, nextActions };
}

/**
 * Staff work, most urgent first: visits in progress, visits that can start now, requests and change requests to decide,
 * then money to settle (owners only). Counts match the underlying bookings, whatever page the portal shows.
 * @param {{ bookings:BookingLike[], role:'owner'|'sitter', now?:number, earlyStartMinutes?:number }} data
 */
export function staffWorkQueue({ bookings, role, now = Date.now(), earlyStartMinutes = 30 }) {
  const rank = { in_progress:0, start_now:1, request:2, change:3, refund_due:4, payment_due:5 };
  const work = [];
  for (const booking of bookings) {
    if (booking.status === 'In Progress') work.push({ type:'in_progress', booking:booking.id, at:booking.arrived ?? booking.starts });
    if (booking.status === 'Confirmed' && now >= booking.starts - earlyStartMinutes * 60_000) work.push({ type:'start_now', booking:booking.id, at:booking.starts });
    if (role === 'owner' && booking.status === 'Requested') work.push({ type:'request', booking:booking.id, at:booking.starts });
    if (role === 'owner' && booking.pending_change && active.includes(booking.status)) work.push({ type:'change', booking:booking.id, at:booking.starts });
    if (role === 'owner' && booking.payment?.status === 'refund_due') work.push({ type:'refund_due', booking:booking.id, at:booking.starts });
    if (role === 'owner' && booking.status === 'Completed' && (booking.payment?.balance_cents ?? 0) > 0) work.push({ type:'payment_due', booking:booking.id, at:booking.starts });
  }
  work.sort((a, b) => rank[a.type] - rank[b.type] || a.at - b.at);
  const counts = Object.fromEntries(Object.keys(rank).map(type => [type, work.filter(item => item.type === type).length]));
  return { workQueue:work, counts };
}
