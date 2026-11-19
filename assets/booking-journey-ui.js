// DOM/storage adapter for Claude's CUX-02 controller; booking rules stay in that module and the API.
import {createIntent,reduce,flowState,serialize,restore} from './booking-flow-state.js';
import {t} from './i18n.js';
import {escapeHtml as text} from './diary.js';

const storageKey = 'myo-booking-intent';
const meetingKey = storageKey+'-meeting';
const entryKey = storageKey+'-entry';
const returnKey = storageKey+'-meeting-return';
const read = key => {try {return sessionStorage.getItem(key);} catch {return null;}};
const write = (key,value) => {try {if(value) sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);} catch { /* in-memory journey still works */ }};
const stepLabels = {service:'Choose care',details:'Choose dates',requirements:'Care requirements',review:'Review',done:'Request sent'};
const requirementLabels = {account:'Your account',intake:'Care details',meet:'Meet & Greet',vaccines:'Vaccination records',agreement:'Service agreement'};

export function createBookingJourney(app,getData) {
  const panel = document.createElement('aside');
  panel.className = 'booking-journey';panel.hidden = true;app.before(panel);
  let intent,meeting,userId,active = Boolean(location.hash.startsWith('#book') || new URLSearchParams(location.search).has('service'));
  let entryApplied = false,restoring = false,suspended = false,meetingReturnPending = read(returnKey) === '1';
  const isMeeting = () => active && (new URLSearchParams(location.search).get('service') === 'meet' || meetingReturnPending) && intent?.selection.service &&
    getData()?.services.find(service => service.id === intent.selection.service)?.kind !== 'meet';
  const current = () => {
    if (!isMeeting()) return intent;
    meeting ??= restore(read(meetingKey),userId) || createIntent({userId});
    return meeting;
  };
  const save = () => {if(active){write(storageKey,serialize(intent));if(meeting) write(meetingKey,serialize(meeting));}};
  const dispatch = event => {
    if (!intent || !active) return;
    if (isMeeting()) meeting = reduce(current(),event);else intent = reduce(intent,event);
    save();paint();
  };
  const returnHref = () => {
    const url = new URL(flowState(intent).resumeLocation,location.href);
    url.searchParams.delete('service');url.searchParams.delete('rate');
    return url.pathname+url.search+url.hash;
  };
  function paint() {
    const data = getData();
    const relevant = /^#(?:book(?:\/|$)|care$|pets(?:\/|$)|pet\/)/.test(location.hash) || (isMeeting() && location.hash === '#upcoming');
    panel.hidden = !active || !intent?.selection.service || !data?.user || data.user.admin || !relevant;
    if (panel.hidden) return;
    const state = flowState(isMeeting() ? intent : current());
    panel.setAttribute('aria-label',t('Booking progress'));
    const requirements = [...state.prerequisites];
    for (const [id,done] of [['account',Boolean(data.user)],['intake',data.intake?.complete === true],['meet',data.meet_status === 'done'],['agreement',Boolean(data.agreement?.accepted_at)]]) {
      if (done && !requirements.some(item => item.id === id)) requirements.push({id,status:'done'});
    }
    const list = requirements.map(item => {
      const status = item.id === 'meet' && data.meet_status === 'scheduled' ? 'scheduled' : item.status;
      return '<li><span>'+text(t(requirementLabels[item.id]))+'</span> <strong>'+text(t(status === 'done' ? 'Done' : status === 'scheduled' ? 'Scheduled' : 'To do'))+'</strong></li>';
    }).join('');
    const next = state.nextAction;
    const meetingScheduled = next.code === 'resolve_meet' && data.meet_status === 'scheduled';
    const bookingScreen = /^#book(?:$|\/(?:service|details|about|review)$)/.test(location.hash);
    const ready = ['review','send_request'].includes(next.code);
    panel.innerHTML = '<h2>'+text(t('Your booking, one step at a time'))+'</h2><ol class="booking-progress" aria-label="'+text(t('Booking progress'))+'">'+state.steps.map((step,index) => '<li'+(step.current ? ' aria-current="step"' : '')+'><span aria-hidden="true">'+(step.done ? '✓' : index+1)+'</span> '+(step.id === 'done' ? text(t(stepLabels[step.id])) : '<a href="'+step.href+'">'+text(t(stepLabels[step.id]))+'</a>')+'</li>').join('')+'</ol>'+
      (isMeeting() ? '<p>'+text(t('Your Meet & Greet is a separate free appointment. Your care choices are saved; those care dates are not reserved.'))+'</p>' : '')+
      (list ? '<ul class="booking-requirements">'+list+'</ul>' : '<p>'+text(t(ready ? 'Your care requirements are ready. Review the details before sending.' : 'Choose your care and dates. We’ll show what is needed before review.'))+'</p>')+
      (isMeeting() ? '<a class="tap-link" href="'+returnHref()+'">🐾 '+text(t('Return to your care request'))+'</a>'
        : bookingScreen ? (next.code.startsWith('resolve_') ? '<a class="tap-link" href="'+(meetingScheduled ? '#upcoming' : next.href)+'">🐾 '+text(t(meetingScheduled ? 'View your scheduled Meet & Greet' : 'booking.next.'+next.code))+'</a>' : '')
          : '<a class="tap-link" href="'+next.href+'">🐾 '+text(t('Continue booking'))+'</a>');
  }
  return {
    bind(data) {
      const nextId = data?.user?.id ?? null;
      if (!intent || nextId !== userId) {
        intent = restore(read(storageKey),nextId) || (intent && userId === null ? reduce(intent,{type:'signed_in',userId:nextId}) : createIntent({userId:nextId}));
        meeting = restore(read(meetingKey),nextId);
        userId = nextId;
        active ||= Boolean(intent.selection.service);
      }
      if (data?.user?.admin) {active = false;write(storageKey,null);write(meetingKey,null);}
      paint();
    },
    begin() {
      let returning = false;
      if(getData()?.user && !getData().user.admin) {
        if(meetingReturnPending && new URLSearchParams(location.search).get('service') !== 'meet') {
          returning = true;
          meetingReturnPending = false;meeting = null;write(returnKey,null);write(meetingKey,null);
        }
        if(intent?.sent) intent = createIntent({userId});
        active = true;
      }
      return returning;
    },
    restoreForm(form,rebuild) {
      if (!active || !intent) return;
      if (meetingReturnPending && !location.hash.startsWith('#book')) return;
      restoring = true;
      try {
      const initialService = Number(form.querySelector('[name="service"]:checked')?.value) || null;
      const entry = new URLSearchParams(location.search);const stamp = [entry.get('service'),entry.get('rate')].join(':');
      if (!entryApplied && entry.has('service') && !isMeeting() && read(entryKey) !== stamp) {
        intent = reduce(intent,{type:'select',changes:{service:initialService}});write(entryKey,stamp);
      }
      entryApplied = true;
      const selected = current().selection;
      if (!selected.service) return;
      const service = form.querySelector('[name="service"][value="'+selected.service+'"]');
      if (service) {service.checked = true;rebuild();}
      for (const pet of form.querySelectorAll('[name="pets"]')) pet.checked = selected.pets.includes(Number(pet.value));
      const date = form.querySelector('[name="day"][value="'+selected.date+'"]');
      if (date) {date.checked = true;form.dataset.explicitDay = '1';rebuild(date);}
      const time = form.querySelector('[name="slot"][value="'+selected.slot+':'+selected.start+'"]');
      if (time) time.checked = true;
      for (const [key,value] of [['stay_start',selected.arrive],['stay_end',selected.depart]]) {
        if (!value || !form.elements[key]) continue;
        const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value);
        const get = name => parts.find(part => part.type === name).value;
        form.elements[key].value = get('year')+'-'+get('month')+'-'+get('day');
        form.elements[key === 'stay_start' ? 'drop_time' : 'pick_time'].value = get('hour')+':'+get('minute');
      }
      if (form.elements.notes) form.elements.notes.value = selected.notes;
      } finally {restoring = false;}
    },
    select(changes) {
      if (!active || !intent) return null;
      if (restoring || suspended) return current().revision;
      if (changes.service !== current().selection.service) dispatch({type:'select',changes:{service:changes.service}});
      dispatch({type:'select',changes});return current().revision;
    },
    quoted(quote,revision) {dispatch({type:'quoted',quote,revision,signedIn:Boolean(getData()?.user),meetStatus:getData()?.meet_status});},
    held(expires) {dispatch({type:'held',expires});},
    notes(value) {dispatch({type:'select',changes:{notes:value}});},
    suspend() {suspended = true;},
    resume() {suspended = false;},
    expired() {dispatch({type:'hold_expired'});},
    completed(id) {if(intent && active){intent = reduce(intent,{type:'requirement_done',id});save();paint();}},
    addedPet(id) {if(intent && active && !isMeeting()) dispatch({type:'select',changes:{pets:[...new Set([...intent.selection.pets,id])]}});},
    sent(booking) {
      const detour = isMeeting();dispatch({type:'sent',booking});
      if (detour) {meeting = null;meetingReturnPending = true;write(returnKey,'1');intent = reduce(intent,{type:'requirement_done',id:'account'});save();}
      else {active = false;write(storageKey,null);write(meetingKey,null);write(returnKey,null);}
      paint();
    },
    clear() {active = false;intent = null;meeting = null;meetingReturnPending = false;for(const key of [storageKey,meetingKey,entryKey,returnKey]) write(key,null);paint();},
    get active() {return active;},
    get meetingDetour() {return Boolean(isMeeting() && new URLSearchParams(location.search).get('service') === 'meet');},
    paint,
  };
}
