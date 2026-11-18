// The Pet Diary: paged visits with their updates, photos, and staff publishing.
import { get, all, run, transaction, photos } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { activityTypes } from '../domain.mjs';
import { bookingFor, bookingRows, petsFor, cursor, beforeCursor, pageCursor } from '../bookings.mjs';
import { photoFrom } from '../photos.mjs';
import { stayNights } from '../scheduling.mjs';

const easternDate = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' });
// Groups an overnight stay's updates by night (C2.1): each update belongs to the night of its Eastern date; updates
// before the first night belong to night 1, and the departure morning belongs to the last night.
function nightsOf(visit, events) {
  const dates = stayNights(visit.starts, visit.ends);
  const nights = dates.map(date => ({ date, event_ids:[] }));
  for (const event of events) {
    if (event.booking !== visit.id) continue;
    const day = easternDate.format(event.published);
    const index = dates.indexOf(day);
    nights[index >= 0 ? index : day < dates[0] ? 0 : nights.length - 1].event_ids.push(event.id);
  }
  return nights;
}

const diaryPage = 10;
const optionalId = value => value ? integer(Number(value)) : null;

export default [
  // A page of visits (newest first) with every update for those visits, optionally narrowed to one pet or visit.
  { method:'GET', path:'/api/diary', access:'user', handler:({ user, url }) => {
    const pet = optionalId(url.searchParams.get('pet'));
    const visit = optionalId(url.searchParams.get('visit'));
    const conditions = ["(b.status IN ('In Progress','Completed') OR EXISTS(SELECT 1 FROM events e WHERE e.booking=b.id))"];
    const params = [];
    if (pet) { conditions.push('EXISTS(SELECT 1 FROM booking_pets bp WHERE bp.booking=b.id AND bp.pet=?)'); params.push(pet); }
    if (visit) { conditions.push('b.id=?'); params.push(visit); }
    beforeCursor(cursor(url.searchParams.get('before')), conditions, params);
    const rows = bookingRows(user,conditions.join(' AND '),params,'ORDER BY b.starts DESC, b.id DESC LIMIT '+(diaryPage + 1));
    const visits = rows.slice(0,diaryPage);
    const ids = visits.map(row => row.id);
    const events = ids.length ? all(`
      SELECT id,booking,pet,kind,notes,published,photo_key IS NOT NULL AS has_photo FROM events
      WHERE booking IN (${ids.map(() => '?').join(',')})${pet ? ' AND pet=?' : ''} ORDER BY published DESC,id DESC
    `,...ids,...(pet ? [pet] : [])) : [];
    for (const visit of visits) if (visit.service_kind === 'overnight') visit.nights = nightsOf(visit, events);
    return { visits, events, pets:petsFor(user,visits), next:rows.length > diaryPage ? pageCursor(visits.at(-1)) : null };
  } },

  { method:'GET', path:/^\/api\/photos\/(\d+)$/, access:'user', handler:async ({ user, match }) => {
    const event = get('SELECT events.mime, events.photo_key, bookings.owner FROM events JOIN bookings ON bookings.id=events.booking WHERE events.id=?', Number(match[1]));
    requireThat(event?.photo_key && (user.admin || event.owner === user.id), 'Photo not found.', 404);
    const bytes = await photos.get(event.photo_key);
    requireThat(bytes, 'Photo not found.', 404);
    // Photos never change once published, so the browser may keep its private copy for an hour.
    return new Response(bytes, { headers:{ 'Content-Type':event.mime, 'Cache-Control':'private, max-age=3600' } });
  } },

  { method:'POST', path:'/api/events', access:'staff', handler:async ({ user, data }) => {
    const booking = bookingFor(user,data.id);
    requireThat(booking.status === 'In Progress','Start the visit before logging an activity.',409);
    const pet = integer(data.pet);
    requireThat(get('SELECT pet FROM booking_pets WHERE booking=? AND pet=?',booking.id,pet),'Pet is not part of this visit.',404);
    requireThat(activityTypes.includes(data.kind),'Choose an activity type.');
    const notes = field(data.notes,3000,false);
    const [mime,photo] = photoFrom(data.photo);
    // Store the photo first (an await), then re-check the visit inside a synchronous transaction, because
    // another request may have completed it while the upload ran. A refused update deletes its photo.
    const key = photo ? 'events/' + crypto.randomUUID() : null;
    if (key) await photos.put(key, photo, mime);
    try {
      transaction(() => {
        requireThat(get('SELECT status FROM bookings WHERE id=?',booking.id).status === 'In Progress','Start the visit before logging an activity.',409);
        run('INSERT INTO events(booking,pet,kind,notes,published,mime,photo_key) VALUES(?,?,?,?,?,?,?)',booking.id,pet,data.kind,notes,Date.now(),mime,key);
      });
    } catch (error) {
      if (key) await photos.delete(key);
      throw error;
    }
    return {};
  } },
];
