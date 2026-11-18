// Staff customer records (C2.7): a searchable list, one customer's full record, and private staff notes.
// Every route here is staff-only, and nothing in staff_notes is ever included in a customer response.
import { get, all, run } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { bookingRows } from '../bookings.mjs';
import { vaccinesFor } from '../compliance.mjs';
import {readIntake} from './intake.mjs';

const pageSize = 20;
const likeTerm = value => '%' + value.toLowerCase().replace(/[\\%_]/g, char => '\\' + char) + '%';
const notesFor = (clientId, petIds) => all(`SELECT id, subject_type, subject_id, body, created, updated FROM staff_notes
  WHERE (subject_type='client' AND subject_id=?)${petIds.length ? ` OR (subject_type='pet' AND subject_id IN (${petIds.map(() => '?').join(',')}))` : ''}
  ORDER BY updated DESC, id DESC`, clientId, ...petIds);

export default [
  // Customers by name (then id), 20 per page. `before` is the id of the last customer on the previous page.
  { method:'GET', path:'/api/clients', access:'staff', handler:({ url }) => {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const after = url.searchParams.get('before');
    const conditions = ['u.admin=0'];
    const params = [];
    if (q) { conditions.push("(lower(u.name) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\')"); params.push(likeTerm(q), likeTerm(q)); }
    if (after) {
      const last = get('SELECT lower(name) AS name, id FROM users WHERE id=? AND admin=0', integer(Number(after)));
      requireThat(last, 'Invalid page.');
      conditions.push('(lower(u.name) > ? OR (lower(u.name) = ? AND u.id > ?))');
      params.push(last.name, last.name, last.id);
    }
    const now = Date.now();
    const rows = all(`SELECT u.id, u.name, u.email,
        (SELECT COUNT(*) FROM bookings b WHERE b.owner=u.id AND b.status IN ('Requested','Confirmed','In Progress') AND b.ends>?) AS upcoming,
        (SELECT MAX(b.departed) FROM bookings b WHERE b.owner=u.id AND b.status='Completed') AS last_visit
      FROM users u WHERE ${conditions.join(' AND ')} ORDER BY lower(u.name), u.id LIMIT ?`, now, ...params, pageSize + 1);
    const clients = rows.slice(0, pageSize).map(row => ({ ...row,
      pets:all('SELECT id, name, species FROM pets WHERE owner=? ORDER BY name', row.id) }));
    return { clients, next:rows.length > pageSize ? String(clients.at(-1).id) : null };
  } },

  // One customer's full record: contact, pets with care details and vaccines, recent bookings, notes, key status.
  { method:'GET', path:/^\/api\/clients\/(\d+)$/, access:'staff', handler:({ user, match }) => {
    const client = get('SELECT id, name, email, locale FROM users WHERE id=? AND admin=0', Number(match[1]));
    requireThat(client, 'Customer not found.', 404);
    const pets = all('SELECT * FROM pets WHERE owner=? ORDER BY name', client.id);
    const vaccines = vaccinesFor(pets);
    for (const pet of pets) pet.vaccines = vaccines[pet.id];
    const access = get('SELECT method, key_label, key_status FROM home_access WHERE owner=?', client.id);
    return {
      client, pets, intake:readIntake(client.id),
      bookings:bookingRows(user, 'b.owner=?', [client.id], 'ORDER BY b.starts DESC, b.id DESC LIMIT 50'),
      home_access:access || null,
      notes:notesFor(client.id, pets.map(pet => pet.id)),
    };
  } },

  // Adds or edits a private note on a customer or one of their pets.
  { method:'POST', path:'/api/staff-notes', access:'staff', handler:({ data }) => {
    requireThat(['client','pet'].includes(data.subject_type), 'Choose who the note is about.', 400, 'invalid_subject');
    const subject = integer(data.subject_id);
    requireThat(data.subject_type === 'client' ? get('SELECT id FROM users WHERE id=? AND admin=0', subject) : get('SELECT id FROM pets WHERE id=?', subject),
      'That customer or pet was not found.', 404);
    const body = field(data.body, 3000);
    const now = Date.now();
    if (data.id !== undefined) {
      requireThat(run('UPDATE staff_notes SET body=?, updated=? WHERE id=? AND subject_type=? AND subject_id=?', body, now, integer(data.id), data.subject_type, subject).changes,
        'Note not found.', 404);
      return { id:data.id };
    }
    return { id:run('INSERT INTO staff_notes(subject_type,subject_id,body,created,updated) VALUES(?,?,?,?,?)', data.subject_type, subject, body, now, now).lastInsertRowid };
  } },

  { method:'POST', path:'/api/staff-notes/delete', access:'staff', handler:({ data }) => {
    requireThat(run('DELETE FROM staff_notes WHERE id=?', integer(data.id)).changes, 'Note not found.', 404);
    return {};
  } },
];
