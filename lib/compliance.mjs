// Booking gates (C2.2): required vaccines, the current service agreement, and a meet & greet before a first stay.
// Each gate is opt-in: it applies only once Myomi has set vaccine requirements, published an agreement, or offers a
// Meet & Greet service. blockers() is used by quotes (as information) and by holds and requests (which refuse).
import { get, all } from './db.mjs';
import { requireThat } from './validate.mjs';
import {config} from './config.mjs';

/** @typedef {{ code:'vaccine_missing'|'vaccine_expired'|'vaccine_expires_during'|'agreement_required'|'meet_required',
 *   pet_id?:number, vaccine?:string, expires?:string, message:string }} Blocker */

const easternDay = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' });
// Species are typed freely; requirements are matched on a normalised name.
export function speciesKey(species) {
  const value = String(species || '').trim().toLowerCase();
  if (/^(dogs?|pupp(?:y|ies)|canine|perr[oa]s?|cachorr[oa]s?|canin[oa]s?)$/.test(value)) return 'dog';
  if (/^(cats?|kittens?|feline|gat(?:it)?[oa]s?|felin[oa]s?)$/.test(value)) return 'cat';
  return value;
}
export const requirements = () => {
  const bySpecies = {};
  for (const row of all('SELECT species, name FROM vaccine_requirements ORDER BY species, name')) (bySpecies[row.species] ||= []).push(row.name);
  return bySpecies;
};
export const latestAgreement = () => get('SELECT * FROM agreements ORDER BY version DESC LIMIT 1');
export const availableMeet = (owner,exclude=0) => get(`SELECT b.id FROM bookings b JOIN services s ON s.id=b.service
  WHERE b.owner=? AND b.status='Completed' AND s.kind='meet'
  AND NOT EXISTS(SELECT 1 FROM bookings used WHERE used.meet_booking=b.id AND used.status<>'Cancelled' AND used.id<>?)
  ORDER BY b.id DESC LIMIT 1`,owner,exclude);
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

// Status of one vaccine for display: ok, due_soon (within 30 days), expired, or missing.
export function vaccineStatus(expires, today = easternDay.format(Date.now())) {
  if (!expires) return 'missing';
  if (expires < today) return 'expired';
  return expires <= addDays(today, 30) ? 'due_soon' : 'ok';
}
// Each pet's vaccine records plus a 'missing' entry for every required vaccine it has no record of.
export function vaccinesFor(pets) {
  const required = requirements();
  const out = {};
  for (const pet of pets) {
    const records = all('SELECT * FROM pet_vaccines WHERE pet=? ORDER BY name', pet.id).map(record => ({
      id:record.id, name:record.name, given:record.given, expires:record.expires, verified:Boolean(record.verified_at),
      status:vaccineStatus(record.expires), has_document:Boolean(record.document_key),
    }));
    const missing = (required[speciesKey(pet.species)] || []).filter(name => !records.some(record => record.name === name))
      .map(name => ({ id:null, name, given:null, expires:null, verified:false, status:'missing', has_document:false }));
    out[pet.id] = [...records, ...missing];
  }
  return out;
}

/** @returns {Blocker[]} */
export function blockers(user, { service, petIds, starts, ends, bookingId=0 }) {
  const found = [];
  if (service.kind !== 'meet') {
    const required = requirements();
    const firstDay = easternDay.format(starts), lastDay = easternDay.format(ends - 1);
    for (const id of petIds) {
      const pet = get('SELECT id, name, species FROM pets WHERE id=?', id);
      for (const name of required[speciesKey(pet.species)] || []) {
        const record = get('SELECT expires FROM pet_vaccines WHERE pet=? AND name=?', id, name);
        if (!record) found.push({ code:'vaccine_missing', pet_id:id, vaccine:name, message:pet.name+' needs a '+name+' vaccination on file.' });
        else if (record.expires < firstDay) found.push({ code:'vaccine_expired', pet_id:id, vaccine:name, expires:record.expires, message:pet.name+'’s '+name+' vaccination expired on '+record.expires+'.' });
        else if (record.expires < lastDay) found.push({ code:'vaccine_expires_during', pet_id:id, vaccine:name, expires:record.expires, message:pet.name+'’s '+name+' vaccination expires on '+record.expires+', during this booking.' });
      }
    }
  }
  const agreement = latestAgreement();
  if (agreement && !get('SELECT 1 FROM agreement_acceptances WHERE user=? AND version=?', user.id, agreement.version)) {
    found.push({ code:'agreement_required', message:'Please read and accept the service agreement (version '+agreement.version+') first.' });
  }
  if (config.pricingMode === 'launch' && service.kind !== 'meet') {
    const intake=get('SELECT body FROM care_intakes WHERE owner=?',user.id);
    const saved=intake?JSON.parse(intake.body):null;
    if (!saved || (service.kind === 'overnight' && !saved.overnightAcknowledgment)) found.push({code:'intake_required',message:'Complete your care intake before requesting this service.'});
    if (!availableMeet(user.id,bookingId)) found.push({code:'meet_required',message:'Complete a complimentary Meet & Greet for this booking.'});
  } else if (service.kind === 'overnight' && get("SELECT 1 FROM services WHERE kind='meet' LIMIT 1")
      && !get("SELECT 1 FROM bookings WHERE owner=? AND status='Completed' LIMIT 1", user.id)) {
    found.push({ code:'meet_required', message:'Book a free Meet & Greet before your first overnight stay.' });
  }
  return found;
}
// Refuses a hold or request that a gate blocks, listing every reason.
export function requireNoBlockers(user, selection) {
  const found = blockers(user, selection);
  requireThat(!found.length, found.map(blocker => blocker.message).join(' '), 409, 'blocked', { blockers:found });
}
