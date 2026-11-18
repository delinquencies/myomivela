// Pets, booking requests, status changes and rescheduling.
import { get, all, run, transaction } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { transitions } from '../domain.mjs';
import { isOwner } from '../auth.mjs';
import { bookingFor } from '../bookings.mjs';
import { priceBooking, latePickupLine } from '../pricing.mjs';
import { blockers, requireNoBlockers } from '../compliance.mjs';
import { recordVersion } from '../care.mjs';
import { addTip } from './payments.mjs';
import { cancellationTerms } from '../cancellation.mjs';
import { holdCredit, applyCredit, returnCredit } from '../packages.mjs';
import { notify, bookingParams } from '../outbox.mjs';
import { bookingPayment } from '../ledger.mjs';
import { reserveTime, reserveStay, stayNights, conflict, windowCovers, earlyStartMinutes, scheduleRules } from '../scheduling.mjs';

const easternTime = new Intl.DateTimeFormat('en-US',{ timeStyle:'short', timeZone:'America/New_York' });

// Validates the service, pets and time and prices them. `checkPrice` compares the client's total with the quote,
// so a request never goes through at a price the customer didn't see. Returns the booked time too.
function bookingSelection(user, data, { checkPrice = true, exclude = 0 } = {}) {
  requireThat(!user.admin, 'Use a customer account to request care.',403);
  const service = get('SELECT * FROM services WHERE id=?',integer(data.service));
  requireThat(service,'Service not found.',404);
  requireThat(Array.isArray(data.pets) && data.pets.length && data.pets.length <= 12,'Choose at least one pet.');
  const petIds = [...new Set(data.pets.map(value => integer(value)))];
  for (const id of petIds) requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?',id,user.id),'Pet not found.',404);
  const [starts,ends] = timeFor(service,data,user.id,exclude);
  // An overnight stay is priced per night: { arrive, depart } instead of { slot, start }.
  const nights = service.kind === 'overnight' ? stayNights(starts, ends) : [];
  const priced = priceBooking({ service, petCount:petIds.length, starts, ends, nights });
  if (checkPrice) requireThat(priced.total_cents === data.cents,'The price changed. Refresh and review the updated total.',409,'price_changed',{ total_cents:priced.total_cents });
  return {service,petIds,starts,ends,...priced};
}
// The booked time for a choice: a start on the grid for visits, a whole stay for overnights. Returns [starts, ends].
const timeFor = (service, data, holdOwner, exclude = 0) => service.kind === 'overnight'
  ? reserveStay(data.arrive, data.depart, exclude, holdOwner).slice(0, 2)
  : reserveTime(data.slot, service, exclude, data.start, holdOwner);

export default [
  { method:'POST', path:'/api/pets', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to create a pet.', 403);
    const values = [field(data.name,80),field(data.species,60),field(data.details,3000,false)];
    // Every saved profile is kept as a version (C2.5), so a past visit still shows what Myomi was told.
    if (data.id !== undefined) {
      requireThat(run('UPDATE pets SET name=?,species=?,details=? WHERE id=? AND owner=?',...values,integer(data.id),user.id).changes, 'Pet not found.',404);
      recordVersion(data.id);
    } else recordVersion(run('INSERT INTO pets(owner,name,species,details) VALUES(?,?,?,?)',user.id,...values).lastInsertRowid);
    return {};
  } },

  // The itemised price and times for a choice, without holding anything.
  { method:'POST', path:'/api/quote', access:'user', handler:({ user, data }) => {
    const {service,petIds,starts,ends,lines,total_cents} = bookingSelection(user,data,{ checkPrice:false });
    // Gates are reported here so the form can explain them; holds and requests refuse while any remain.
    return {starts,ends,lines,total_cents,blockers:blockers(user,{ service, petIds, starts, ends })};
  } },

  { method:'POST', path:'/api/checkout-hold', access:'user', handler:({ user, data }) => transaction(() => {
    const {service,petIds,starts,ends,lines,total_cents} = bookingSelection(user,data);
    requireNoBlockers(user,{ service, petIds, starts, ends });
    const now = Date.now();
    const expires = Math.min(starts,now + 10*60_000);
    run('DELETE FROM checkout_holds WHERE expires<=? OR owner=?',now,user.id);
    run('INSERT INTO checkout_holds(owner,slot,service,starts,ends,expires) VALUES(?,?,?,?,?,?)',user.id,service.kind === 'overnight' ? 0 : data.slot,service.id,starts,ends,expires);
    return {starts,ends,expires,lines,total_cents};
  }) },

  { method:'POST', path:'/api/checkout-release', access:'user', handler:({ user, data }) => {
    run('DELETE FROM checkout_holds WHERE owner=? AND expires=?',user.id,integer(data.expires));
    return {};
  } },

  { method:'POST', path:'/api/bookings', access:'user', handler:({ user, data }) => {
    return transaction(() => {
      const {service,petIds,starts,ends,lines,total_cents} = bookingSelection(user,data);
      if (data.hold !== undefined) {
        const hold = get('SELECT * FROM checkout_holds WHERE owner=? AND expires=? AND expires>?',user.id,integer(data.hold),Date.now());
        const same = service.kind === 'overnight'
          ? hold?.starts === data.arrive && hold.ends === data.depart
          : hold?.slot === data.slot && hold.starts === data.start && hold.ends === hold.starts + service.minutes * 60_000;
        requireThat(hold && hold.service === service.id && same, 'Your hold expired or the visit changed. Review the booking again.',409,'hold_expired');
      }
      requireNoBlockers(user,{ service, petIds, starts, ends });
      requireThat(!get("SELECT id FROM bookings WHERE owner=? AND status='Requested' AND starts<? AND ends>?",user.id,ends,starts),'You already have a request for this time.',409);
      // A package credit (C3.5) is held for the request when the customer chooses to use one.
      requireThat(data.use_package === undefined || typeof data.use_package === 'boolean','Choose whether to use a package credit.');
      const credit = data.use_package ? holdCredit(user.id,service.id,starts) : null;
      const result = run('INSERT INTO bookings(owner,service,starts,ends,cents,notes,package_balance) VALUES(?,?,?,?,?,?,?)',user.id,service.id,starts,ends,total_cents,field(data.notes,1500,false),credit);
      for (const pet of petIds) run('INSERT INTO booking_pets(booking,pet) VALUES(?,?)',result.lastInsertRowid,pet);
      lines.forEach((line, position) => run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',
        result.lastInsertRowid,position,line.code,line.label,line.quantity,line.cents));
      run('DELETE FROM checkout_holds WHERE owner=?',user.id);
      notify('staff','request_received',bookingParams(result.lastInsertRowid),'request:'+result.lastInsertRowid);
      return { id:result.lastInsertRowid, status:'Requested' };
    });
  } },

  { method:'POST', path:'/api/status', access:'user', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user,data.id);
    // A sitter runs visits (start and complete); approving, declining and cancelling are the owner's.
    const allowed = user.admin ? (transitions[booking.status] || []).filter(status => isOwner(user) || ['In Progress','Completed'].includes(status)) : ['Requested','Confirmed'].includes(booking.status) && booking.starts > Date.now() ? ['Cancelled'] : [];
    requireThat(allowed.includes(data.status),'This booking cannot make that change.',409);
    const service = get('SELECT * FROM services WHERE id=?',booking.service);
    if (data.status === 'Confirmed' && service.kind === 'overnight') {
      // A stay is approved if its nights are still offered and nothing else took them.
      reserveStay(booking.starts,booking.ends,booking.id);
    } else if (data.status === 'Confirmed') {
      requireThat(booking.starts > Date.now() && windowCovers(booking.starts,booking.ends),'This appointment window is no longer available. Reschedule the request before confirming.',409);
      requireThat(!conflict(booking.starts,booking.ends,booking.id,0,service.kind),'This time overlaps another booking. Reschedule the request before confirming.',409);
    }
    if (data.status === 'In Progress') {
      const early = earlyStartMinutes();
      const from = booking.starts - early * 60_000;
      requireThat(Date.now() >= from, 'This visit can start from '+easternTime.format(from)+' ET'+
        (early ? ' ('+early+' minutes before it is booked).' : ', when it is booked.'), 409);
    }
    // A customer cancelling inside the cutoff owes the cancellation fee (C3.2). They must have seen it: the request
    // carries the fee they accepted, and a different fee (the cutoff passed meanwhile) is refused with the new one.
    let cancelFee = booking.cancel_fee_cents;
    if (data.status === 'Cancelled' && !user.admin) {
      cancelFee = cancellationTerms(booking).fee_cents;
      requireThat(!cancelFee || data.accept_fee_cents === cancelFee,'Cancelling now has a fee. Review it before cancelling.',409,'cancel_fee_changed',{ fee_cents:cancelFee });
    }
    if (data.status === 'Cancelled') {
      run('UPDATE bookings SET cancel_fee_cents=? WHERE id=?',cancelFee,booking.id);
      returnCredit(booking);
    }
    if (data.status === 'Confirmed') applyCredit(booking);
    // A pending change ends with the visit: withdrawn if it is cancelled, declined once it starts.
    if (data.status === 'Cancelled') run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE booking=? AND status='Pending'",Date.now(),booking.id);
    if (data.status === 'In Progress') run("UPDATE booking_changes SET status='Declined',decided=? WHERE booking=? AND status='Pending'",Date.now(),booking.id);
    // Confirming records which profile version of each pet the visit was agreed on.
    if (data.status === 'Confirmed') {
      for (const { pet } of all('SELECT pet FROM booking_pets WHERE booking=?',booking.id)) {
        run('UPDATE booking_pets SET profile_version=? WHERE booking=? AND pet=?',recordVersion(pet),booking.id,pet);
      }
    }
    const arrived = data.status === 'In Progress' ? Date.now() : booking.arrived;
    const departed = data.status === 'Completed' ? Date.now() : booking.departed;
    const summary = data.status === 'Completed' ? field(data.summary,3000) : booking.summary;
    // Completing a visit records whether the home was left secured, with an explanation when it wasn't.
    let departure = booking.departure_check;
    if (data.status === 'Completed') {
      requireThat(typeof data.secured === 'boolean','Confirm whether the doors were locked and the home left secured.',400,'departure_check_required');
      const note = typeof data.secure_note === 'string' ? data.secure_note.trim() : '';
      requireThat(data.secured || (note.length >= 3 && note.length <= 500),'Explain what wasn’t secured and what you did about it.',400,'secure_note_required');
      requireThat(note.length <= 500,'Keep the note to 500 characters.');
      departure = JSON.stringify({ secured:data.secured, note:data.secured ? '' : note, at:Date.now() });
    }
    // Collecting the pets well after the planned pickup adds a late-pickup line (half a night, or a night after 8 hours).
    let cents = booking.cents;
    if (data.status === 'Completed' && service.kind === 'overnight') {
      const nightly = get("SELECT cents, quantity FROM booking_lines WHERE booking=? AND code='nightly'",booking.id);
      const line = latePickupLine({ perNightCents:nightly ? Math.round(nightly.cents / nightly.quantity) : service.cents,
        lateMs:departed - booking.ends, graceMs:scheduleRules().late_pickup_grace * 60_000 });
      if (line) {
        const position = (get('SELECT MAX(position) AS last FROM booking_lines WHERE booking=?',booking.id)?.last ?? -1) + 1;
        run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',booking.id,position,line.code,line.label,line.quantity,line.cents);
        cents += line.cents;
      }
    }
    run('UPDATE bookings SET status=?,arrived=?,departed=?,summary=?,departure_check=?,cents=? WHERE id=?',data.status,arrived,departed,summary,departure,cents,booking.id);
    // Messages about the change (C3.6), sent later from the outbox.
    const params = bookingParams(booking.id);
    if (data.status === 'Confirmed') notify(booking.owner,'booking_confirmed',params,'confirmed:'+booking.id);
    if (data.status === 'Cancelled') {
      if (user.admin) notify(booking.owner,'booking_cancelled',params,'cancelled:'+booking.id);
      else notify('staff','customer_cancelled',params,'cancelled:'+booking.id);
    }
    if (data.status === 'In Progress') notify(booking.owner,'visit_started',params,'started:'+booking.id);
    if (data.status === 'Completed') {
      notify(booking.owner,'visit_completed',params,'completed:'+booking.id);
      // Myomi holds this customer's key and has no other visit for them coming up: time to give it back.
      const key = get("SELECT key_label FROM home_access WHERE owner=? AND key_status='with_myomi'",booking.owner);
      if (key && !get("SELECT 1 FROM bookings WHERE owner=? AND id<>? AND status IN ('Requested','Confirmed','In Progress') AND ends>?",booking.owner,booking.id,Date.now())) {
        notify('staff','keys_to_return',{ customer:params.customer, key_label:key.key_label || '' },'keys:'+booking.id);
      }
    }
    // A customer's standing tip (C3.1) is added when the visit is completed, unless they already tipped.
    if (data.status === 'Completed') {
      const percent = get('SELECT auto_tip_percent FROM users WHERE id=?',booking.owner).auto_tip_percent;
      const tip = Math.round(cents * percent / 100);
      if (tip >= 100 && !get("SELECT 1 FROM booking_lines WHERE booking=? AND code='tip'",booking.id)) addTip(booking.id,tip,'Tip ('+percent+'%)');
    }
    return {};
  }) },

  // What cancelling would cost now, and how much of what was paid would be due back.
  { method:'GET', path:'/api/cancellation-preview', access:'user', handler:({ user, url }) => {
    const booking = bookingFor(user,Number(url.searchParams.get('booking')));
    const terms = cancellationTerms(booking);
    const fee = user.admin ? 0 : terms.fee_cents;
    const payment = bookingPayment(booking.id);
    const received = payment.paid_cents - payment.refunded_cents + payment.credit_cents;
    return { ...terms, fee_cents:fee, refund_due_cents:Math.max(0,received - fee) };
  } },

  { method:'POST', path:'/api/reschedule', access:'user', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user,data.id);
    requireThat(!user.admin || isOwner(user),'Only the owner can do this.',403,'owner_only');
    requireThat(['Requested','Confirmed'].includes(booking.status) && (user.admin || booking.starts > Date.now()),'This booking cannot be moved.',409);
    requireThat(get('SELECT kind FROM services WHERE id=?',booking.service).kind !== 'overnight',
      'An overnight stay can’t be moved yet. Cancel it and request new dates.',409,'stay_reschedule_unsupported');
    const minutes = (booking.ends-booking.starts)/60_000;
    const [starts,ends] = reserveTime(data.slot,{ minutes },booking.id,data.start,user.admin ? 0 : user.id);
    // A customer can't move a confirmed visit directly: the visit keeps its time while Myomi decides on the change.
    // A newer request replaces an older pending one.
    if (!user.admin && booking.status === 'Confirmed') {
      const now = Date.now();
      run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE booking=? AND status='Pending'",now,booking.id);
      const id = run("INSERT INTO booking_changes(booking,requested_by,slot,starts,ends,status,created) VALUES(?,?,?,?,?,'Pending',?)",
        booking.id,user.id,integer(data.slot),starts,ends,now).lastInsertRowid;
      return { change:{ id, starts, ends, status:'Pending' } };
    }
    // Requested bookings move directly; staff moves keep the status.
    run('UPDATE bookings SET starts=?,ends=? WHERE id=?',starts,ends,booking.id);
    return {};
  }) },

  // Staff decide on a customer's change request. Approval re-checks the new time, which may have been taken since.
  { method:'POST', path:'/api/changes/decide', access:'owner', handler:({ data }) => transaction(() => {
    const change = get("SELECT * FROM booking_changes WHERE id=? AND status='Pending'",integer(data.id));
    requireThat(change,'This change request is no longer pending.',409,'change_not_pending');
    requireThat(['approve','decline'].includes(data.decision),'Choose approve or decline.');
    const booking = get('SELECT * FROM bookings WHERE id=?',change.booking);
    const now = Date.now();
    if (data.decision === 'approve') {
      requireThat(booking.status === 'Confirmed','Only a confirmed visit can be moved.',409,'change_not_pending');
      const [starts,ends] = reserveTime(change.slot,{ minutes:(change.ends-change.starts)/60_000 },booking.id,change.starts);
      requireThat(windowCovers(starts,ends),'This appointment window is no longer available.',409,'time_unavailable');
      run('UPDATE bookings SET starts=?,ends=? WHERE id=?',starts,ends,booking.id);
    }
    run('UPDATE booking_changes SET status=?,decided=? WHERE id=?',data.decision === 'approve' ? 'Approved' : 'Declined',now,change.id);
    notify(booking.owner,'change_decided',{ ...bookingParams(booking.id), approved:data.decision === 'approve' },'change:'+change.id);
    return {};
  }) },

  { method:'POST', path:'/api/changes/withdraw', access:'user', handler:({ user, data }) => transaction(() => {
    const change = get("SELECT c.* FROM booking_changes c JOIN bookings b ON b.id=c.booking WHERE c.id=? AND c.status='Pending' AND b.owner=?",integer(data.id),user.id);
    requireThat(change,'This change request is no longer pending.',404,'change_not_pending');
    run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE id=?",Date.now(),change.id);
    return {};
  }) },
];
