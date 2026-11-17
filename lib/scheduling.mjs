// Availability: published windows, bookable start times and overlap checks.
import { get, all } from './db.mjs';
import { requireThat, integer } from './validate.mjs';
import { slotStep } from './domain.mjs';

export function conflict(start, end, exclude) {
  return get("SELECT id FROM bookings WHERE id<>? AND status IN ('Confirmed','In Progress') AND starts<? AND ends>?", exclude, end, start);
}
// Checks that a service can start at `start` inside window `slotId` and returns [starts, ends].
// Without `start` the window start is used, so older clients keep working.
export function reserveTime(slotId, service, exclude = 0, start) {
  const slot = get('SELECT * FROM slots WHERE id=?', integer(slotId));
  const begin = start === undefined ? slot?.starts : integer(start);
  requireThat(slot && begin > Date.now() && begin >= slot.starts && (begin - slot.starts) % slotStep === 0, 'This time is no longer available.', 409);
  const end = begin + service.minutes * 60_000;
  requireThat(end <= slot.ends, 'This service does not fit the appointment window.', 409);
  requireThat(!conflict(begin, end, exclude), 'This time has already been reserved.', 409);
  return [begin, end];
}
// Approval needs a published window that still covers the whole booking.
export const windowCovers = (starts, ends) => get('SELECT 1 FROM slots WHERE starts<=? AND ends>=? LIMIT 1', starts, ends);
export const upcomingWindows = now => all('SELECT * FROM slots WHERE ends>? ORDER BY starts', now);
// Expands each published window into the start times a customer can book, with the services that fit at each.
export function bookableStarts(windows, services, now) {
  const held = all("SELECT starts,ends FROM bookings WHERE status IN ('Confirmed','In Progress') AND ends>?", now);
  const slots = [];
  for (const window of windows) {
    for (let begin = window.starts; begin < window.ends; begin += slotStep) {
      if (begin <= now) continue;
      const service_ids = services.filter(service => {
        const end = begin + service.minutes * 60_000;
        return end <= window.ends && !held.some(booking => booking.starts < end && booking.ends > begin);
      }).map(service => service.id);
      if (service_ids.length) slots.push({ id:window.id, starts:begin, ends:window.ends, service_ids });
    }
  }
  return slots;
}
