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
