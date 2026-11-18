// The signed-in dashboard: current bookings, one page of history, services and bookable times.
import { all, get } from '../db.mjs';
import { publicUser } from '../auth.mjs';
import { activityTypes } from '../domain.mjs';
import { bookingRows, historyPage, petsFor, cursor } from '../bookings.mjs';
import { upcomingWindows, manualWindows, bookableStarts, scheduleRules, dateExceptions, earlyStartMinutes } from '../scheduling.mjs';

const services = () => all('SELECT * FROM services ORDER BY name,minutes');

export default [
  { method:'GET', path:'/api/catalog', access:'public', handler:services },
  { method:'GET', path:'/api/availability', access:'public', handler:() => {
    const now = Date.now();
    const horizon = now + 14*24*60*60_000;
    const catalog = services();
    const windows = upcomingWindows(now).filter(window => window.starts < horizon);
    const slots = bookableStarts(windows,catalog,now).filter(slot => slot.starts < horizon).sort((a,b) => a.starts-b.starts);
    return catalog.map(service => ({
      ...service,
      times:[...new Set(slots.filter(slot => slot.service_ids.includes(service.id)).map(slot => slot.starts))].slice(0,3),
    }));
  } },

  { method:'GET', path:'/api/portal', access:'user', handler:({ user }) => {
    const now = Date.now();
    // Upcoming and active bookings are bounded by the schedule; past ones are paged through /api/history.
    const current = bookingRows(user,'(b.starts>=? OR b.status=?)',[now,'In Progress'],'ORDER BY b.starts, b.id');
    const history = historyPage(user,now);
    const catalog = services();
    const windows = upcomingWindows(now);
    const bookings = [...current,...history.bookings];
    const week = bookingRows(user,
      "b.ends > ? AND b.starts < ? AND b.status IN ('Requested','Confirmed','In Progress','Completed')",
      [now-36*60*60_000,now+8*24*60*60_000],'ORDER BY b.starts, b.id')
      .map(({starts,ends,status,service_name,customer,pet_ids}) => ({starts,ends,status,service_name,
        ...(user.admin ? {customer} : {pet_ids})}));
    const account = { sessions:all('SELECT COUNT(*) AS n FROM sessions WHERE user=? AND expires>?',user.id,now)[0].n };
    const schedule = user.admin ? { ...scheduleRules(), earlyStart:earlyStartMinutes(), exceptions:dateExceptions(),
      openings:upcomingWindows(now-36*60*60_000).filter(window=>window.starts<now+8*24*60*60_000) } : undefined;
    return { user:publicUser(user), account, pets:petsFor(user,bookings), services:catalog, slots:bookableStarts(windows,catalog,now,user.id), windows:manualWindows(now), schedule,
      bookings, week, history_next:history.next, activityTypes };
  } },

  { method:'GET', path:'/api/financials', access:'staff', handler:() => {
    const now = Date.now();
    const completed = all(`
      SELECT s.name AS service, COUNT(*) AS visits, SUM(b.cents) AS cents
      FROM bookings b JOIN services s ON s.id=b.service
      WHERE b.status='Completed' AND b.departed>=? AND b.departed<=?
      GROUP BY s.name ORDER BY cents DESC, s.name
    `,now-30*24*60*60_000,now);
    const upcoming = get(`
      SELECT COUNT(*) AS visits, COALESCE(SUM(cents),0) AS cents
      FROM bookings WHERE status='Confirmed' AND starts>?
    `,now);
    return {completed,upcoming};
  } },

  { method:'GET', path:'/api/history', access:'user', handler:({ user, url }) => {
    const page = historyPage(user,Date.now(),cursor(url.searchParams.get('before')));
    return { bookings:page.bookings, pets:petsFor(user,page.bookings), next:page.next };
  } },
];
