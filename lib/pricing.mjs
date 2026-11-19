import { myoConfig, calculateEstimate } from '../assets/myo-config.js';
import { config } from './config.mjs';
import { speciesKey } from './compliance.mjs';
import { requireThat } from './validate.mjs';
import { capacityApplies, fullDays, dayOf } from './capacity.mjs';

const easternDay = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'short',
  timeZone: myoConfig.business.timeZone,
});
// Refuses a booking whose days have reached capacity (lib/capacity.mjs counts the same way for availability).
export function checkLaunchCapacity(starts, ends, exclude = 0) {
  if (!capacityApplies()) return;
  const full = fullDays(starts, ends, exclude);
  const last = dayOf(ends - 1);
  for (let day = dayOf(starts); day <= last; day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    requireThat(!full.has(day), 'This day is fully booked. Choose another date.', 409, 'time_unavailable');
  }
}
export function launchService(service) {
  if (config.pricingMode === 'catalog') return service;
  const cents =
    service.kind === 'meet'
      ? 0
      : service.kind === 'overnight'
        ? myoConfig.rates.overnight * 100
        : (myoConfig.rates.visit + (service.minutes === 60 ? myoConfig.rates.extension : 0)) * 100;
  return {
    ...service,
    cents,
    extra_pet_cents: service.kind === 'meet' ? 0 : myoConfig.rates.additionalDog * 100,
  };
}
function pricingPet(pet, starts) {
  let profile = {};
  try {
    profile = JSON.parse(pet.details || '{}');
  } catch {}
  const age = String(profile.age || '').trim();
  const years = /^(\d+(?:\.\d+)?)\s*(?:years?|yrs?|años?)?$/i.exec(age);
  const months = /^(\d+(?:\.\d+)?)\s*(?:months?|mos?|mes(?:es)?)$/i.exec(age);
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(age) ? Date.parse(age + 'T12:00:00Z') : NaN;
  const ageYears = years
    ? Number(years[1])
    : months
      ? Number(months[1]) / 12
      : Number.isFinite(birth)
        ? (starts - birth) / (365.2425 * 86400000)
        : undefined;
  const kind = speciesKey(pet.species);
  const puppy = /^(puppy|puppies|cachorr[oa]s?)$/i.test(pet.species.trim());
  return {
    kind: kind === 'dog' || kind === 'cat' ? kind : 'exotic',
    ageYears: ageYears ?? (puppy ? 0 : undefined),
  };
}
export function launchQuote({ service, pets, starts, nights, now = Date.now() }) {
  if (service.kind === 'meet')
    return { lines: [{ code: 'base', label: service.name, quantity: 1, cents: 0 }], total_cents: 0 };
  requireThat(
    service.kind === 'overnight' || [30, 60].includes(service.minutes),
    'Choose a 30- or 60-minute visit.',
    400,
    'unsupported_duration'
  );
  const selectedPets = pets.map((pet) => pricingPet(pet, starts));
  requireThat(
    service.name !== 'Dog walking' || selectedPets.every((pet) => pet.kind === 'dog'),
    'Dog walking is available for dogs only.',
    400,
    'pet_ineligible'
  );
  const date = easternDay.format(starts);
  const notice = (Date.parse(date) - Date.parse(easternDay.format(now))) / 86400000;
  const estimate = calculateEstimate({
    service: service.kind === 'overnight' ? 'overnight' : service.name === 'Dog walking' ? 'walk' : 'dropIn',
    date,
    nights,
    duration: service.minutes,
    pets: selectedPets,
    lastMinute:
      notice <
      (service.kind === 'overnight'
        ? myoConfig.booking.overnightNoticeDays
        : myoConfig.booking.visitNoticeDays),
  });
  requireThat(!estimate.requiresCustomQuote, 'Contact Myomi for a custom quote.', 400, 'custom_quote_required');
  const labels = {
    base: service.name,
    peakNights: 'Peak night surcharge',
    extension: 'Longer visit',
    extraPets: 'Additional pets',
    lastMinute: 'Last-minute fee',
  };
  return {
    lines: estimate.lines.map((line) => ({ ...line, label: labels[line.code], quantity: 1 })),
    total_cents: estimate.totalCents,
    deposit_cents: estimate.depositCents,
    balance_cents: estimate.balanceCents,
  };
}
import { feeLines } from './fees.mjs';

// Itemised prices. Every booking's total is the sum of its lines, computed on the server only.
// Phase 1 lines: the service itself and extra pets. Later lines (nightly, late pickup, fee rules) are added here.

/** @typedef {{ code:string, label:string, quantity:number, cents:number }} QuoteLine */

// service: a services row. petCount: pets on the booking (at least 1). nights: for an overnight stay, the number of
// nights; an overnight service's price is per night, and so is its extra-pet amount.
export function quote({ service, petCount, nights = 1, pets, starts }) {
  if (config.pricingMode !== 'catalog' && pets && starts)
    return launchQuote({ service, pets, starts, nights });
  const overnight = service.kind === 'overnight';
  /** @type {QuoteLine[]} */
  const lines = [
    overnight
      ? {
          code: 'nightly',
          label: service.name + ' (per night)',
          quantity: nights,
          cents: nights * service.cents,
        }
      : { code: 'base', label: service.name, quantity: 1, cents: service.cents },
  ];
  const extraPets = Math.max(0, petCount - 1) * (overnight ? nights : 1);
  if (extraPets && service.extra_pet_cents) {
    lines.push({
      code: 'extra_pet',
      label: overnight ? 'Extra pet (per night)' : 'Extra pet',
      quantity: extraPets,
      cents: extraPets * service.extra_pet_cents,
    });
  }
  return { lines, total_cents: lines.reduce((sum, line) => sum + line.cents, 0) };
}
// Late pickup on an overnight stay: half a night once past the grace period, a whole night after 8 hours.
export function latePickupLine({ perNightCents, lateMs, graceMs }) {
  if (lateMs <= graceMs) return null;
  const cents = lateMs > 8 * 60 * 60_000 ? perNightCents : Math.round(perNightCents / 2);
  return { code: 'late_pickup', label: 'Late pickup', quantity: 1, cents };
}
// The full price of a booking at a known time: the service lines from quote() plus any fee rules (C3.4).
// `nights` are a stay's night dates; it is empty for a visit.
export function priceBooking({ service, petCount, pets, starts, ends, nights = [], now = Date.now() }) {
  const base = quote({ service, petCount, pets, starts, nights:Math.max(1, nights.length) });
  const lines = [...base.lines, ...(config.pricingMode==='catalog'?feeLines({ lines:base.lines, starts, ends, nights, now }):[])];
  return { lines, total_cents:lines.reduce((sum, line) => sum + line.cents, 0) };
}
