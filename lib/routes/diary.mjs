// The Pet Diary: paged visits with their updates, photos, and staff publishing.
import { get, all, run, transaction, photos } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { activityTypes, reportFields } from '../domain.mjs';
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
// Validates an update's report-card answers against its template and returns the answers with their labels.
function reportCard(serviceKind, kind, data) {
  if (data === undefined || data === null) return null;
  requireThat(typeof data === 'object' && !Array.isArray(data), 'Send report-card answers as an object.');
  const template = reportFields[serviceKind]?.[kind] || [];
  const fields = [];
  for (const [id, value] of Object.entries(data)) {
    const def = template.find(field => field.id === id);
    requireThat(def, 'Unknown report-card field: '+id+'.', 400, 'unknown_field', { field:id });
    const valid = def.type === 'yesno' ? typeof value === 'boolean'
      : def.type === 'count' ? Number.isSafeInteger(value) && value >= (def.min ?? 0) && value <= (def.max ?? 1000)
      : def.options.includes(value);
    requireThat(valid, 'Check the answer for '+def.label+'.', 400, 'invalid_field', { field:id });
    fields.push({ id, label:def.label, type:def.type, value, ...(def.hideWhen ? { hideWhen:def.hideWhen } : {}) });
  }
  return fields.length ? fields : null;
}
// Customers don't see unremarkable answers; staff see all of them, with hidden ones marked.
const hiddenFromCustomer = field => (field.hideWhen === 'no' && field.value === false) || (field.hideWhen === 'zero' && field.value === 0);
export function fieldsFor(user, data) {
  if (!data) return [];
  return JSON.parse(data).flatMap(({ label, type, value, ...field }) => {
    const hidden = hiddenFromCustomer({ ...field, value });
    if (hidden && !user.admin) return [];
    return [{ label, type, value, ...(hidden ? { hidden:true } : {}) }];
  });
}
const optionalId = value => value ? integer(Number(value)) : null;

export default [
  // A page of visits (newest first) with every update for those visits, optionally narrowed to one pet or visit.
  // What changed in the diary since a revision (CUX-06): new updates and visits whose state moved on, filtered exactly
  // like /api/diary. Cheap when nothing changed. `since` is the revision from an earlier answer; without it, only the
  // current revision is returned. Revision format: "<last event id>.<last visit change ms>".
  { method:'GET', path:'/api/diary/changes', access:'user', handler:({ user, url }) => {
    const own = user.admin ? '1' : 'b.owner=' + Number(user.id);
    const state = get(`SELECT
        (SELECT COALESCE(MAX(e.id),0) FROM events e JOIN bookings b ON b.id=e.booking WHERE ${own}) AS last_event,
        (SELECT MAX(e.published) FROM events e JOIN bookings b ON b.id=e.booking WHERE ${own}) AS latest_published_at,
        (SELECT COALESCE(MAX(MAX(COALESCE(b.arrived,0),COALESCE(b.departed,0),COALESCE(b.confirmed_at,0),COALESCE(b.cancelled_at,0))),0) FROM bookings b WHERE ${own}) AS last_change`);
    const revision = state.last_event + '.' + state.last_change;
    const checked_at = Date.now();
    const since = url.searchParams.get('since');
    if (since === null) return { revision, changed:false, latest_published_at:state.latest_published_at, checked_at, events:[], visit_ids:[] };
    const match = /^(\d{1,16})\.(\d{1,16})$/.exec(since);
    requireThat(match, 'Refresh the diary.', 400, 'invalid_revision');
    const [afterEvent, afterChange] = [Number(match[1]), Number(match[2])];
    if (since === revision) return { revision, changed:false, latest_published_at:state.latest_published_at, checked_at, events:[], visit_ids:[] };
    // At most 50 new updates per answer; a client further behind reloads the first diary page instead.
    const events = all(`SELECT e.id,e.booking,e.pet,e.kind,e.notes,e.published,e.photo_key IS NOT NULL AS has_photo,e.data
      FROM events e JOIN bookings b ON b.id=e.booking WHERE ${own} AND e.id>? ORDER BY e.id LIMIT 51`, afterEvent)
      .map(({ data, ...event }) => ({ ...event, fields:fieldsFor(user, data) }));
    const visit_ids = all(`SELECT b.id FROM bookings b WHERE ${own} AND MAX(COALESCE(b.arrived,0),COALESCE(b.departed,0),COALESCE(b.confirmed_at,0),COALESCE(b.cancelled_at,0))>? ORDER BY b.id`, afterChange)
      .map(row => row.id);
    return { revision, changed:true, latest_published_at:state.latest_published_at, checked_at,
      events:events.slice(0, 50), visit_ids, truncated:events.length > 50 };
  } },

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
      SELECT id,booking,pet,kind,notes,published,photo_key IS NOT NULL AS has_photo,data FROM events
      WHERE booking IN (${ids.map(() => '?').join(',')})${pet ? ' AND pet=?' : ''} ORDER BY published DESC,id DESC
    `,...ids,...(pet ? [pet] : [])).map(({ data, ...event }) => ({ ...event, fields:fieldsFor(user, data) })) : [];
    for (const visit of visits) if (visit.service_kind === 'overnight') visit.nights = nightsOf(visit, events);
    // A customer's own private rating of each visit (C2.5); staff read ratings through /api/feedback.
    if (!user.admin) for (const visit of visits) visit.feedback = get('SELECT score, comment FROM visit_feedback WHERE booking=?', visit.id) || null;
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
    requireThat(booking.status === 'In Progress','Start the visit before logging an activity.',409,'visit_not_active',{ status:booking.status });
    const pet = integer(data.pet);
    requireThat(get('SELECT pet FROM booking_pets WHERE booking=? AND pet=?',booking.id,pet),'Pet is not part of this visit.',404);
    requireThat(activityTypes.includes(data.kind),'Choose an activity type.');
    const notes = field(data.notes,3000,false);
    // Medication given is a safety record (audit UX-08): it needs what was given, how much and when.
    requireThat(data.kind !== 'Medication' || data.data?.given === false || notes.trim(),
      'Add the medicine, dose and time.', 400, 'medication_details_required');
    const serviceKind = get('SELECT s.kind FROM services s WHERE s.id=?',booking.service).kind;
    const card = reportCard(serviceKind, data.kind, data.data);
    const [mime,photo] = photoFrom(data.photo);
    // Store the photo first (an await), then re-check the visit inside a synchronous transaction, because
    // another request may have completed it while the upload ran. A refused update deletes its photo.
    const key = photo ? 'events/' + crypto.randomUUID() : null;
    if (key) await photos.put(key, photo, mime);
    try {
      transaction(() => {
        const current = get('SELECT status FROM bookings WHERE id=?',booking.id).status;
        requireThat(current === 'In Progress','Start the visit before logging an activity.',409,'visit_not_active',{ status:current });
        run('INSERT INTO events(booking,pet,kind,notes,published,mime,photo_key,data) VALUES(?,?,?,?,?,?,?,?)',booking.id,pet,data.kind,notes,Date.now(),mime,key,card ? JSON.stringify(card) : null);
      });
    } catch (error) {
      if (key) await photos.delete(key);
      throw error;
    }
    return {};
  } },
];
