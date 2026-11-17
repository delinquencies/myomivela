// Reading bookings with the access rules applied: customers see their own, staff see everyone's.
import { get, all } from './db.mjs';
import { requireThat, integer } from './validate.mjs';

export function bookingFor(user, id) {
  const booking = get('SELECT * FROM bookings WHERE id=?', integer(id));
  requireThat(booking && (user.admin || booking.owner === user.id), 'Booking not found.', 404);
  return booking;
}
// Bookings visible to this user, with service, customer and pet ids. `where` filters the aliased table `b`.
export function bookingRows(user, where, params, tail) {
  return all(`
    SELECT b.*, s.name AS service_name, u.name AS customer, u.email,
      (SELECT json_group_array(bp.pet) FROM booking_pets bp WHERE bp.booking=b.id) AS pet_ids
    FROM bookings b JOIN services s ON s.id=b.service JOIN users u ON u.id=b.owner
    WHERE ${user.admin ? '1' : 'b.owner=?'} AND ${where} ${tail}
  `, ...(user.admin ? [] : [user.id]), ...params).map(row => ({ ...row, pet_ids:JSON.parse(row.pet_ids) }));
}

// Pages are ordered newest first by (starts, id); a cursor is "<starts>.<id>" of the last row returned.
export const pageCursor = row => row.starts + '.' + row.id;
export function cursor(value) {
  if (!value) return null;
  const match = /^(\d{1,16})\.(\d{1,16})$/.exec(value);
  requireThat(match, 'Invalid page.');
  return [Number(match[1]), Number(match[2])];
}
export const beforeCursor = (before, conditions, params) => {
  if (!before) return;
  conditions.push('(b.starts<? OR (b.starts=? AND b.id<?))');
  params.push(before[0], before[0], before[1]);
};
const historyPageSize = 20;
export function historyPage(user, now, before) {
  const conditions = ['b.starts<? AND b.status<>?'];
  const params = [now, 'In Progress'];
  beforeCursor(before, conditions, params);
  const rows = bookingRows(user, conditions.join(' AND '), params, 'ORDER BY b.starts DESC, b.id DESC LIMIT ' + (historyPageSize + 1));
  const bookings = rows.slice(0, historyPageSize);
  return { bookings, next:rows.length > historyPageSize ? pageCursor(bookings.at(-1)) : null };
}
// Customers get all their own pets; staff get only the pets referenced by the bookings in the response.
export function petsFor(user, bookings) {
  if (!user.admin) return all('SELECT * FROM pets WHERE owner=? ORDER BY name', user.id);
  const ids = [...new Set(bookings.flatMap(booking => booking.pet_ids))];
  return ids.length ? all(`SELECT * FROM pets WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`, ...ids) : [];
}
