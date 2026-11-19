// Day-by-day availability (CUX-09): for each Massachusetts date, whether it is bookable, full, a peak date or inside the
// short-notice window, and its first start time. The booking flow uses it to label days and to preselect the first day
// without a short-notice fee. The same rules price the quote, so a label never disagrees with the total.
import { all } from './db.mjs';
import { config } from './config.mjs';
import { myoConfig, isPeakDate } from '../assets/myo-config.js';
import { upcomingWindows, bookableStarts, overnightNights } from './scheduling.mjs';
import { fullDays, dayOf } from './capacity.mjs';
import { activeRules } from './fees.mjs';

const dayMs = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const horizonDays = 28;

// Days of notice before a fee applies, by service kind. Launch mode: the configured 3 days for visits and 7 for stays.
// Catalog mode: an active short-notice fee rule, in hours. A Meet & Greet never carries a fee.
function noticeRule(kind) {
  if (kind === 'meet') return null;
  if (config.pricingMode !== 'catalog') return { days:kind === 'overnight' ? myoConfig.booking.overnightNoticeDays : myoConfig.booking.visitNoticeDays };
  const rule = activeRules().find(candidate => candidate.kind === 'short_notice');
  return rule ? { hours:rule.params.hours } : null;
}

/**
 * @param {{ now?:number, serviceId?:number|null }} options
 * @returns {{ service:number|null, kind:string, days:{ date:string, open:boolean, full:boolean, peak:boolean, last_minute:boolean,
 *   first_start:number|null, starts:number }[], notice:{ days?:number, hours?:number }|null, notice_free_from:string|null,
 *   default_day:string|null, default_reason:'notice_free'|'earliest_available'|'none', overnight_nights:string[] }}
 */
export function availabilityDays({ now = Date.now(), serviceId = null } = {}) {
  const services = all('SELECT * FROM services ORDER BY name, minutes');
  const service = serviceId ? services.find(row => row.id === serviceId) : null;
  const kind = service?.kind || 'visit';
  const today = dayOf(now);
  const last = addDays(today, horizonDays - 1);
  const full = fullDays(now, Date.parse(last + 'T23:59:59Z') + dayMs);
  const holidays = new Set(all('SELECT day FROM holidays').map(row => row.day));
  const notice = noticeRule(kind);
  // Start times per day, for this service (or any daytime service when none is given).
  const startsByDay = new Map();
  if (kind !== 'overnight') {
    const wanted = service ? [service] : services.filter(row => row.kind !== 'overnight');
    for (const slot of bookableStarts(upcomingWindows(now), wanted, now)) {
      const day = dayOf(slot.starts);
      if (!startsByDay.has(day)) startsByDay.set(day, []);
      startsByDay.get(day).push(slot.starts);
    }
  }
  const nights = new Set(overnightNights(now, 120).map(night => night.date));
  const lastMinute = (day, firstStart) => !notice ? false
    : notice.days !== undefined ? (Date.parse(day) - Date.parse(today)) / dayMs < notice.days
    : firstStart !== null && firstStart - now < notice.hours * 60 * 60_000;
  const days = [];
  for (let day = today; day <= last; day = addDays(day, 1)) {
    const starts = [...new Set(startsByDay.get(day) || [])].sort((a, b) => a - b);
    const open = kind === 'overnight' ? nights.has(day) : starts.length > 0;
    const firstStart = starts[0] ?? null;
    days.push({ date:day, open:open && !full.has(day), full:full.has(day),
      peak:config.pricingMode !== 'catalog' ? isPeakDate(day) : holidays.has(day),
      last_minute:lastMinute(day, firstStart), first_start:firstStart, starts:starts.length });
  }
  const noticeFree = days.find(day => !day.last_minute)?.date ?? null;
  const feeFree = days.find(day => day.open && !day.last_minute);
  const earliest = days.find(day => day.open);
  return { service:service?.id ?? null, kind, days, notice, notice_free_from:noticeFree,
    default_day:(feeFree || earliest)?.date ?? null, default_reason:feeFree ? 'notice_free' : earliest ? 'earliest_available' : 'none',
    overnight_nights:[...nights].sort() };
}

// The bookable start times for one service on one Massachusetts date, each with the window it belongs to, for guests
// choosing a time before they have an account (CUX-08). Full days return none.
export function availabilityTimes({ now = Date.now(), serviceId, date }) {
  const service = all('SELECT * FROM services WHERE id=?', serviceId)[0];
  if (!service || service.kind === 'overnight') return [];
  return bookableStarts(upcomingWindows(now), [service], now)
    .filter(slot => dayOf(slot.starts) === date)
    .map(slot => ({ slot:slot.id, start:slot.starts }))
    .sort((a, b) => a.start - b.start);
}
