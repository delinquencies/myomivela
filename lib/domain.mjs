// Business constants shared by the routes.
export const serviceNames = ['Dog walking','Drop-in visit','Overnight pet sitting'];
export const activityTypes = ['Feeding','Water','Walk started','Walk completed','Potty','Medication','Playtime','Rest','Observation','Custom'];
// Allowed staff status changes. Customers may only cancel their own future Requested or Confirmed bookings.
export const transitions = {
  Requested: ['Confirmed','Cancelled'],
  Confirmed: ['In Progress','Cancelled'],
  'In Progress': ['Completed'],
};
// Appointments may start at any step inside a published window, measured from the window start.
export const slotStep = 30 * 60_000;
