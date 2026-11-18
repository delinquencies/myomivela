// The longitudinal care record (C2.5): versions of each pet's profile, so a visit keeps the profile Myomi worked
// from, and a merged per-pet timeline of visits, updates, vaccines and profile changes.
import { get, all, run } from './db.mjs';

const profileKeys = details => { try { const parsed = JSON.parse(details || '{}'); return parsed && typeof parsed === 'object' ? parsed : { notes:details }; } catch { return { notes:details }; } };

// Records a new version when the profile differs from the latest one; returns the latest version id.
export function recordVersion(petId, now = Date.now()) {
  const pet = get('SELECT id, name, species, details FROM pets WHERE id=?', petId);
  const latest = get('SELECT * FROM pet_profile_versions WHERE pet=? ORDER BY id DESC LIMIT 1', petId);
  if (latest && latest.name === pet.name && latest.species === pet.species && latest.details === pet.details) return latest.id;
  return run('INSERT INTO pet_profile_versions(pet,name,species,details,created) VALUES(?,?,?,?,?)', petId, pet.name, pet.species, pet.details, now).lastInsertRowid;
}
// The profile fields that differ between two versions (name, species and the keys of the details JSON).
export function changedFields(before, after) {
  const changed = [];
  if (before.name !== after.name) changed.push('name');
  if (before.species !== after.species) changed.push('species');
  const a = profileKeys(before.details), b = profileKeys(after.details);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (key !== 'profileVersion' && a[key] !== b[key]) changed.push(key);
  return changed;
}

const ranks = { visit:3, event:2, vaccine:1, profile_change:0 };
const keyOf = entry => [entry.at, ranks[entry.type], entry.id];
const before = (entry, cursor) => !cursor || entry.at < cursor[0] || (entry.at === cursor[0] &&
  (ranks[entry.type] < cursor[1] || (ranks[entry.type] === cursor[1] && entry.id < cursor[2])));
export function timelineCursor(value) {
  if (!value) return null;
  const parts = value.split('.').map(Number);
  return parts.length === 3 && parts.every(Number.isSafeInteger) ? parts : undefined;
}

// One page of a pet's timeline, newest first. `fieldsFor(data)` turns an event's stored answers into visible fields.
export function timeline(petId, cursor, fieldsFor, pageSize = 30) {
  const limit = pageSize + 50; // generous per source; entries are then merged and cut to one page
  const upTo = cursor ? cursor[0] : Number.MAX_SAFE_INTEGER;
  const entries = [
    ...all(`SELECT b.id, b.starts AS at, b.status, b.summary, s.name AS service_name FROM bookings b
      JOIN booking_pets bp ON bp.booking=b.id JOIN services s ON s.id=b.service
      WHERE bp.pet=? AND b.status IN ('In Progress','Completed') AND b.starts<=? ORDER BY b.starts DESC, b.id DESC LIMIT ?`, petId, upTo, limit)
      .map(row => ({ type:'visit', at:row.at, id:row.id, booking:row.id, service_name:row.service_name, status:row.status, summary:row.summary })),
    ...all(`SELECT id, booking, kind, notes, published AS at, photo_key IS NOT NULL AS has_photo, data FROM events
      WHERE pet=? AND published<=? ORDER BY published DESC, id DESC LIMIT ?`, petId, upTo, limit)
      .map(row => ({ type:'event', at:row.at, id:row.id, booking:row.booking, kind:row.kind, notes:row.notes, has_photo:Boolean(row.has_photo), fields:fieldsFor(row.data) })),
    ...all('SELECT id, name, given, expires FROM pet_vaccines WHERE pet=? AND given IS NOT NULL', petId)
      .map(row => ({ type:'vaccine', at:Date.parse(row.given + 'T12:00:00Z'), id:row.id, name:row.name, given:row.given, expires:row.expires }))
      .filter(entry => entry.at <= upTo),
  ];
  const versions = all('SELECT * FROM pet_profile_versions WHERE pet=? ORDER BY id', petId);
  for (let index = 1; index < versions.length; index++) {
    if (versions[index].created > upTo) continue;
    entries.push({ type:'profile_change', at:versions[index].created, id:versions[index].id, changed:changedFields(versions[index - 1], versions[index]) });
  }
  const sorted = entries.filter(entry => before(entry, cursor)).sort((a, b) => {
    const [x, y] = [keyOf(a), keyOf(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
  const page = sorted.slice(0, pageSize);
  return { entries:page, next:sorted.length > pageSize ? keyOf(page.at(-1)).join('.') : null };
}
