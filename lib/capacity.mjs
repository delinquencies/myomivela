// Daily capacity (launch mode): how many scheduled visits and stays occupy each Massachusetts calendar day. The quote,
// hold, approval and availability all count the same way, so a day shown as open is a day the quote will accept.
import { all } from './db.mjs';
import { config } from './config.mjs';
import { myoConfig } from '../assets/myo-config.js';

const easternDay = new Intl.DateTimeFormat('sv-SE', { dateStyle:'short', timeZone:myoConfig.business.timeZone });
export const dayOf = ms => easternDay.format(ms);
const nextDay = day => new Date(Date.parse(day + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
export const capacityApplies = () => config.pricingMode !== 'catalog';

// { 'YYYY-MM-DD': count } for scheduled bookings (Confirmed, In Progress, Completed) touching [from, to).
export function dayLoad(from, to, exclude = 0) {
  const counts = {};
  const rows = all("SELECT starts, ends FROM bookings WHERE status IN ('Confirmed','In Progress','Completed') AND id<>? AND starts<? AND ends>?",
    exclude, to + 86_400_000, from - 86_400_000);
  for (const row of rows) {
    const last = dayOf(row.ends - 1);
    for (let day = dayOf(row.starts); day <= last; day = nextDay(day)) counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}
// The Massachusetts days in [from, to) that have reached capacity. Empty in catalog mode.
export function fullDays(from, to, exclude = 0) {
  if (!capacityApplies()) return new Set();
  const load = dayLoad(from, to, exclude);
  return new Set(Object.keys(load).filter(day => load[day] >= myoConfig.business.capacity));
}
