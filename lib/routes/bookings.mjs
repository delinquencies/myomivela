// Pets, booking requests, status changes and rescheduling.
import { get, all, run, transaction } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { transitions } from '../domain.mjs';
import { isOwner } from '../auth.mjs';
import { bookingFor } from '../bookings.mjs';
import { priceBooking, latePickupLine, checkLaunchCapacity } from '../pricing.mjs';
import { quoteTerms } from '../quote-terms.mjs';
import { terms, depositApplies, depositFor, depositCollection } from '../deposits.mjs';
import { myoConfig } from '../../assets/myo-config.js';
import { blockers, requireNoBlockers, availableMeet } from '../compliance.mjs';
import {config} from '../config.mjs';
import { recordVersion } from '../care.mjs';
import { addTip } from './payments.mjs';
import { cancellationTerms } from '../cancellation.mjs';
import { holdCredit, applyCredit, returnCredit } from '../packages.mjs';
import { notify, bookingParams, emailEnabled } from '../outbox.mjs';
import { bookingRows } from '../bookings.mjs';
import { intakeState } from './intake.mjs';
import { provider } from '../payments.mjs';
import { allowedActions, timeline, nextSteps, visitReference } from '../../assets/visit-state.js';
import { roleOf } from '../../assets/portal-route-state.js';
import { createHash } from 'node:crypto';
import { bookingPayment } from '../ledger.mjs';
import { reserveTime, reserveStay, stayNights, conflict, windowCovers, earlyStartMinutes, scheduleRules, requireMeetNotice } from '../scheduling.mjs';

const easternTime = new Intl.DateTimeFormat('en-US',{ timeStyle:'short', timeZone:'America/New_York' });

// Validates the service, pets and time and prices them. `checkPrice` compares the client's total with the quote,
// so a request never goes through at a price the customer didn't see. Returns the booked time too.
function bookingSelection(user, data, { checkPrice = true, exclude = 0 } = {}) {
  requireThat(!user.admin, 'Use a customer account to request care.',403);
  const service = get('SELECT * FROM services WHERE id=?',integer(data.service));
  requireThat(service,'Service not found.',404);
  requireThat(Array.isArray(data.pets) && data.pets.length && data.pets.length <= 12,'Choose at least one pet.');
  const petIds = [...new Set(data.pets.map(value => integer(value)))];
  // The primary pet is priced at the base (or puppy) rate and the others as additional pets. The client may name it
  // with `primary_pet`; otherwise the first pet listed is primary, as before.
  if (data.primary_pet !== undefined) {
    requireThat(Number.isSafeInteger(data.primary_pet) && petIds.includes(data.primary_pet),'Choose the primary pet from the pets attending.',400,'invalid_primary_pet');
    petIds.splice(petIds.indexOf(data.primary_pet),1);
    petIds.unshift(data.primary_pet);
  }
  const pets = petIds.map(id => get('SELECT * FROM pets WHERE id=? AND owner=?',id,user.id));
  requireThat(pets.every(Boolean),'Pet not found.',404);
  const [starts,ends] = timeFor(service,data,user.id,exclude);
  requireMeetNotice(service,starts);
  checkLaunchCapacity(starts,ends,exclude);
  const nights = service.kind === 'overnight' ? stayNights(starts,ends) : [];
  const priced = priceBooking({service,petCount:petIds.length,pets,starts,ends,nights});
  if (checkPrice) requireThat(priced.total_cents === data.cents,'The price changed. Refresh and review the updated total.',409,'price_changed',{ total_cents:priced.total_cents });
  return {service,petIds,starts,ends,...priced};
}
// The booked time for a choice: a start on the grid for visits, a whole stay for overnights. Returns [starts, ends].
const timeFor = (service, data, holdOwner, exclude = 0) => service.kind === 'overnight'
  ? reserveStay(data.arrive, data.depart, exclude, holdOwner).slice(0, 2)
  : reserveTime(data.slot, service, exclude, data.start, holdOwner);


function movedPrice(booking,starts,ends) {
  checkLaunchCapacity(starts,ends,booking.id);
  if(config.pricingMode === 'catalog')return {total_cents:booking.cents};
  const service=get('SELECT * FROM services WHERE id=?',booking.service);
  const pets=all('SELECT p.* FROM pets p JOIN booking_pets bp ON bp.pet=p.id WHERE bp.booking=? ORDER BY CASE WHEN p.id=? THEN 0 ELSE 1 END,p.id',booking.id,booking.primary_pet);
  requireNoBlockers({id:booking.owner},{service,petIds:pets.map(p=>p.id),starts,ends,bookingId:booking.id});
  return priceBooking({service:{...service,minutes:(ends-starts)/60000},pets,petCount:pets.length,starts,ends});
}
function saveMovedPrice(booking,starts,ends,priced) {
  run('UPDATE bookings SET starts=?,ends=?,cents=? WHERE id=?',starts,ends,priced.total_cents,booking.id);
  if(!priced.lines)return;
  run('DELETE FROM booking_lines WHERE booking=?',booking.id);
  for(const [position,line] of priced.lines.entries())run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',booking.id,position,line.code,line.label,line.quantity,line.cents);
}

// What a request's confirmation and the visit page show (CUX-05): reference, stable link, timeline, next steps for the
// customer, the actions to offer this person, the latest diary update, and how the receipt is being delivered.
function visitView(user, booking) {
  const role = roleOf(user);
  // Care intake is a launch-mode requirement; catalog mode never asks for it.
  const intake = role !== 'customer' ? null : config.pricingMode === 'catalog' ? 'complete'
    : intakeState(user.id, booking.service_kind === 'overnight' ? 'overnight' : 'walk').state;
  const latest = get('SELECT id, kind, pet, published FROM events WHERE booking=? ORDER BY published DESC, id DESC LIMIT 1', booking.id) ?? null;
  const paymentsEnabled = Boolean(provider());
  const revision = createHash('sha256').update(JSON.stringify([booking.status, booking.starts, booking.ends, booking.cents,
    booking.payment?.status, booking.payment?.balance_cents, booking.pending_change?.id ?? null, latest?.id ?? null])).digest('hex').slice(0, 16);
  return { reference:visitReference(booking.id), href:'#visit/' + booking.id, timeline:timeline(booking),
    allowed_actions:allowedActions(booking, { role, earlyStartMinutes:earlyStartMinutes(), paymentsEnabled }),
    ...(role === 'customer' ? { next_steps:nextSteps(booking, { intakeState:intake, paymentsEnabled }) } : {}),
    latest_event:latest, revision };
}
function confirmation(user, id) {
  const [booking] = bookingRows(user, 'b.id=?', [id], '');
  const view = visitView(user, booking);
  return { reference:view.reference, href:'#book/done/' + id, next_steps:view.next_steps, timeline:view.timeline,
    // Receipts are always queued; 'unavailable' means no email provider is connected, so nothing leaves yet.
    notifications:{ client:emailEnabled() ? 'queued' : 'unavailable', staff:emailEnabled() ? 'queued' : 'unavailable' } };
}

export default [
  // One booking, for its owner or staff (404 for anyone else): the booking plus its visit view (CUX-05).
  { method:'GET', path:/^\/api\/bookings\/(\d+)$/, access:'user', handler:({ user, match }) => {
    const id = Number(match[1]);
    requireThat(Number.isSafeInteger(id) && id > 0, 'Booking not found.', 404);
    const [booking] = bookingRows(user, 'b.id=?', [id], '');
    requireThat(booking, 'Booking not found.', 404);
    return { booking, ...visitView(user, booking) };
  } },

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
    const nights = service.kind === 'overnight' ? stayNights(starts,ends) : [];
    return {starts,ends,lines,total_cents,primary_pet:petIds[0],...quoteTerms({ service, starts, ends, nights, lines, total_cents }),blockers:blockers(user,{ service, petIds, starts, ends })};
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
      requireThat(data.use_package === undefined || typeof data.use_package === 'boolean','Choose whether to use a package credit.');
      const credit = data.use_package ? holdCredit(user.id,service.id,starts) : null;
      const meet=config.pricingMode==='launch'&&service.kind!=='meet'?availableMeet(user.id)?.id:null;
      // Launch terms (CUX-04): the client accepts the current terms version (a different one is refused with the new
      // terms), and a paid request owes a 50% deposit within 48 hours of being sent.
      const current = terms(starts);
      requireThat(data.accept_terms_version === undefined || data.accept_terms_version === current.version,
        'Our booking terms have changed. Please review them before sending your request.',409,'terms_changed',{ terms:current });
      const now = Date.now();
      const deposit = depositApplies(service,total_cents) ? depositFor(total_cents) : 0;
      const result = run(`INSERT INTO bookings(owner,service,starts,ends,cents,notes,package_balance,meet_booking,primary_pet,created,
        deposit_cents,deposit_due_at,terms_version,terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        user.id,service.id,starts,ends,total_cents,field(data.notes,1500,false),credit,meet||null,petIds[0],now,
        deposit,deposit ? now + myoConfig.booking.depositHours * 60 * 60_000 : null,
        data.accept_terms_version === undefined ? null : current.version,data.accept_terms_version === undefined ? null : now);
      for (const pet of petIds) run('INSERT INTO booking_pets(booking,pet) VALUES(?,?)',result.lastInsertRowid,pet);
      lines.forEach((line, position) => run('INSERT INTO booking_lines(booking,position,code,label,quantity,cents) VALUES(?,?,?,?,?,?)',
        result.lastInsertRowid,position,line.code,line.label,line.quantity,line.cents));
      run('DELETE FROM checkout_holds WHERE owner=?',user.id);
      const id = Number(result.lastInsertRowid);
      notify('staff','request_received',bookingParams(id),'request:'+id);
      // The client's own receipt (CUX-05): queued now, sent once an email provider is connected.
      notify(user.id,'request_received_client',bookingParams(id),'request-client:'+id);
      if (deposit) notify(user.id,'deposit_due',{ ...bookingParams(id), deposit_cents:deposit, due_at:now + myoConfig.booking.depositHours * 60 * 60_000,
        collection:depositCollection() },'deposit-due:'+id);
      return { id, status:'Requested', ...confirmation(user, id) };
    });
  } },

  { method:'POST', path:'/api/status', access:'user', handler:({ user, data }) => transaction(() => {
    const booking = bookingFor(user,data.id);
    // A sitter runs visits (start and complete); approving, declining and cancelling are the owner's.
    const allowed = user.admin ? (transitions[booking.status] || []).filter(status => isOwner(user) || ['In Progress','Completed'].includes(status)) : ['Requested','Confirmed'].includes(booking.status) && booking.starts > Date.now() ? ['Cancelled'] : [];
    requireThat(allowed.includes(data.status),'This booking cannot make that change.',409,'invalid_transition',{ status:booking.status });
    if (data.status === 'Confirmed') run('UPDATE bookings SET confirmed_at=? WHERE id=?',Date.now(),booking.id);
    if (data.status === 'Cancelled') run('UPDATE bookings SET cancelled_at=?, cancel_reason=? WHERE id=?',Date.now(),user.admin ? 'staff' : 'customer',booking.id);
    // Myomi confirms a paid request only once its deposit is in (recorded by hand or paid online).
    if (data.status === 'Confirmed' && booking.deposit_cents > 0) {
      const payment = bookingPayment(booking.id);
      requireThat(payment.paid_cents - payment.refunded_cents + payment.credit_cents >= booking.deposit_cents,
        'The deposit hasn’t been received yet. Record it under the booking first.',409,'deposit_unpaid',{ deposit_cents:booking.deposit_cents });
    }
    const service = get('SELECT * FROM services WHERE id=?',booking.service);
    if (data.status === 'Confirmed') checkLaunchCapacity(booking.starts,booking.ends,booking.id);
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


  {method:'POST',path:'/api/reschedule-quote',access:'user',handler:({user,data})=>{
    requireThat(!user.admin || isOwner(user),'Owner access is required.',403);
    const booking=bookingFor(user,data.id);
    requireThat(['Requested','Confirmed'].includes(booking.status),'This booking cannot be moved.',409);
    requireThat(get('SELECT kind FROM services WHERE id=?',booking.service).kind!=='overnight','Cancel and request new dates for an overnight stay.',409,'stay_reschedule_unsupported');
    const [starts,ends]=reserveTime(data.slot,{minutes:(booking.ends-booking.starts)/60000},booking.id,data.start,user.id);
    return {starts,ends,...movedPrice(booking,starts,ends)};
  }},
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
    if (!user.admin) requireMeetNotice(get('SELECT kind FROM services WHERE id=?',booking.service),starts);
    const priced=movedPrice(booking,starts,ends);
    requireThat(config.pricingMode==='catalog'||data.cents===priced.total_cents,'Review the updated price before moving this visit.',409,'price_changed',{total_cents:priced.total_cents});
    // A customer can't move a confirmed visit directly: the visit keeps its time while Myomi decides on the change.
    // A newer request replaces an older pending one.
    if (!user.admin && booking.status === 'Confirmed') {
      const now = Date.now();
      run("UPDATE booking_changes SET status='Withdrawn',decided=? WHERE booking=? AND status='Pending'",now,booking.id);
      const id = run("INSERT INTO booking_changes(booking,requested_by,slot,starts,ends,status,created,proposed_cents) VALUES(?,?,?,?,?,'Pending',?,?)",
        booking.id,user.id,integer(data.slot),starts,ends,now,priced.total_cents).lastInsertRowid;
      return { change:{ id, starts, ends, status:'Pending' } };
    }
    // Requested bookings move directly; staff moves keep the status.
    saveMovedPrice(booking,starts,ends,priced);
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
      const priced=movedPrice(booking,starts,ends);
      requireThat(config.pricingMode==='catalog'||priced.total_cents===(change.proposed_cents??booking.cents),'The new price needs to be reviewed again.',409,'price_changed');
      saveMovedPrice(booking,starts,ends,priced);
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
