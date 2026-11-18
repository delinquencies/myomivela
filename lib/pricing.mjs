import { feeLines } from './fees.mjs';

// Itemised prices. Every booking's total is the sum of its lines, computed on the server only.
// Phase 1 lines: the service itself and extra pets. Later lines (nightly, late pickup, fee rules) are added here.

/** @typedef {{ code:string, label:string, quantity:number, cents:number }} QuoteLine */

// service: a services row. petCount: pets on the booking (at least 1). nights: for an overnight stay, the number of
// nights; an overnight service's price is per night, and so is its extra-pet amount.
export function quote({ service, petCount, nights = 1 }) {
  const overnight = service.kind === 'overnight';
  /** @type {QuoteLine[]} */
  const lines = [overnight
    ? { code:'nightly', label:service.name+' (per night)', quantity:nights, cents:nights * service.cents }
    : { code:'base', label:service.name, quantity:1, cents:service.cents }];
  const extraPets = Math.max(0, petCount - 1) * (overnight ? nights : 1);
  if (extraPets && service.extra_pet_cents) {
    lines.push({ code:'extra_pet', label:overnight ? 'Extra pet (per night)' : 'Extra pet', quantity:extraPets, cents:extraPets * service.extra_pet_cents });
  }
  return { lines, total_cents:lines.reduce((sum, line) => sum + line.cents, 0) };
}
// Late pickup on an overnight stay: half a night once past the grace period, a whole night after 8 hours.
export function latePickupLine({ perNightCents, lateMs, graceMs }) {
  if (lateMs <= graceMs) return null;
  const cents = lateMs > 8 * 60 * 60_000 ? perNightCents : Math.round(perNightCents / 2);
  return { code:'late_pickup', label:'Late pickup', quantity:1, cents };
}
// The full price of a booking at a known time: the service lines from quote() plus any fee rules (C3.4).
// `nights` are a stay's night dates; it is empty for a visit.
export function priceBooking({ service, petCount, starts, ends, nights = [], now = Date.now() }) {
  const base = quote({ service, petCount, nights:Math.max(1, nights.length) });
  const lines = [...base.lines, ...feeLines({ lines:base.lines, starts, ends, nights, now })];
  return { lines, total_cents:lines.reduce((sum, line) => sum + line.cents, 0) };
}
