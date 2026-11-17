// The signed-in dashboard: current bookings, one page of history, services and bookable times.
import { all } from '../db.mjs';
import { publicUser } from '../auth.mjs';
import { activityTypes } from '../domain.mjs';
import { bookingRows, historyPage, petsFor, cursor } from '../bookings.mjs';
import { upcomingWindows, bookableStarts } from '../scheduling.mjs';

const services = () => all('SELECT * FROM services ORDER BY name,minutes');

export default [
  { method:'GET', path:'/api/catalog', access:'public', handler:services },

  { method:'GET', path:'/api/portal', access:'user', handler:({ user }) => {
    const now = Date.now();
    // Upcoming and active bookings are bounded by the schedule; past ones are paged through /api/history.
    const current = bookingRows(user,'(b.starts>=? OR b.status=?)',[now,'In Progress'],'ORDER BY b.starts, b.id');
    const history = historyPage(user,now);
    const catalog = services();
    const windows = upcomingWindows(now);
    const bookings = [...current,...history.bookings];
    const account = { sessions:all('SELECT COUNT(*) AS n FROM sessions WHERE user=? AND expires>?',user.id,now)[0].n };
    return { user:publicUser(user), account, pets:petsFor(user,bookings), services:catalog, slots:bookableStarts(windows,catalog,now), windows,
      bookings, history_next:history.next, activityTypes };
  } },

  { method:'GET', path:'/api/history', access:'user', handler:({ user, url }) => {
    const page = historyPage(user,Date.now(),cursor(url.searchParams.get('before')));
    return { bookings:page.bookings, pets:petsFor(user,page.bookings), next:page.next };
  } },
];
