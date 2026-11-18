// The care record (C2.5): a pet's timeline, its profile versions, and private feedback on completed visits.
import { get, all, run } from '../db.mjs';
import { requireThat, integer } from '../validate.mjs';
import { timeline, timelineCursor } from '../care.mjs';
import { fieldsFor } from './diary.mjs';

// The pet, if this user may see it: its owner or staff. Anyone else gets 404, as if it didn't exist.
const visiblePet = (user, id) => {
  const pet = get('SELECT * FROM pets WHERE id=?', id);
  requireThat(pet && (user.admin || pet.owner === user.id), 'Pet not found.', 404);
  return pet;
};

export default [
  { method:'GET', path:/^\/api\/pets\/(\d+)\/timeline$/, access:'user', handler:({ user, url, match }) => {
    const pet = visiblePet(user, Number(match[1]));
    const cursor = timelineCursor(url.searchParams.get('before'));
    requireThat(cursor !== undefined, 'Invalid page.');
    return timeline(pet.id, cursor, data => fieldsFor(user, data));
  } },

  // One saved version of a pet's profile, for showing what a past visit was agreed on.
  { method:'GET', path:/^\/api\/profile-versions\/(\d+)$/, access:'user', handler:({ user, match }) => {
    const version = get('SELECT * FROM pet_profile_versions WHERE id=?', Number(match[1]));
    requireThat(version, 'Profile version not found.', 404);
    visiblePet(user, version.pet);
    return version;
  } },

  // A private rating of a completed visit: -1, 0 or 1, with an optional comment. It can be changed for 7 days.
  { method:'POST', path:'/api/feedback', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to rate a visit.', 403);
    const booking = get('SELECT * FROM bookings WHERE id=? AND owner=?', integer(data.booking), user.id);
    requireThat(booking && booking.status === 'Completed', 'Visit not found.', 404);
    requireThat([-1, 0, 1].includes(data.score), 'Choose how the visit went.', 400, 'invalid_score');
    const comment = typeof data.comment === 'string' ? data.comment.trim() : '';
    requireThat(comment.length <= 1000, 'Keep the comment to 1,000 characters.');
    const now = Date.now();
    const existing = get('SELECT created FROM visit_feedback WHERE booking=?', booking.id);
    requireThat(!existing || now - existing.created <= 7 * 86_400_000, 'Feedback on this visit can no longer be changed.', 409, 'feedback_closed');
    run(`INSERT INTO visit_feedback(booking,score,comment,created,updated) VALUES(?,?,?,?,?)
      ON CONFLICT(booking) DO UPDATE SET score=excluded.score, comment=excluded.comment, updated=excluded.updated`, booking.id, data.score, comment, now, now);
    return {};
  } },

  { method:'GET', path:'/api/feedback', access:'staff', handler:({ url }) => {
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const since = Date.now() - days * 86_400_000;
    const counts = { '-1':0, '0':0, '1':0 };
    for (const row of all('SELECT score, COUNT(*) AS n FROM visit_feedback WHERE updated>=? GROUP BY score', since)) counts[row.score] = row.n;
    const recent = all(`SELECT f.booking, u.name AS customer, f.score, f.comment, f.created FROM visit_feedback f
      JOIN bookings b ON b.id=f.booking JOIN users u ON u.id=b.owner WHERE f.updated>=? ORDER BY f.updated DESC LIMIT 20`, since);
    return { days, counts, recent };
  } },
];
