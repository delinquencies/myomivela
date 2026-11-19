// Public booking discovery (CUX-08): a ZIP check against the service area, and a real-date price without an account.
// Neither creates a hold or a booking, reads a customer's records, or reveals who else is booked.
import { get } from '../db.mjs';
import { requireThat, integer } from '../validate.mjs';
import { limitPublic } from '../auth.mjs';
import { eligibility } from '../service-area.mjs';
import { priceBooking, checkLaunchCapacity } from '../pricing.mjs';
import { quoteTerms } from '../quote-terms.mjs';
import { reserveTime, reserveStay, stayNights, upcomingWindows, requireMeetNotice } from '../scheduling.mjs';
import { slotStep } from '../domain.mjs';

const petKinds = ['dog','cat','exotic'];
// A guest describes pets by kind and age; pricing reads them the same way it reads saved pet profiles.
function guestPets(pets) {
  requireThat(Array.isArray(pets) && pets.length >= 1 && pets.length <= 12, 'Tell us about at least one pet.', 400, 'invalid_pets');
  return pets.map(pet => {
    requireThat(pet && petKinds.includes(pet.kind), 'Choose dog, cat or another small pet.', 400, 'invalid_pets');
    const age = pet.age_years;
    requireThat(age === undefined || age === null || (typeof age === 'number' && age >= 0 && age <= 40), 'Enter an age in years.', 400, 'invalid_pets');
    return { species:pet.kind === 'exotic' ? 'Small pet' : pet.kind, details:JSON.stringify(typeof age === 'number' ? { age:String(age) } : {}) };
  });
}

function windowFor(start, service) {
  const window = upcomingWindows(Date.now()).find(candidate => candidate.starts <= start
    && start + service.minutes * 60_000 <= candidate.ends && (start - candidate.starts) % slotStep === 0);
  requireThat(window, 'This time is no longer available.', 409, 'time_unavailable');
  return window.id;
}

export default [
  { method:'GET', path:'/api/eligibility', access:'public', before:limitPublic, handler:({ url }) => eligibility(url.searchParams.get('zip')) },

  // { service, pets:[{ kind, age_years? }], slot, start } for a visit or { service, pets, arrive, depart } for a stay;
  // `zip` (optional) adds the eligibility result. Same pricing as the signed-in quote; customers re-quote from their
  // saved pets before a hold, so a difference shows up as price_changed there.
  { method:'POST', path:'/api/public-quote', access:'public', before:limitPublic, handler:({ data }) => {
    const service = get('SELECT * FROM services WHERE id=?', integer(data.service));
    requireThat(service, 'Service not found.', 404);
    const pets = guestPets(data.pets);
    // `primary_pet` (an index into `pets`) names the pet priced at the base rate; otherwise the first one is.
    const primary = data.primary_pet ?? 0;
    requireThat(Number.isSafeInteger(primary) && primary >= 0 && primary < pets.length, 'Choose the primary pet from the pets listed.', 400, 'invalid_primary_pet');
    pets.unshift(...pets.splice(primary, 1));
    // A guest may send just the start time; the window it falls in is found here.
    const slot = data.slot ?? (service.kind === 'overnight' ? undefined : windowFor(integer(data.start), service));
    const [starts, ends] = service.kind === 'overnight'
      ? reserveStay(data.arrive, data.depart, 0, 0).slice(0, 2)
      : reserveTime(slot, service, 0, data.start, 0);
    checkLaunchCapacity(starts, ends);
    requireMeetNotice(service, starts);
    const nights = service.kind === 'overnight' ? stayNights(starts, ends) : [];
    const { lines, total_cents } = priceBooking({ service, petCount:pets.length, pets, starts, ends, nights });
    return { estimate:true, service:service.id, starts, ends, lines, total_cents, primary_pet:primary,
      ...quoteTerms({ service, starts, ends, nights, lines, total_cents }),
      ...(data.zip === undefined ? {} : { eligibility:eligibility(data.zip) }) };
  } },
];
