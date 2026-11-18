// Availability: published windows, bookable start times and overlap checks.
import { get, all } from './db.mjs';
import { requireThat, integer } from './validate.mjs';
import { slotStep } from './domain.mjs';

const dayMs = 24*60*60_000;
const standingWindowId = 100_000_000_000;
const easternDay = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'America/New_York'});
const easternOffset = new Intl.DateTimeFormat('en-US',{timeZoneName:'longOffset',timeZone:'America/New_York'});
export const scheduleRules = () => get('SELECT * FROM schedule_settings WHERE id=1') || {days:62,opens:540,closes:1020,buffer:30};
export const dateExceptions = () => all('SELECT * FROM schedule_exceptions ORDER BY day');
const bufferMs = () => (get('SELECT buffer FROM schedule_settings WHERE id=1')?.buffer || 0)*60_000;
function easternTime(day, minutes) {
  const wall = Date.parse(day+'T00:00:00Z') + minutes*60_000;
  const offsetAt = timestamp => {
    const offset = easternOffset.formatToParts(timestamp).find(part => part.type === 'timeZoneName').value;
    const [,sign,hours,mins] = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
    return (sign === '+' ? 1 : -1)*(Number(hours)*60+Number(mins))*60_000;
  };
  const first = wall-offsetAt(wall);
  const second = wall-offsetAt(first);
  return offsetAt(second) === offsetAt(first) ? second : Math.max(first,second);
}
function standingWindow(day, rules, exception) {
  const weekday = new Date(day+'T12:00:00Z').getUTCDay();
  if (exception ? exception.opens === null : !rules.id || !(rules.days & (1<<weekday))) return null;
  const starts = easternTime(day,exception?.opens ?? rules.opens);
  const ends = easternTime(day,exception?.closes ?? rules.closes);
  return ends > starts ? {id:starts,starts,ends,standing:true} : null;
}
function dayAllowsWindow(window) {
  const first = easternDay.format(window.starts), last = easternDay.format(window.ends-1);
  return !get('SELECT 1 FROM schedule_exceptions WHERE opens IS NULL AND day BETWEEN ? AND ? LIMIT 1',first,last);
}
export const manualWindows = now => all('SELECT * FROM slots WHERE ends>? ORDER BY starts',now);

export function conflict(start, end, exclude, holdOwner = 0) {
  const buffer = bufferMs();
  return get("SELECT id FROM bookings WHERE id<>? AND (status IN ('Confirmed','In Progress') OR (status='Completed' AND ? > 0)) AND starts<? AND ends>?", exclude,buffer,end+buffer,start-buffer)
    || get('SELECT owner FROM checkout_holds WHERE owner<>? AND expires>? AND starts<? AND ends>?',holdOwner,Date.now(),end+buffer,start-buffer);
}
// Checks that a service can start at `start` inside window `slotId` and returns [starts, ends].
// Without `start` the window start is used, so older clients keep working.
export function reserveTime(slotId, service, exclude = 0, start, holdOwner = 0) {
  const id = integer(slotId);
  const slot = id >= standingWindowId ? upcomingWindows(Date.now()).find(window => window.id === id) :
    get('SELECT * FROM slots WHERE id=?',id);
  const begin = start === undefined ? slot?.starts : integer(start);
  requireThat(slot && begin > Date.now() && begin >= slot.starts && (begin - slot.starts) % slotStep === 0 && dayAllowsWindow({starts:begin,ends:begin+service.minutes*60_000}), 'This time is no longer available.', 409);
  const end = begin + service.minutes * 60_000;
  requireThat(end <= slot.ends, 'This service does not fit the appointment window.', 409);
  requireThat(!conflict(begin, end, exclude, holdOwner), 'This time has already been reserved.', 409);
  return [begin, end];
}
// Approval needs a published window that still covers the whole booking.
export const windowCovers = (starts, ends) => dayAllowsWindow({starts,ends}) &&
  upcomingWindows(starts-1).some(window => window.starts<=starts && window.ends>=ends);
export function upcomingWindows(now) {
  const rules = scheduleRules();
  const exceptions = new Map(dateExceptions().map(row => [row.day,row]));
  const today = Date.parse(easternDay.format(now)+'T12:00:00Z');
  const windows = manualWindows(now);
  for (let index=0; index<28; index++) {
    const day = new Date(today+index*dayMs).toISOString().slice(0,10);
    const window = standingWindow(day,rules,exceptions.get(day));
    if (window?.ends > now) windows.push(window);
  }
  return windows.sort((a,b) => a.starts-b.starts);
}
// Expands each published window into the start times a customer can book, with the services that fit at each.
export function bookableStarts(windows, services, now, holdOwner = 0) {
  const buffer = bufferMs();
  const held = all("SELECT starts,ends FROM bookings WHERE (status IN ('Confirmed','In Progress') OR (status='Completed' AND ? > 0)) AND ends>?",buffer,now-buffer);
  held.push(...all('SELECT starts,ends FROM checkout_holds WHERE owner<>? AND expires>?',holdOwner,now));
  const slots = [];
  const closed = dateExceptions().filter(row => row.opens === null).map(row => [
    easternTime(row.day,0),easternTime(new Date(Date.parse(row.day+'T12:00:00Z')+dayMs).toISOString().slice(0,10),0),
  ]);
  const offered = new Set();
  for (const window of windows) {
    for (let begin = window.starts; begin < window.ends; begin += slotStep) {
      if (begin <= now) continue;
      const service_ids = services.filter(service => {
        const end = begin + service.minutes * 60_000;
        const key = begin+':'+service.id;
        if (offered.has(key) || end > window.ends || closed.some(([a,b]) => a<end && b>begin) ||
            held.some(booking => booking.starts < end+buffer && booking.ends > begin-buffer)) return false;
        offered.add(key);
        return true;
      }).map(service => service.id);
      if (service_ids.length) slots.push({ id:window.id, starts:begin, ends:window.ends, service_ids });
    }
  }
  return slots;
}
