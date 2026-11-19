// What every quote says beyond its lines (CUX-08): the deposit split, the short-notice window, peak status, the
// service units and how long the quote stands. Shared by the signed-in quote and the guest quote, so both describe the
// same facts the same way. The deposit lifecycle itself (when it is due, expiry, refunds) is CUX-04's.
import { createHash } from 'node:crypto';
import { config } from './config.mjs';
import { myoConfig, isPeakDate } from '../assets/myo-config.js';
import { dayOf } from './capacity.mjs';

const dayMs = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
// A quote is a price for a moment; after this the client should ask again (the short-notice day may have changed).
export const quoteLifetimeMs = 10 * 60_000;

/** @param {{ service:{ kind:string, minutes:number }, starts:number, ends:number, nights:string[], lines:{ code:string, cents:number }[], total_cents:number, now?:number }} quote */
export function quoteTerms({ service, starts, ends, nights, lines, total_cents, now = Date.now() }) {
  const launch = config.pricingMode !== 'catalog';
  const noticeDays = service.kind === 'meet' ? null : service.kind === 'overnight' ? myoConfig.booking.overnightNoticeDays : myoConfig.booking.visitNoticeDays;
  const deposit = launch && total_cents > 0 ? Math.round(total_cents * myoConfig.booking.depositRatio) : null;
  const days = nights.length ? nights : [dayOf(starts)];
  const revision = createHash('sha256').update(JSON.stringify([config.pricingMode, service.kind, starts, ends, lines.map(line => [line.code, line.cents])])).digest('hex').slice(0, 16);
  return {
    units:{ kind:service.kind === 'overnight' ? 'night' : service.kind === 'meet' ? 'meeting' : 'visit',
      quantity:service.kind === 'overnight' ? nights.length : 1, minutes:service.kind === 'overnight' ? null : (ends - starts) / 60_000 },
    deposit_cents:deposit, balance_cents:deposit === null ? null : total_cents - deposit,
    deposit_ratio:launch ? myoConfig.booking.depositRatio : null, deposit_due_hours:launch ? myoConfig.booking.depositHours : null,
    notice:{ last_minute:lines.some(line => line.code === 'lastMinute' && line.cents > 0),
      days:launch ? noticeDays : null, fee_free_from:launch && noticeDays !== null ? addDays(dayOf(now), noticeDays) : null },
    peak:{ is_peak:launch && days.some(day => isPeakDate(day)), peak_days:launch ? days.filter(day => isPeakDate(day)) : [] },
    revision, valid_until:now + quoteLifetimeMs,
  };
}
