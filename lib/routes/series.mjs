// Recurring visits (C3.3): create, list, pause, skip a date, end, and (staff) let a series confirm itself.
import { all, get, run, transaction } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { slotStep } from '../domain.mjs';
import { cancellationTerms } from '../cancellation.mjs';
import { generateSeries, seriesView, today, addDays } from '../series.mjs';

const maxActiveSeries = 10;
const validDay = day => {
  const date = new Date(day + 'T12:00:00Z');
  requireThat(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+date) && date.toISOString().slice(0, 10) === day,
    'Choose a valid date.', 400, 'invalid_date');
  return day;
};
function seriesFor(user, id) {
  const series = get('SELECT * FROM recurring_series WHERE id=?', integer(id));
  requireThat(series && (user.admin || series.owner === user.id), 'Recurring visit not found.', 404);
  return series;
}
// Cancels a generated, still-upcoming booking for one date. A confirmed one follows the cancellation policy: the
// customer must accept any fee, exactly as when cancelling a single visit.
function cancelOccurrence(user, booking, acceptFee) {
  if (!booking || !['Requested','Confirmed'].includes(booking.status) || booking.starts <= Date.now()) return;
  const fee = user.admin ? 0 : cancellationTerms(booking).fee_cents;
  requireThat(!fee || acceptFee === fee, 'Skipping this visit now has a cancellation fee. Review it first.', 409, 'cancel_fee_changed', { fee_cents:fee });
  run("UPDATE bookings SET status='Cancelled', cancel_fee_cents=? WHERE id=?", fee, booking.id);
  run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE booking=? AND status='Pending'", Date.now(), booking.id);
}
const listing = (user, problems = {}) => all('SELECT * FROM recurring_series WHERE ' + (user.admin ? '1' : 'owner=?') + ' ORDER BY ended IS NOT NULL, id',
  ...(user.admin ? [] : [user.id])).map(series => seriesView(series, problems[series.id]));

export default [
  { method:'GET', path:'/api/series', access:'user', handler:({ user }) => ({ series:listing(user, transaction(() => generateSeries())) }) },

  // { service, pets:[ids], weekdays:[0–6, 0 = Sunday], time:'HH:MM' Eastern, from:'YYYY-MM-DD', until?, notes? }
  { method:'POST', path:'/api/series', access:'user', handler:({ user, data }) => transaction(() => {
    requireThat(!user.admin, 'Use a customer account to set up recurring visits.', 403);
    const service = get('SELECT * FROM services WHERE id=?', integer(data.service));
    requireThat(service, 'Service not found.', 404);
    requireThat(service.kind === 'visit', 'Recurring visits are for walks and drop-in visits.', 400, 'series_visits_only');
    requireThat(Array.isArray(data.pets) && data.pets.length && data.pets.length <= 12, 'Choose at least one pet.');
    const pets = [...new Set(data.pets.map(value => integer(value)))];
    for (const id of pets) requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?', id, user.id), 'Pet not found.', 404);
    requireThat(Array.isArray(data.weekdays) && data.weekdays.length && data.weekdays.length <= 7, 'Choose the days of the week.');
    const weekdays = data.weekdays.reduce((mask, day) => mask | (1 << integer(day, 6, 0)), 0);
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(data.time || '');
    requireThat(match, 'Enter a valid time.');
    const minute = Number(match[1]) * 60 + Number(match[2]);
    requireThat(minute * 60_000 % slotStep === 0, 'Choose a time on the hour or half hour.', 400, 'invalid_time');
    const from = validDay(data.from);
    requireThat(from >= today(), 'Choose a start date from today on.', 400, 'invalid_date');
    const until = data.until === undefined || data.until === null || data.until === '' ? null : validDay(data.until);
    requireThat(!until || (until >= from && until <= addDays(from, 366)), 'Choose an end date within a year of the start.', 400, 'invalid_date');
    requireThat(get('SELECT COUNT(*) AS count FROM recurring_series WHERE owner=? AND ended IS NULL', user.id).count < maxActiveSeries,
      'You have the most recurring visits allowed. End one first.', 409, 'series_limit');
    const id = run('INSERT INTO recurring_series(owner,service,pets,weekdays,start_minute,from_day,until_day,notes,created) VALUES(?,?,?,?,?,?,?,?,?)',
      user.id, service.id, JSON.stringify(pets), weekdays, minute, from, until, field(data.notes ?? '', 1500, false), Date.now()).lastInsertRowid;
    const problems = generateSeries(Date.now(), id);
    return { series:seriesView(get('SELECT * FROM recurring_series WHERE id=?', id), problems[id]) };
  }) },

  // Pausing stops new dates being booked; visits already booked stay, and can be cancelled one by one.
  { method:'POST', path:'/api/series/pause', access:'user', handler:({ user, data }) => transaction(() => {
    const series = seriesFor(user, data.id);
    requireThat(!series.ended, 'This recurring visit has ended.', 409, 'series_ended');
    requireThat(typeof data.paused === 'boolean', 'Choose pause or resume.');
    run('UPDATE recurring_series SET paused=? WHERE id=?', data.paused ? 1 : 0, series.id);
    if (!data.paused) generateSeries(Date.now(), series.id);
    return { series:seriesView(get('SELECT * FROM recurring_series WHERE id=?', series.id)) };
  }) },

  // Skips one date (cancelling its booking if one was made), or un-skips it so it can be booked again.
  { method:'POST', path:'/api/series/skip', access:'user', handler:({ user, data }) => transaction(() => {
    const series = seriesFor(user, data.id);
    const day = validDay(data.day);
    if (data.skip === false) {
      run('DELETE FROM series_skips WHERE series=? AND day=?', series.id, day);
      // Detach a booking cancelled by the skip, so the date can be generated again.
      run("UPDATE bookings SET series_day=NULL WHERE series=? AND series_day=? AND status='Cancelled'", series.id, day);
      generateSeries(Date.now(), series.id);
    } else {
      cancelOccurrence(user, get('SELECT * FROM bookings WHERE series=? AND series_day=?', series.id, day), data.accept_fee_cents);
      run('INSERT INTO series_skips(series,day) VALUES(?,?) ON CONFLICT DO NOTHING', series.id, day);
    }
    return { series:seriesView(get('SELECT * FROM recurring_series WHERE id=?', series.id)) };
  }) },

  // Ends a series: no more dates, and its upcoming requests are cancelled. Confirmed visits stay booked.
  { method:'POST', path:'/api/series/end', access:'user', handler:({ user, data }) => transaction(() => {
    const series = seriesFor(user, data.id);
    const now = Date.now();
    run('UPDATE recurring_series SET ended=?, until_day=? WHERE id=? AND ended IS NULL', now, today(now), series.id);
    const cancelled = run("UPDATE bookings SET status='Cancelled' WHERE series=? AND status='Requested' AND starts>?", series.id, now).changes;
    return { cancelled, series:seriesView(get('SELECT * FROM recurring_series WHERE id=?', series.id)) };
  }) },

  { method:'POST', path:'/api/series/auto-approve', access:'owner', handler:({ user, data }) => transaction(() => {
    const series = seriesFor(user, data.id);
    requireThat(typeof data.auto_approve === 'boolean', 'Choose on or off.');
    run('UPDATE recurring_series SET auto_approve=? WHERE id=?', data.auto_approve ? 1 : 0, series.id);
    return { series:seriesView(get('SELECT * FROM recurring_series WHERE id=?', series.id)) };
  }) },
];
