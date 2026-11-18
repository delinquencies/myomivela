// Availability: published windows, bookable start times and overlap checks.
import { get, all } from './db.mjs';
import { requireThat, integer } from './validate.mjs';
import { slotStep, maxStayNights } from './domain.mjs';
import { config } from './config.mjs';

const dayMs = 24*60*60_000;
const standingWindowId = 100_000_000_000;
const easternDay = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'America/New_York'});
const easternOffset = new Intl.DateTimeFormat('en-US',{timeZoneName:'longOffset',timeZone:'America/New_York'});
export const scheduleRules = () => get('SELECT * FROM schedule_settings WHERE id=1') || {days:62,opens:540,closes:1020,buffer:30,overnight_days:0,late_pickup_grace:120};
export const dateExceptions = () => all('SELECT * FROM schedule_exceptions ORDER BY day');
// Staff may start a visit this many minutes before its booked time: the visit buffer (30 by default),
// unless MYO_EARLY_START_MINUTES overrides it. Starting late is always allowed.
export const earlyStartMinutes = () => config.earlyStartMinutes ?? scheduleRules().buffer;
const bufferMs = () => (get('SELECT buffer FROM schedule_settings WHERE id=1')?.buffer || 0)*60_000;
export function easternTime(day, minutes) {
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

// The intervals a booking occupies when compared with a booking of `otherKind`. Myomi can do daytime visits during
// an overnight stay, so against a visit a stay only occupies its arrival and departure blocks; against another stay,
// all of it.
const intervals = (row, otherKind) => row.kind === 'overnight' && otherKind !== 'overnight'
  ? [[row.starts, row.starts + slotStep], [row.ends - slotStep, row.ends]] : [[row.starts, row.ends]];
const clashes = (a, b, buffer) => intervals(a, b.kind).some(([s1, e1]) =>
  intervals(b, a.kind).some(([s2, e2]) => s2 < e1 + buffer && e2 > s1 - buffer));
// Bookings and other customers' holds that take time between `from` and `to`, with their service kind.
function busyRows(from, to, exclude, holdOwner, buffer) {
  return [
    ...all("SELECT b.starts, b.ends, s.kind FROM bookings b JOIN services s ON s.id=b.service WHERE b.id<>? AND (b.status IN ('Confirmed','In Progress') OR (b.status='Completed' AND ? > 0)) AND b.starts<? AND b.ends>?",
      exclude, buffer, to, from),
    ...all('SELECT h.starts, h.ends, s.kind FROM checkout_holds h JOIN services s ON s.id=h.service WHERE h.owner<>? AND h.expires>? AND h.starts<? AND h.ends>?',
      holdOwner, Date.now(), to, from),
  ];
}
export function conflict(start, end, exclude, holdOwner = 0, kind = 'visit') {
  const buffer = bufferMs();
  const candidate = { starts:start, ends:end, kind };
  return busyRows(start - buffer, end + buffer, exclude, holdOwner, buffer).find(row => clashes(candidate, row, buffer));
}
// Checks that a service can start at `start` inside window `slotId` and returns [starts, ends].
// Without `start` the window start is used, so older clients keep working.
export function reserveTime(slotId, service, exclude = 0, start, holdOwner = 0) {
  const id = integer(slotId);
  const slot = id >= standingWindowId ? upcomingWindows(Date.now()).find(window => window.id === id) :
    get('SELECT * FROM slots WHERE id=?',id);
  const begin = start === undefined ? slot?.starts : integer(start);
  requireThat(slot && begin > Date.now() && begin >= slot.starts && (begin - slot.starts) % slotStep === 0 && dayAllowsWindow({starts:begin,ends:begin+service.minutes*60_000}), 'This time is no longer available.', 409, 'time_unavailable');
  const end = begin + service.minutes * 60_000;
  requireThat(end <= slot.ends, 'This service does not fit the appointment window.', 409, 'window_too_short');
  requireThat(!conflict(begin, end, exclude, holdOwner, service.kind), 'This time has already been reserved.', 409, 'time_reserved');
  return [begin, end];
}

// Overnight stays (C2.1). A stay's nights are the Eastern dates from arrival up to, not including, departure.
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
const nextDay = day => new Date(Date.parse(day + 'T12:00:00Z') + dayMs).toISOString().slice(0, 10);
function datesFrom(first, last) {
  const dates = [];
  for (let day = first; day <= last && dates.length < 400; day = nextDay(day)) dates.push(day);
  return dates;
}
export function stayNights(arrive, depart) {
  const departureDay = easternDay.format(depart);
  return datesFrom(easternDay.format(arrive), departureDay).filter(day => day < departureDay);
}
// Checks a stay from `arrive` to `depart` (epoch ms on the half hour) and returns [arrive, depart, nights].
export function reserveStay(arrive, depart, exclude = 0, holdOwner = 0) {
  arrive = integer(arrive); depart = integer(depart);
  requireThat(arrive > Date.now() && depart > arrive && arrive % slotStep === 0 && depart % slotStep === 0,
    'Choose a future drop-off and a later pickup, on the hour or half hour.', 409, 'time_unavailable');
  const nights = stayNights(arrive, depart);
  requireThat(nights.length >= 1 && nights.length <= maxStayNights, 'A stay is 1 to '+maxStayNights+' nights.', 409, 'stay_length');
  const rules = scheduleRules();
  const unavailable = nights.find(day => !(rules.overnight_days & (1 << weekday(day))));
  requireThat(!unavailable, 'Myomi isn’t taking overnight stays on '+unavailable+'.', 409, 'night_unavailable', { day:unavailable });
  // Myomi must be working on every day of the stay, including the departure day.
  const closed = get('SELECT day FROM schedule_exceptions WHERE opens IS NULL AND day BETWEEN ? AND ? ORDER BY day LIMIT 1',
    easternDay.format(arrive), easternDay.format(depart))?.day;
  requireThat(!closed, 'Myomi is unavailable on '+closed+'.', 409, 'night_unavailable', { day:closed });
  requireThat(!conflict(arrive, depart, exclude, holdOwner, 'overnight'), 'Those times overlap another booking.', 409, 'time_reserved');
  return [arrive, depart, nights];
}
// The next `count` nights a new stay could include (within the next 120 days), for customers choosing dates.
export function overnightNights(now, count = 60, holdOwner = 0) {
  const rules = scheduleRules();
  if (!rules.overnight_days) return [];
  const today = easternDay.format(now);
  const last = new Date(Date.parse(today + 'T12:00:00Z') + 120 * dayMs).toISOString().slice(0, 10);
  const closed = new Set(all('SELECT day FROM schedule_exceptions WHERE opens IS NULL').map(row => row.day));
  const taken = new Set();
  const stays = [
    ...all("SELECT b.starts, b.ends FROM bookings b JOIN services s ON s.id=b.service WHERE s.kind='overnight' AND b.status IN ('Confirmed','In Progress') AND b.ends>?", now),
    ...all("SELECT h.starts, h.ends FROM checkout_holds h JOIN services s ON s.id=h.service WHERE s.kind='overnight' AND h.owner<>? AND h.expires>?", holdOwner, now),
  ];
  for (const stay of stays) for (const day of stayNights(stay.starts, stay.ends)) taken.add(day);
  return datesFrom(today, last).filter(day => (rules.overnight_days & (1 << weekday(day))) && !closed.has(day) && !taken.has(day))
    .slice(0, count).map(date => ({ date }));
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
  services = services.filter(service => service.kind !== 'overnight'); // stays are chosen by night, not by start time
  const held = busyRows(now - buffer, Number.MAX_SAFE_INTEGER, 0, holdOwner, buffer);
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
            held.some(row => clashes({ starts:begin, ends:end, kind:service.kind }, row, buffer))) return false;
        offered.add(key);
        return true;
      }).map(service => service.id);
      if (service_ids.length) slots.push({ id:window.id, starts:begin, ends:window.ends, service_ids });
    }
  }
  return slots;
}
