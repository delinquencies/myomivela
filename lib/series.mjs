// Recurring visits (C3.3). A series is a weekly pattern (weekdays and a start time, Eastern) from one date until
// another (or open-ended). Bookings are generated for the next four weeks whenever the portal or the series list is
// read, each priced and checked like a single request; staff can let a series confirm itself. Dates further out are
// shown as projections only, so a price change applies to every visit not yet generated.
import { all, get, run } from './db.mjs';
import { slotStep } from './domain.mjs';
import {config} from './config.mjs';
import { priceBooking, checkLaunchCapacity } from './pricing.mjs';
import { blockers, availableMeet } from './compliance.mjs';
import { recordVersion } from './care.mjs';
import { notify, bookingParams } from './outbox.mjs';
import { easternTime, reserveTime, upcomingWindows } from './scheduling.mjs';

const dayMs = 86_400_000;
export const generateDays = 28;
export const projectDays = 56;
const easternDay = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' });
export const today = (now = Date.now()) => easternDay.format(now);
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();
// A booking starting sooner than this is not generated: Myomi needs notice for a visit nobody asked for today.
const minimumNotice = 2 * 60 * 60_000;

// The dates of a series between `first` and `last` (inclusive) that match its pattern.
export function patternDays(series, first, last) {
  const days = [];
  const start = series.from_day > first ? series.from_day : first;
  const end = series.until_day && series.until_day < last ? series.until_day : last;
  for (let day = start; day <= end; day = addDays(day, 1)) if (series.weekdays & (1 << weekday(day))) days.push(day);
  return days;
}

// Why a date could not be booked, or null after booking it.
function bookDay(series, day, service, owner, petIds, windows, now) {
  const starts = easternTime(day, series.start_minute);
  const ends = starts + service.minutes * 60_000;
  if (starts - now < minimumNotice) return 'too_soon';
  const window = windows.find(w => w.starts <= starts && w.ends >= ends && (starts - w.starts) % slotStep === 0);
  if (!window) return 'unavailable';
  try { reserveTime(window.id, service, 0, starts, 0); checkLaunchCapacity(starts,ends); } catch (error) { return error.code || 'unavailable'; }
  if (blockers(owner, { service, petIds, starts, ends }).length) return 'blocked';
  const pets=petIds.map(id=>get('SELECT * FROM pets WHERE id=?',id));
  const { lines, total_cents } = priceBooking({ service, pets, petCount:petIds.length, starts, ends, now });
  const meet=config.pricingMode==='launch'?availableMeet(owner.id)?.id:null;
  const status = series.auto_approve ? 'Confirmed' : 'Requested';
  const id = run('INSERT INTO bookings(owner,service,starts,ends,cents,notes,status,series,series_day,meet_booking,primary_pet,created,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    series.owner, service.id, starts, ends, total_cents, series.notes, status, series.id, day, meet||null,petIds[0], now, status === 'Confirmed' ? now : null).lastInsertRowid;
  for (const pet of petIds) run('INSERT INTO booking_pets(booking,pet,profile_version) VALUES(?,?,?)', id, pet, status === 'Confirmed' ? recordVersion(pet, now) : null);
  lines.forEach((line, position) => run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',
    id, position, line.code, line.label, line.quantity, line.cents));
  notify(status === 'Requested' ? 'staff' : series.owner, status === 'Requested' ? 'request_received' : 'booking_confirmed', bookingParams(id),
    (status === 'Requested' ? 'request:' : 'confirmed:') + id);
  return null;
}

// Generates the next four weeks of every active series (or one). Synchronous: call it inside a transaction.
// Returns { [seriesId]: { [day]: reason } } for the dates that could not be booked this time.
export function generateSeries(now = Date.now(), only = null) {
  const active = all('SELECT * FROM recurring_series WHERE paused=0 AND ended IS NULL' + (only ? ' AND id=?' : ''), ...(only ? [only] : []));
  const problems = {};
  if (!active.length) return problems;
  const windows = upcomingWindows(now);
  const first = today(now), last = addDays(first, generateDays - 1);
  for (const series of active) {
    const service = get('SELECT * FROM services WHERE id=?', series.service);
    const owner = get('SELECT * FROM users WHERE id=?', series.owner);
    const petIds = JSON.parse(series.pets).filter(id => get('SELECT id FROM pets WHERE id=? AND owner=?', id, series.owner));
    if (!service || !owner || !petIds.length) continue;
    const skipped = new Set(all('SELECT day FROM series_skips WHERE series=?', series.id).map(row => row.day));
    const done = new Set(all('SELECT series_day FROM bookings WHERE series=? AND series_day IS NOT NULL', series.id).map(row => row.series_day));
    for (const day of patternDays(series, first, last)) {
      if (skipped.has(day) || done.has(day)) continue;
      const reason = bookDay(series, day, service, owner, petIds, windows, now);
      if (reason) (problems[series.id] ??= {})[day] = reason;
    }
  }
  return problems;
}

// A series as the API returns it, with eight weeks of dates: booked (with the booking), skipped, conflict (inside
// the generated four weeks but not bookable, with the reason) or projected (later, or while paused).
export function seriesView(series, problems = {}, now = Date.now()) {
  const first = today(now);
  const generatedUntil = addDays(first, generateDays - 1);
  const skipped = new Set(all('SELECT day FROM series_skips WHERE series=?', series.id).map(row => row.day));
  const bookings = new Map(all('SELECT id, status, starts, series_day FROM bookings WHERE series=? AND series_day IS NOT NULL', series.id)
    .map(row => [row.series_day, row]));
  const service = get('SELECT name, minutes, kind FROM services WHERE id=?', series.service);
  const projections = patternDays(series, first, addDays(first, projectDays - 1)).map(day => {
    const booking = bookings.get(day);
    const starts = booking?.starts ?? easternTime(day, series.start_minute);
    if (skipped.has(day)) return { date:day, starts, status:'skipped' };
    if (booking) return { date:day, starts, status:'booked', booking:{ id:booking.id, status:booking.status } };
    if (day <= generatedUntil && !series.paused && !series.ended) return { date:day, starts, status:'conflict', reason:problems[day] || 'unavailable' };
    return { date:day, starts, status:'projected' };
  });
  const weekdays = [0,1,2,3,4,5,6].filter(day => series.weekdays & (1 << day));
  const time = String(Math.floor(series.start_minute / 60)).padStart(2, '0') + ':' + String(series.start_minute % 60).padStart(2, '0');
  return { id:series.id, owner:series.owner, customer:get('SELECT name FROM users WHERE id=?', series.owner)?.name,
    service:series.service, service_name:service?.name, pets:JSON.parse(series.pets), weekdays, time, from:series.from_day,
    until:series.until_day, notes:series.notes, auto_approve:Boolean(series.auto_approve), paused:Boolean(series.paused),
    ended:series.ended, projections };
}
