// Business constants shared by the routes.
// Each service has a kind (C1.4): a 'visit' (walks, drop-ins), a free 'meet' (meet & greet) or an 'overnight' stay.
// Overnight stays are priced and booked like visits until C2.1 gives them their own model.
export const serviceCatalog = [
  { name:'Dog walking', kind:'visit' },
  { name:'Drop-in visit', kind:'visit' },
  { name:'Overnight pet sitting', kind:'overnight' },
  { name:'Meet & Greet', kind:'meet' },
];
export const serviceNames = serviceCatalog.map(service => service.name);
export const serviceKind = name => serviceCatalog.find(service => service.name === name)?.kind;
export const activityTypes = ['Feeding','Water','Walk started','Walk completed','Potty','Medication','Playtime','Rest','Observation','Custom',
  'Arrival','Evening check-in','Morning check-in','Departure']; // the last four are the check-ins of an overnight stay
// Report cards (C2.4): structured answers an update can carry, by service kind and activity.
// FieldDef = { id, label, type:'yesno'|'count'|'choice', options?, min?, max?, hideWhen?:'no'|'zero' }.
// hideWhen hides an unremarkable answer from the customer (staff still see it). Medication answers are never hidden.
const walkFields = [
  { id:'pee', label:'Pee', type:'yesno', hideWhen:'no' },
  { id:'poop', label:'Poop', type:'yesno', hideWhen:'no' },
  { id:'water', label:'Water', type:'yesno', hideWhen:'no' },
  { id:'minutes', label:'Minutes walked', type:'count', min:0, max:240, hideWhen:'zero' },
];
const feedingFields = [
  { id:'ate', label:'Ate', type:'choice', options:['All','Most','Some','None'] },
  { id:'water', label:'Water refreshed', type:'yesno', hideWhen:'no' },
];
const pottyFields = [
  { id:'pee', label:'Pee', type:'yesno', hideWhen:'no' },
  { id:'poop', label:'Poop', type:'yesno', hideWhen:'no' },
];
const medicationFields = [{ id:'given', label:'Medication given', type:'yesno' }];
const checkInFields = [
  { id:'fed', label:'Fed', type:'yesno' },
  { id:'water', label:'Water refreshed', type:'yesno', hideWhen:'no' },
  { id:'outside', label:'Outside / litter', type:'yesno', hideWhen:'no' },
];
const visitCards = { 'Walk completed':walkFields, Feeding:feedingFields, Potty:pottyFields, Medication:medicationFields };
export const reportFields = {
  visit:visitCards,
  overnight:{ ...visitCards, 'Evening check-in':checkInFields, 'Morning check-in':checkInFields },
  meet:{},
};
// An overnight stay is 1 to this many nights.
export const maxStayNights = 28;
// Allowed staff status changes. Customers may only cancel their own future Requested or Confirmed bookings.
export const transitions = {
  Requested: ['Confirmed','Cancelled'],
  Confirmed: ['In Progress','Cancelled'],
  'In Progress': ['Completed'],
};
// Appointments may start at any step inside a published window, measured from the window start.
export const slotStep = 30 * 60_000;
