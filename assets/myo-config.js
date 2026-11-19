// @ts-check
// Launch flags. Change these values here to update estimates and policy copy together.
const flags = {
  christmas2026Range: /** @type {const} */ (['2026-12-30','2027-01-02']),
  peakPuppyRate: 44, // Confirm 44 vs 53.
  overnightAdditionalPetRates: {dog:21,cat:13},
  lateCancellationDepositRetentionRatio: .5, // Owner decision, Nov 19 2026: a late cancellation keeps 50% of the deposit.
  smallExoticPetRate: {base:30,additional:13,requiresCustomQuote:false},
  autoApplyLastMinuteFee: true,
};

export const myoConfig = {
  flags,
  business: {brand:'MYO',contact:'Myomi Velazquez',city:'Springfield',state:'MA',zip:'01108',radiusMiles:15,opens:'06:00',closes:'22:00',capacity:10,timeZone:'America/New_York'},
  excluded: /** @type {const} */ (['boarding','daycare','transport']),
  rates: {visitMinutes:30,longVisitMinutes:60,visit:30,peakVisit:44,extension:20,puppy:39,additionalDog:21,additionalCat:13,overnight:95,overnightPeakSurcharge:44,lastMinute:15},
  booking: {visitNoticeDays:3,overnightNoticeDays:7,depositRatio:.5,depositHours:48,meetAndGreet:0,cancellationDays:7,
    // Owner decisions, Nov 19 2026: one Meet & Greet per client (not per booking), booked at least 24 hours ahead; the
    // 48-hour deposit window starts when the request is sent.
    meetScope:'client',meetNoticeHours:24,depositClock:'request',
    aloneHoursMin:4,aloneHoursMax:6,dogWeightMin:0,dogWeightMax:100,puppyAgeYears:1},
  peakPeriods: /** @type {const} */ ([
    ['thanksgiving26','2026-11-25','2026-11-30'],
    ['christmas26',...flags.christmas2026Range],
    ['mlk','2027-01-15','2027-01-18'],
    ['presidents','2027-02-12','2027-02-15'],
    ['easter','2027-03-26','2027-03-29'],
    ['memorial','2027-05-28','2027-05-31'],
    ['juneteenth','2027-06-18','2027-06-20'],
    ['julyFourth','2027-07-01','2027-07-05'],
    ['labor','2027-09-03','2027-09-06'],
    ['thanksgiving27','2027-11-20','2027-11-28'],
    ['christmas27','2027-12-23','2028-01-02'],
  ]),
  policyKeys: /** @type {const} */ (['area','services','peak','booking','meet','payments','clientCancel','myoCancel','access','eligibility','intake','backup','security','weather','privacy','contact']),
  intakeMaxLength:20000,
  intakeFields: /** @type {const} */ ([
    ['pets','text'],['feeding','textarea'],['health','textarea'],['medication','textarea'],
    ['behavior','textarea'],['vaccines','textarea'],['vet','text'],['emergency','text'],
    ['decisionMakers','text'],['vetAuthorization','select'],['spendingLimit','number'],
  ]),
};

/** @import { EstimateInput, Estimate, PetKind } from './myo-launch.d.ts' */
const dayMs = 86_400_000;
/** @param {string} date */
function dateValue(date) {
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date+'T00:00:00Z') : NaN;
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === date ? timestamp : NaN;
}
/** @param {string} date Massachusetts calendar date, YYYY-MM-DD. */
export function isPeakDate(date) {
  return Number.isFinite(dateValue(date)) && myoConfig.peakPeriods.some(([,start,end]) => start <= date && date <= end);
}
/** @param {PetKind} kind @param {boolean} overnight */
function additional(kind,overnight) {
  const {rates,flags} = myoConfig;
  if (kind === 'dog') return overnight ? flags.overnightAdditionalPetRates.dog : rates.additionalDog;
  if (kind === 'cat') return overnight ? flags.overnightAdditionalPetRates.cat : rates.additionalCat;
  return flags.smallExoticPetRate.additional;
}
/** @param {EstimateInput} input @returns {Estimate} */
export function calculateEstimate({service,date,pets,duration,nights=1,lastMinute=false}) {
  const firstDay = dateValue(date);
  if (!Number.isFinite(firstDay) || !pets.length || !['walk','dropIn','overnight'].includes(service)) throw new RangeError('Invalid service, date, or pets.');
  const {rates,booking,flags} = myoConfig;
  const overnight = service === 'overnight';
  if (overnight && (!Number.isSafeInteger(nights) || nights < 1 || firstDay+nights*dayMs > 8.64e15)) throw new RangeError('Invalid night count.');
  if (!overnight && duration !== undefined && duration !== rates.visitMinutes && duration !== rates.longVisitMinutes) throw new RangeError('Invalid visit duration.');
  if (pets.some(pet => !['dog','cat','exotic'].includes(pet.kind)) || (service === 'walk' && pets.some(pet => pet.kind !== 'dog'))) throw new RangeError('Invalid pets for this service.');
  const [primary,...extra] = pets;
  const puppy = primary.kind === 'dog' && primary.ageYears != null && primary.ageYears >= 0 && primary.ageYears < booking.puppyAgeYears;
  let peakNights = 0;
  if (overnight) {
    const lastDay = firstDay+(nights-1)*dayMs;
    for (const [,start,end] of myoConfig.peakPeriods) {
      peakNights += Math.max(0,1+(Math.min(lastDay,dateValue(end))-Math.max(firstDay,dateValue(start)))/dayMs);
    }
  }
  const peak = isPeakDate(date);
  const visit = puppy ? (peak ? flags.peakPuppyRate : rates.puppy) :
    primary.kind === 'exotic' ? flags.smallExoticPetRate.base : peak ? rates.peakVisit : rates.visit;
  const lines = [
    {code:'base',cents:100*(overnight ? rates.overnight*nights : visit)},
    {code:'peakNights',cents:100*peakNights*rates.overnightPeakSurcharge},
    {code:'extension',cents:!overnight && duration === rates.longVisitMinutes ? 100*rates.extension : 0},
    {code:'extraPets',cents:100*extra.reduce((sum,pet)=>sum+additional(pet.kind,overnight),0)*(overnight ? nights : 1)},
    {code:'lastMinute',cents:lastMinute && flags.autoApplyLastMinuteFee ? 100*rates.lastMinute : 0},
  ].filter(line => line.code === 'base' || line.cents);
  const totalCents = lines.reduce((sum,line)=>sum+line.cents,0);
  const depositCents = Math.round(totalCents*booking.depositRatio);
  return {lines,totalCents,depositCents,balanceCents:totalCents-depositCents,
    requiresCustomQuote:pets.some(pet=>pet.kind==='exotic') && flags.smallExoticPetRate.requiresCustomQuote};
}
