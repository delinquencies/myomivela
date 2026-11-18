// Itemised prices. Every booking's total is the sum of its lines, computed on the server only.
// Phase 1 lines: the service itself and extra pets. Later lines (nightly, late pickup, fee rules) are added here.

/** @typedef {{ code:string, label:string, quantity:number, cents:number }} QuoteLine */

// service: a services row. petCount: pets on the booking (at least 1).
export function quote({ service, petCount }) {
  /** @type {QuoteLine[]} */
  const lines = [{ code:'base', label:service.name, quantity:1, cents:service.cents }];
  const extraPets = Math.max(0, petCount - 1);
  if (extraPets && service.extra_pet_cents) {
    lines.push({ code:'extra_pet', label:'Extra pet', quantity:extraPets, cents:extraPets * service.extra_pet_cents });
  }
  return { lines, total_cents:lines.reduce((sum, line) => sum + line.cents, 0) };
}
