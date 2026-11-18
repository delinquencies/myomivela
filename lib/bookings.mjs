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
    SELECT b.*, s.name AS service_name, s.kind AS service_kind, u.name AS customer, u.email,
      (SELECT json_group_array(bp.pet) FROM booking_pets bp WHERE bp.booking=b.id) AS pet_ids,
      (SELECT json_group_array(json_object('code',l.code,'label',l.label,'quantity',l.quantity,'cents',l.cents))
        FROM (SELECT * FROM booking_lines WHERE booking=b.id ORDER BY position) l) AS lines,
      (SELECT json_object('id',c.id,'starts',c.starts,'ends',c.ends) FROM booking_changes c
        WHERE c.booking=b.id AND c.status='Pending') AS pending_change,
      (SELECT json_object('id',c.id,'status',c.status,'starts',c.starts,'ends',c.ends,'decided',c.decided) FROM booking_changes c
        WHERE c.booking=b.id AND c.status IN ('Approved','Declined') ORDER BY c.decided DESC, c.id DESC LIMIT 1) AS last_change
    FROM bookings b JOIN services s ON s.id=b.service JOIN users u ON u.id=b.owner
    WHERE ${user.admin ? '1' : 'b.owner=?'} AND ${where} ${tail}
  `, ...(user.admin ? [] : [user.id]), ...params).map(row => {
    const lines = JSON.parse(row.lines);
    // Bookings made before itemised prices have no lines: describe them as one base line for their total.
    return { ...row, pet_ids:JSON.parse(row.pet_ids),
      pending_change:row.pending_change ? JSON.parse(row.pending_change) : null,
      departure_check:row.departure_check ? JSON.parse(row.departure_check) : null,
      last_change:row.last_change ? JSON.parse(row.last_change) : null,
      lines:lines.length ? lines : [{ code:'base', label:row.service_name, quantity:1, cents:row.cents }] };
  });
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
