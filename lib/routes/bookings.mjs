// Pets, booking requests, status changes and rescheduling.
import { get, run, transaction } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { transitions } from '../domain.mjs';
import { bookingFor } from '../bookings.mjs';
import { quote } from '../pricing.mjs';
import { reserveTime, conflict, windowCovers, earlyStartMinutes } from '../scheduling.mjs';

const easternTime = new Intl.DateTimeFormat('en-US',{ timeStyle:'short', timeZone:'America/New_York' });

// Validates the service and pets and prices them. `checkPrice` compares the client's total with the quote,
// so a request never goes through at a price the customer didn't see.
function bookingSelection(user, data, { checkPrice = true } = {}) {
  requireThat(!user.admin, 'Use a customer account to request care.',403);
  const service = get('SELECT * FROM services WHERE id=?',integer(data.service));
  requireThat(service,'Service not found.',404);
  requireThat(Array.isArray(data.pets) && data.pets.length && data.pets.length <= 12,'Choose at least one pet.');
  const petIds = [...new Set(data.pets.map(value => integer(value)))];
  for (const id of petIds) requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?',id,user.id),'Pet not found.',404);
  const priced = quote({ service, petCount:petIds.length });
  if (checkPrice) requireThat(priced.total_cents === data.cents,'The price changed. Refresh and review the updated total.',409,'price_changed',{ total_cents:priced.total_cents });
  return {service,petIds,...priced};
}

export default [
  { method:'POST', path:'/api/pets', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to create a pet.', 403);
    const values = [field(data.name,80),field(data.species,60),field(data.details,3000,false)];
    if (data.id !== undefined) {
      requireThat(run('UPDATE pets SET name=?,species=?,details=? WHERE id=? AND owner=?',...values,integer(data.id),user.id).changes, 'Pet not found.',404);
    } else run('INSERT INTO pets(owner,name,species,details) VALUES(?,?,?,?)',user.id,...values);
    return {};
  } },

  // The itemised price and times for a choice, without holding anything.
  { method:'POST', path:'/api/quote', access:'user', handler:({ user, data }) => {
    const {service,lines,total_cents} = bookingSelection(user,data,{ checkPrice:false });
    const [starts,ends] = reserveTime(data.slot,service,0,data.start,user.id);
    return {starts,ends,lines,total_cents};
  } },

  { method:'POST', path:'/api/checkout-hold', access:'user', handler:({ user, data }) => transaction(() => {
    const {service,lines,total_cents} = bookingSelection(user,data);
    const [starts,ends] = reserveTime(data.slot,service,0,data.start,user.id);
    const now = Date.now();
    const expires = Math.min(starts,now + 10*60_000);
    run('DELETE FROM checkout_holds WHERE expires<=? OR owner=?',now,user.id);
    run('INSERT INTO checkout_holds(owner,slot,service,starts,ends,expires) VALUES(?,?,?,?,?,?)',user.id,data.slot,service.id,starts,ends,expires);
    return {starts,ends,expires,lines,total_cents};
  }) },

  { method:'POST', path:'/api/checkout-release', access:'user', handler:({ user, data }) => {
    run('DELETE FROM checkout_holds WHERE owner=? AND expires=?',user.id,integer(data.expires));
    return {};
  } },

  { method:'POST', path:'/api/bookings', access:'user', handler:({ user, data }) => {
    return transaction(() => {
      const {service,petIds,lines,total_cents} = bookingSelection(user,data);
      if (data.hold !== undefined) {
        const hold = get('SELECT * FROM checkout_holds WHERE owner=? AND expires=? AND expires>?',user.id,integer(data.hold),Date.now());
        requireThat(hold && hold.slot === data.slot && hold.service === service.id && hold.starts === data.start &&
          hold.ends === hold.starts + service.minutes * 60_000, 'Your hold expired or the visit changed. Review the booking again.',409,'hold_expired');
      }
      const [starts,ends] = reserveTime(data.slot,service,0,data.start,user.id);
      requireThat(!get("SELECT id FROM bookings WHERE owner=? AND status='Requested' AND starts<? AND ends>?",user.id,ends,starts),'You already have a request for this time.',409);
      const result = run('INSERT INTO bookings(owner,service,starts,ends,cents,notes) VALUES(?,?,?,?,?,?)',user.id,service.id,starts,ends,total_cents,field(data.notes,1500,false));
      for (const pet of petIds) run('INSERT INTO booking_pets VALUES(?,?)',result.lastInsertRowid,pet);
      lines.forEach((line, position) => run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',
        result.lastInsertRowid,position,line.code,line.label,line.quantity,line.cents));
      run('DELETE FROM checkout_holds WHERE owner=?',user.id);
      return { id:result.lastInsertRowid, status:'Requested' };
    });
  } },

  { method:'POST', path:'/api/status', access:'user', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user,data.id);
    const allowed = user.admin ? transitions[booking.status] || [] : ['Requested','Confirmed'].includes(booking.status) && booking.starts > Date.now() ? ['Cancelled'] : [];
    requireThat(allowed.includes(data.status),'This booking cannot make that change.',409);
    if (data.status === 'Confirmed') {
      requireThat(booking.starts > Date.now() && windowCovers(booking.starts,booking.ends),'This appointment window is no longer available. Reschedule the request before confirming.',409);
      requireThat(!conflict(booking.starts,booking.ends,booking.id),'This time overlaps another booking. Reschedule the request before confirming.',409);
    }
    if (data.status === 'In Progress') {
      const early = earlyStartMinutes();
      const from = booking.starts - early * 60_000;
      requireThat(Date.now() >= from, 'This visit can start from '+easternTime.format(from)+' ET'+
        (early ? ' ('+early+' minutes before it is booked).' : ', when it is booked.'), 409);
    }
    const arrived = data.status === 'In Progress' ? Date.now() : booking.arrived;
    const departed = data.status === 'Completed' ? Date.now() : booking.departed;
    const summary = data.status === 'Completed' ? field(data.summary,3000) : booking.summary;
    run('UPDATE bookings SET status=?,arrived=?,departed=?,summary=? WHERE id=?',data.status,arrived,departed,summary,booking.id);
    return {};
  }) },

  { method:'POST', path:'/api/reschedule', access:'user', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user,data.id);
    requireThat(['Requested','Confirmed'].includes(booking.status) && (user.admin || booking.starts > Date.now()),'This booking cannot be moved.',409);
    const [starts,ends] = reserveTime(data.slot,{ minutes:(booking.ends-booking.starts)/60_000 },booking.id,data.start);
    // A customer's move goes back to Requested for staff review; a staff move keeps its status.
    run('UPDATE bookings SET starts=?,ends=?,status=? WHERE id=?',starts,ends,user.admin ? booking.status : 'Requested',booking.id);
    return {};
  }) },
];
