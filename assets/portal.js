import { activityIcons, escapeHtml as text, formatVisitDate as date, renderDiaryVisits } from './diary.js';
import { createDrafts } from './drafts.js';
import { googleReviewLinks } from './review-links.js';
import { showPriceSheet } from './price-sheet.js';

const app = document.querySelector('#app');
const feedback = document.querySelector('#feedback');
const dismissFeedback = document.querySelector('#dismiss-feedback');
function showPublicationFeedback(message, visible = Boolean(message)) {
  feedback.parentElement.classList.toggle('is-notice', visible);
  dismissFeedback.hidden = !visible;
  feedback.textContent = message;
}
dismissFeedback.addEventListener('click', () => showPublicationFeedback(''));
const logout = document.querySelector('#logout');
const accountLink = document.querySelector('#account-link');
const portalMenu = document.querySelector('.portal-menu');
const portalLinks = document.querySelector('#portal-links');
const cancelDialog = document.querySelector('#cancel-booking');
const find = (rows,id) => rows.find(row => row.id === id);
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents / 100);
const day = value => new Intl.DateTimeFormat('en-CA',{dateStyle:'short',timeZone:'America/New_York'}).format(value);
const emoji = icon => icon ? '<span class="control-icon" aria-hidden="true">'+icon+'</span> ' : '';
const button = (label, style = '', icon = '') => '<button class="'+style+'" type="submit">'+emoji(icon)+text(label)+'</button>';
const form = (action, contents, id = '') => '<form data-action="'+action+'" data-id="'+id+'">'+contents+'</form>';
const input = (label,name,attributes = '') => '<label>'+label+'<input name="'+name+'" '+attributes+'></label>';
const area = (label,name,value = '',max = 3000) => '<label>'+label+'<textarea maxlength="'+max+'" name="'+name+'">'+text(value)+'</textarea></label>';
const serviceIcons = { 'Dog walking':'🦮', 'Drop-in visit':'🏠', 'Overnight pet sitting':'🌙' };
const tapLink = (href,label,icon) => '<a class="tap-link" href="'+text(href)+'">'+emoji(icon)+text(label)+'</a>';
const serviceNames = new Map([
  ['pet-sitting', 'Overnight pet sitting'],
  ['dog-walking', 'Dog walking'],
  ['drop-in', 'Drop-in visit'],
]);
const requestedService = () => serviceNames.get(new URLSearchParams(location.search).get('service'));
const requestedRate = () => new URLSearchParams(location.search).get('rate');
const bookingIntake = '#pet-intake';
const drafts = createDrafts();
let data;
let diaryFilterValue = '';
const diaryVisitOptions = new Map();

// `key` (optional) is an Idempotency-Key: the server runs a write once per key and replays its answer to repeats,
// so a write can be retried safely when the connection drops before the answer arrives.
async function api(path, payload, key) {
  const options = payload === undefined ? {} : {
    method:'POST', headers:{ 'Content-Type':'application/json', ...(key ? { 'Idempotency-Key':key } : {}) }, body:JSON.stringify(payload),
  };
  let response;
  for (let attempt = 0; ; attempt++) {
    try { response = await fetch('/api/'+path, options); break; }
    catch (error) {
      // fetch only throws when no answer arrived. Retry keyed writes twice, then let the person retry by hand.
      if (!key || attempt === 2) throw Object.assign(new Error('The connection dropped. Check your signal and tap the button again; it will not be saved twice.'), { network:true });
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
    }
  }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Please try again.'), { status:response.status });
  return result;
}
// One key per form submission. It survives a dropped connection (so tapping again replays rather than repeats)
// and is replaced when the form's content changes or the server has answered.
const pendingKeys = new WeakMap();
function requestKey(form, body) {
  const pending = pendingKeys.get(form);
  if (pending?.body === body) return pending.key;
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  pendingKeys.set(form, { key, body });
  return key;
}
function auth() {
  const staffEntry = new URLSearchParams(location.search).get('staff') === '1';
  if (staffEntry) {
    document.querySelector('.portal h1').textContent = 'Staff sign-in.';
    app.innerHTML = '<p>Sign in to start visits and publish Pet Diary updates.</p>'+
      form('login',input('Email','email','required type="email" maxlength="254" autocomplete="username"')+
        input('Password','password','required type="password" maxlength="128" autocomplete="current-password"')+
        button('Sign in','','🔑'))+
      tapLink('./index.html','Go to the Client Portal','🐾');
    return;
  }
  document.querySelector('.portal h1').textContent = 'Client portal.';
  const emailField = input('Email','email','required type="email" maxlength="254" autocomplete="email"');
  const service = requestedService();
  const bookingPrompt = service ? 'Sign in or create an account to request '+text(service.toLowerCase())+'.'
    : 'Sign in or create an account to request a visit.';
  const bookingEntry = ['#book', bookingIntake].includes(location.hash);
  app.innerHTML = (bookingEntry ? '<p>'+bookingPrompt+'</p>' : '<p>Sign in to manage bookings, pet profiles, and your Pet Diary.</p>') +
    '<button type="button" class="secondary auth-jump" data-create-account>New here? Create an account</button>'+
    (bookingEntry ? '<section class="auth-availability"><h2>Prices &amp; availability</h2><p>Times shown in Massachusetts time. Myomi confirms each request.</p>'+
      '<div data-auth-price-sheet aria-live="polite"></div></section>' :
      '<p><a class="text-link" href="../index.html#services">See services and prices</a></p>')+'<div class="grid">'+
    form('login','<h2>Sign in</h2>'+emailField+input('Password','password','required type="password" maxlength="128" autocomplete="current-password"')+button('Sign in','','🔑'))+
    form('register','<h2 tabindex="-1">Create an account</h2>'+input('Name','name','required maxlength="100" autocomplete="name"')+
      emailField+input('Password','password','required type="password" minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="registration-password-tip"')+
      '<small id="registration-password-tip">Use at least 12 characters for your password.</small>'+
      '<p class="pet-field-error" data-registration-error role="alert"></p>'+button('Create account','','👋'))+'</div>';
  if (bookingEntry) showPriceSheet(app.querySelector('[data-auth-price-sheet]'),{service,rate:requestedRate()});
}
const profileGroups = [
  ['About your pet', [['breed','Breed'],['sex','Sex'],['age','Age or birthday'],['weight','Weight (lb)']]],
  ['Medical requirements', [['health','Health conditions'],['medication','Medication and schedule'],['heartworm','Heartworm protection'],['allergies','Allergies and care instructions'],['vaccinations','Vaccinations']]],
  ['Dietary requirements', [['food','Food and type'],['portion','Portion size'],['feeding','Feeding schedule'],['restrictions','Food and treat restrictions']]],
  ['Emergency contacts', [['vet','Veterinary clinic'],['vetPhone','Vet phone number'],['contact','Emergency contact name'],['contactPhone','Emergency contact phone number']]],
  ['Daily care', [['behavior','Temperament and triggers'],['notes','Other care instructions']]],
];
const profileFields = profileGroups.flatMap(([, fields]) => fields);
const petFieldTips = {
  name:'Use the name your pet responds to.',
  species:'Enter the type of animal, such as dog, cat, or rabbit.',
  breed:'A best guess is fine. You can also enter mixed breed or leave it blank.',
  sex:'Enter what you know, including whether your pet is spayed or neutered if relevant.',
  age:'Enter an approximate age or a birthday, such as 4 years or May 2022.',
  weight:'Enter the weight in pounds, such as 12 or 12.5.',
  health:'List any conditions or symptoms Myomi should watch for.',
  medication:'Include the medication name, dose, and when and how to give it.',
  heartworm:'Include the preventive and the last or next dose if you know it.',
  allergies:'List known allergies, what to avoid, and what to do if there’s a reaction.',
  vaccinations:'List relevant vaccines and dates if you have them handy.',
  food:'Include the brand, flavor, or recipe so Myomi can find the right food.',
  portion:'Enter the amount per meal with units, such as ½ cup.',
  feeding:'List meal times and where the food and bowls are kept.',
  restrictions:'Include foods or treats to avoid and any limits on treats.',
  vet:'Enter the clinic your pet normally visits.',
  vetPhone:'Enter the clinic’s number. You can include an area code and extension.',
  contact:'Enter someone Myomi can call if she can’t reach you.',
  contactPhone:'Enter the best number for your emergency contact.',
  behavior:'Describe what helps your pet feel safe and anything that may scare or upset them.',
  notes:'Add routines or instructions that don’t fit elsewhere.',
};
function profileData(details) {
  if (!details) return {};
  try {
    const saved = JSON.parse(details);
    if (saved?.profileVersion === 1) return saved;
  } catch { /* Existing profiles may contain plain text. */ }
  return { notes: details };
}
function profileSummary(pet) {
  const saved = profileData(pet.details);
  const sections = profileGroups.map(([group, fields], index) => {
    const entries = fields.filter(([key]) => saved[key]).map(([key,label]) =>
      '<dt>'+label+'</dt><dd class="preserve">'+text(saved[key])+'</dd>').join('');
    const details = index === 0 ? '<dt>Species</dt><dd>'+text(pet.species)+'</dd>'+entries : entries;
    return '<li class="pet-profile-card"><h4>'+group+'</h4>'+
      (details ? '<dl>'+details+'</dl>' : '<p>No details added.</p>')+'</li>';
  });
  return swipeCards(sections,'Section',pet.name+'’s care profile','pet-profile-rail');
}
function petField(pet, key, label, value, { required = false, max = 120, multiline = false } = {}) {
  const id = 'pet-'+(pet?.id ?? 'new')+'-'+key;
  const attrs = 'id="'+id+'" name="'+key+'" maxlength="'+max+'" aria-describedby="'+id+'-tip '+id+'-error"'+
    (required ? ' required' : '');
  const control = multiline
    ? '<textarea '+attrs+'>'+text(value)+'</textarea>'
    : '<input '+attrs+' value="'+text(value)+'"'+(key.endsWith('Phone') ? ' type="tel"' : '')+
      (key === 'weight' ? ' inputmode="decimal"' : '')+'>';
  return '<div class="pet-field"><div class="pet-field-heading"><label for="'+id+'">'+label+
    (required ? ' <span class="pet-required">(required)</span>' : '')+'</label>'+
    '<details class="pet-field-tip"><summary aria-label="Help for '+label+'">?</summary>'+
    '<p id="'+id+'-tip">'+petFieldTips[key]+'</p></details></div>'+control+
    '<p class="pet-field-error" id="'+id+'-error" hidden></p></div>';
}
function petForm(pet) {
  const saved = profileData(pet?.details);
  const groups = profileGroups.map(([group, fields], index) => {
    const extraFields = '<div class="grid">'+fields.map(([key,label]) => {
      const multiline = ['health','medication','allergies','behavior','notes','restrictions'].includes(key);
      const max = key === 'notes' ? 3000 : multiline ? 280 : 120;
      return petField(pet,key,label,saved[key],{ max,multiline });
    }).join('')+'</div>';
    const basics = index === 0 ? petField(pet,'name','Pet name',pet?.name,{ required:true, max:80 })+
      petField(pet,'species','Species',pet?.species,{ required:true, max:60 }) : '';
    return '<fieldset'+(pet ? '' : ' data-pet-card'+(index ? ' hidden' : ''))+'><legend'+
      (pet ? '' : ' tabindex="-1"')+'>'+group+(index && !pet ? ' <span class="pet-required">(optional)</span>' : '')+'</legend>'+
      basics+(!pet && index === 0 ? '<details class="pet-optional"><summary>Add more details (optional)</summary>'+extraFields+'</details>' : extraFields)+'</fieldset>';
  });
  const start = '<form data-action="pets" data-id="'+(pet?.id ?? '')+'" novalidate>';
  if (pet) return start+swipeCards(groups.map(group => '<li class="pet-profile-card">'+group+'</li>'),
    'Section','Edit '+pet.name+'’s profile','pet-profile-rail')+button('Save changes','','🐾')+'</form>';
  return start+'<p class="pet-step-count" data-pet-step-count>Step 1 of '+profileGroups.length+'</p>'+
    groups.join('')+'<div class="pet-step-actions"><button type="button" class="secondary" data-pet-back hidden>Back</button>'+
    button('Save & continue')+'</div><p class="pet-draft-note">Your draft stays in this tab until you add your pet.</p></form>';
}
function petFieldError(field, message) {
  const error = field.closest('.pet-field').querySelector('.pet-field-error');
  if (message) field.setAttribute('aria-invalid','true');
  else field.removeAttribute('aria-invalid');
  error.textContent = message;
  error.hidden = !message;
}
function validatePetFields(form, fields) {
  let firstError;
  for (const field of fields) {
    const value = field.value.trim();
    let message = '';
    if (field.required && !value) {
      message = field.name === 'name' ? 'Enter your pet’s name.' : 'Enter your pet’s species.';
    } else if (value.length > field.maxLength) {
      message = 'Use '+field.maxLength+' characters or fewer.';
    } else if (value && (!form.dataset.id || field.value !== field.defaultValue)) {
      if (field.name === 'weight' && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0)) {
        message = 'Enter a weight above zero in pounds, such as 12.5.';
      } else if (field.type === 'tel') {
        const number = value.replace(/\s*(?:ext\.?|x|#)\s*\d+$/i,'');
        const digits = number.replace(/\D/g,'').length;
        if (!/^\+?[\d ().-]+$/.test(number) || digits < 7 || digits > 15) message = 'Enter a phone number with 7 to 15 digits.';
      }
    }
    petFieldError(field,message);
    if (message && !firstError) firstError = field;
  }
  if (!firstError) return true;
  const card = firstError.closest('[data-pet-card]');
  if (card?.hidden) showPetCard(form,[...form.querySelectorAll('[data-pet-card]')].indexOf(card));
  const optional = firstError.closest('.pet-optional');
  if (optional) optional.open = true;
  const swipeCard = firstError.closest('.pet-profile-rail > li');
  if (swipeCard) moveToSwipeCard(swipeCard,'instant');
  firstError.focus();
  return false;
}
function updatePetStepButton(form, card) {
  const step = Number(form.dataset.draftStep || 0);
  const hasAnswers = [...card.querySelectorAll('input, textarea')].some(field => field.value.trim());
  form.querySelector('button[type="submit"]').textContent = step === profileGroups.length-1 ? 'Add pet' :
    step > 0 && !hasAnswers ? 'Skip for now' : 'Save & continue';
}
function showPetCard(form, step, focus = false) {
  const cards = [...form.querySelectorAll('[data-pet-card]')];
  if (!cards[step]) return;
  form.dataset.draftStep = step;
  cards.forEach((card,index) => { card.hidden = index !== step; });
  form.querySelector('[data-pet-step-count]').textContent = 'Step '+(step+1)+' of '+cards.length;
  form.querySelector('[data-pet-back]').hidden = step === 0;
  updatePetStepButton(form,cards[step]);
  if (focus) {
    cards[step].querySelector('legend').focus({preventScroll:true});
    form.querySelector('[data-pet-step-count]').scrollIntoView({block:'start',behavior:'instant'});
  }
}
// The server already removes times held by confirmed visits; this only checks the visit fits before the window ends.
function availableSlots(minutes, serviceId) {
  return data.slots.filter(slot => slot.ends-slot.starts >= minutes*60_000 && (!serviceId || slot.service_ids.includes(serviceId)));
}
// Pets arrive with each page of bookings or diary visits; keep one list so names resolve everywhere.
function mergePets(rows = []) {
  const known = new Map(data.pets.map(pet => [pet.id,pet]));
  for (const pet of rows) known.set(pet.id,pet);
  data.pets = [...known.values()].sort((a,b) => a.name.localeCompare(b.name));
}
async function loadDiary({ more = false, filter = diaryFilterValue } = {}) {
  const current = data;
  const query = new URLSearchParams();
  if (filter) {
    const [kind,id] = filter.split(':');
    query.set(kind,id);
  }
  if (more && data.diary?.next) query.set('before',data.diary.next);
  const page = await api('diary'+(query.size ? '?'+query : ''));
  if (data !== current) return;
  mergePets(page.pets);
  for (const visit of page.visits) diaryVisitOptions.set(visit.id,visit);
  data.diary = more ? { visits:[...data.diary.visits,...page.visits], events:[...data.diary.events,...page.events], next:page.next } : page;
}
const appointmentTime = new Intl.DateTimeFormat('en-US',{timeStyle:'short',timeZone:'America/New_York'});
const appointmentDay = new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/New_York'});
// A bookable time is a published window id plus a start time inside it.
const slotKey = slot => slot.id+':'+slot.starts;
function slotChoices(slots, labelFor = slot => date(slot.starts), { selected } = {}) {
  return slots.map(slot => choice('slot',slotKey(slot),labelFor(slot),{ checked:slotKey(slot) === selected, required:true })).join('');
}
function bookingForm() {
  if (!data.pets.length) {
    const service = requestedService();
    return '<p>Add your pet to continue '+(service ? 'booking '+text(service.toLowerCase()) : 'booking a visit')+'.</p>'+
      tapLink(bookingIntake,'Add a pet profile','🐾');
  }
  if (!data.services.length) return '<p>There are no services available to book right now. Check back for availability.</p>';
  const serviceName = requestedService();
  const matching = data.services.filter(service => service.name === serviceName);
  const preferred = matching.find(service => String(service.id) === requestedRate()) || matching[0];
  const unavailable = serviceName && !preferred;
  const initial = preferred ?? (unavailable ? null : data.services[0]);
  const serviceOptions = data.services.map(service =>
    choice('service',service.id,service.name+' · '+service.minutes+' min · '+money(service.cents),{
      checked:service.id === initial?.id, required:true, icon:serviceIcons[service.name],
    })
  ).join('');
  return '<p>Appointment times are shown in Massachusetts time. Myomi reviews each request before confirming.</p>' +
    form('bookings','<div data-booking-inputs><p class="pet-field-error" data-booking-error role="alert" tabindex="-1"></p>'+choiceGroup('Service',serviceOptions)+
    choiceGroup('Pets attending',data.pets.map(pet => choice('pets',pet.id,pet.name,{ type:'checkbox', icon:'🐾' })).join(''))+
    '<p class="pet-field-error" data-booking-pet-error role="alert"></p>'+
    '<div data-booking-days></div><div data-booking-times></div><p data-availability role="status" hidden></p>'+
    area('Care instructions for this visit','notes','',1500)+
    '<p data-quote></p>'+button('Review booking','','📅')+'</div><div data-booking-review hidden></div>');
}
function statusForm(booking,status,label) {
  const summary = status === 'Completed' ? '<label>Visit summary<textarea required maxlength="3000" name="summary"></textarea></label>' : '';
  return form('status','<input type="hidden" name="status" value="'+text(status)+'">'+summary+button(label,status === 'Cancelled' ? 'secondary' : '',{ Confirmed:'✓', 'In Progress':'🐾', Completed:'🏁', Cancelled:'✕' }[status]),booking.id);
}
function choice(name, value, label, { icon = '', checked = false, required = false, type = 'radio' } = {}) {
  return '<label><input type="'+type+'" name="'+name+'" value="'+text(value)+'"'+
    (checked ? ' checked' : '')+(required ? ' required' : '')+'>'+
    '<span>'+emoji(icon)+text(label)+'</span></label>';
}
function choiceGroup(label, choices) {
  return '<fieldset class="tap-choices"><legend>'+text(label)+'</legend><div>'+choices+'</div></fieldset>';
}
function photoChoice(name, label, icon, capture = '') {
  return '<label><input type="file" name="'+name+'" accept="image/*"'+capture+
    '><span>'+emoji(icon)+text(label)+'</span></label>';
}
function eventForm(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const petChoice = pets.length === 1
    ? '<input type="hidden" name="pet" value="'+pets[0].id+'"><p>Update for <strong>'+text(pets[0].name)+'</strong></p>'
    : choiceGroup('Pet',pets.map(pet => choice('pet',pet.id,pet.name,{ icon:'🐾', required:true })).join(''));
  return form('events',petChoice+
    choiceGroup('Activity',data.activityTypes.map(kind =>
      choice('kind',kind,kind,{ icon:activityIcons[kind], required:true })
    ).join(''))+
    area('Details (include amounts, duration, dose or observations as appropriate)','notes')+
    '<fieldset class="tap-choices photo-choices"><legend>Optional photo</legend><div>'+
    photoChoice('camera','Take a photo','📸',' capture="environment"')+
    photoChoice('photo','Choose from library','🖼️')+'</div>'+
    '<p data-photo-status role="status"></p><button type="button" class="secondary" data-clear-photo hidden>'+
    emoji('↩️')+'Remove photo</button></fieldset>'+
    button('Publish diary update','','🐾'),booking.id);
}
function publishingDesk() {
  const visits = data.bookings.filter(booking => booking.status === 'In Progress');
  if (!visits.length) {
    return '<p>Start a confirmed visit to publish diary updates.</p>'+tapLink('#upcoming','Go to today’s visits','📅');
  }
  return visits.map(booking => '<article><h3>'+text(booking.service_name)+' for '+text(booking.customer)+'</h3>'+
    '<p class="appointment-details">'+date(booking.starts)+'</p>'+eventForm(booking)+
    tapLink('#upcoming','Go to Today to complete the visit','🏁')+'</article>').join('');
}
const canReviewCheckout = booking => !data.user.admin && booking.status === 'Confirmed' && booking.starts > Date.now();
function bookingCard(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const active = booking.status === 'In Progress';
  let actions = '';
  if (data.user.admin) {
    if (booking.status === 'Requested') actions += statusForm(booking,'Confirmed','Approve request') + statusForm(booking,'Cancelled','Decline request');
    if (booking.status === 'Confirmed') actions += statusForm(booking,'In Progress','Start visit') + statusForm(booking,'Cancelled','Cancel booking');
    if (active) actions += tapLink('#diary','Publish a diary update','🐾')+statusForm(booking,'Completed','Complete visit');
  } else if (booking.starts > Date.now() && ['Requested','Confirmed'].includes(booking.status)) {
    if (canReviewCheckout(booking)) {
      actions += '<a class="tap-link checkout-link" href="#checkout-'+booking.id+'">View visit details</a>';
    }
    actions += statusForm(booking,'Cancelled','Cancel booking');
  }
  if (['Requested','Confirmed'].includes(booking.status) && (data.user.admin || booking.starts > Date.now())) {
    const slots = availableSlots((booking.ends-booking.starts)/60000);
    if (slots.length) actions += '<details class="reschedule-options"><summary>'+emoji('📅')+'Reschedule</summary>'+
      form('reschedule',choiceGroup('New time',slotChoices(slots))+button('Confirm new time','secondary','✓'),booking.id)+'</details>';
  }
  const statusLabel = !data.user.admin && booking.status === 'Requested' ? 'Waiting for Myomi' : booking.status;
  return '<article><h3>'+text(booking.service_name)+' · '+text(statusLabel)+'</h3><p class="appointment-details">'+date(booking.starts)+' – '+date(booking.ends)+' · '+money(booking.cents)+'</p>'+
    (data.user.admin ? '<p>'+text(booking.customer)+' · '+text(booking.email)+'</p>' : '')+
    '<p>Pets: '+pets.map(p=>text(p.name)).join(', ')+'</p><p class="preserve">'+text(booking.notes)+'</p>'+
    (booking.arrived ? '<p class="appointment-details">Arrived: '+date(booking.arrived)+'</p>' : '') + (booking.departed ? '<p class="appointment-details">Completed: '+date(booking.departed)+'</p>' : '')+
    (booking.summary ? '<p class="preserve"><strong>Visit summary:</strong> '+text(booking.summary)+'</p>' : '')+
    (data.user.admin ? pets.map(p=>'<details><summary>'+text(p.name)+'’s care profile</summary>'+profileSummary(p)+'</details>').join('') : '')+
    actions+'</article>';
}
// Holds: a reviewed time is held for the customer until `expires` (server time, at most 10 minutes).
// The review shows when the hold ends, and a hold the page can no longer use is released so others can book it.
let holdTimer;
const openReview = () => app.querySelector('[data-booking-review][data-expires]:not([hidden])');
function releaseHold(expires, { keepalive = false } = {}) {
  // keepalive lets the request finish while the page is closing.
  return fetch('/api/checkout-release', { method:'POST', keepalive, headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ expires }) }).catch(() => {});
}
function startHoldTimer(form) {
  clearTimeout(holdTimer);
  const review = form.querySelector('[data-booking-review]');
  holdTimer = setTimeout(() => expireHold(form), Math.max(0, Number(review.dataset.expires) - Date.now()));
}
function expireHold(form, message = 'Your hold on this time has ended, so someone else may book it. Choose a time again to continue.') {
  const review = form.querySelector('[data-booking-review]');
  if (!review?.isConnected || review.hidden || !review.dataset.expires || review.dataset.expired) return;
  review.dataset.expired = '1';
  review.querySelector('.checkout-status').textContent = 'Hold ended';
  review.querySelector('[data-hold-note]').textContent = message;
  review.querySelector('button[type="submit"]').disabled = true;
  review.querySelector('[data-edit-booking]').textContent = 'Choose another time';
}
// Reloads availability and reopens the booking form, keeping the pet, service and notes, with `message` at the top.
async function reopenBooking(message) {
  clearTimeout(holdTimer);
  const review = openReview();
  if (review) delete review.dataset.expires; // the hold is gone; render() must not try to release it again
  await refresh();
  const form = app.querySelector('[data-action="bookings"]');
  const notice = form?.querySelector('[data-booking-error]');
  if (!notice) { feedback.textContent = message; return; }
  feedback.textContent = '';
  notice.textContent = message;
  notice.focus();
  notice.scrollIntoView({ block:'center', behavior:'instant' });
}
window.addEventListener('pagehide', () => {
  const review = openReview();
  if (!review || review.dataset.expired) return;
  clearTimeout(holdTimer);
  releaseHold(Number(review.dataset.expires), { keepalive:true });
  review.dataset.released = '1';
});
// Coming back through the back/forward cache: the hold was released on the way out, so say so.
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  const review = openReview();
  if (review?.dataset.released) expireHold(review.closest('form'), 'You left this page, so the time was released for others. Choose a time again to continue.');
});
function checkoutSummary(booking, expires) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean);
  const ends = day(booking.starts) === day(booking.ends) ? appointmentTime.format(booking.ends) : date(booking.ends);
  return '<article class="checkout-card"><header><span class="checkout-service-icon" aria-hidden="true">'+
    text(serviceIcons[booking.service_name] || '🐾')+'</span><div><p class="checkout-status">'+
    (expires ? 'Review your visit' : 'Confirmed by Myomi')+'</p>'+
    '<h3>'+text(booking.service_name)+'</h3></div></header>'+
    '<dl><div><dt>Sitter</dt><dd>Myomi</dd></div>'+
    '<div><dt>'+ (pets.length === 1 ? 'Pet' : 'Pets')+'</dt><dd>'+text(pets.join(', '))+'</dd></div>'+
    '<div class="checkout-appointment"><dt>Appointment</dt><dd class="appointment-details">'+date(booking.starts)+' – '+ends+' ET</dd></div>'+
    '<div><dt>Duration</dt><dd>'+((booking.ends-booking.starts)/60_000)+' min</dd></div></dl>'+
    '<div class="checkout-total"><span>Visit total</span><strong>'+money(booking.cents)+'</strong></div>'+
    (expires ? '<p class="checkout-payment-note" data-hold-note role="status">Time held until '+appointmentTime.format(expires)+' ET. Online payment is currently unavailable. Send a request for Myomi to confirm.</p>' :
      '<p class="checkout-payment-note">Your visit is confirmed. Online payment is currently unavailable.</p>')+'</article>'+
    (expires ? '<div class="checkout-actions"><button type="button" class="secondary" data-edit-booking>Edit booking</button>'+
      button('Send booking request','','📅')+'</div>' : tapLink('#upcoming','Back to my bookings',''));
}
function diary() {
  const eventsByVisit = new Map();
  for (const event of data.diary.events) {
    if (!eventsByVisit.has(event.booking)) eventsByVisit.set(event.booking, []);
    eventsByVisit.get(event.booking).push(event);
  }
  const empty = !data.user.admin && !diaryFilterValue && !data.diary.visits.length;
  return '<div class="diary-toolbar">'+(empty ? '' : diaryFilter())+
    '<button type="button" class="secondary" id="refresh-diary">'+emoji('🔄')+'Refresh updates</button></div>'+
    (empty ? '<p>Updates will appear here once Myomi starts your visit and shares an update.</p>'+
      tapLink('#upcoming','View my bookings','📅') : renderDiaryVisits(data.diary.visits, eventsByVisit, id => find(data.pets,id)?.name, event => {
      if (!event.has_photo) return null;
      const url = '/api/photos/'+event.id;
      return { src:url, href:url, alt:'Open full photo from the care visit' };
    }))+
    (data.diary.next ? '<button type="button" class="secondary" id="more-diary">'+emoji('⬇️')+'Show older visits</button>' : '');
}
function diaryFilter() {
  const option = (value,label) => '<option value="'+text(value)+'"'+
    (value === diaryFilterValue ? ' selected' : '')+'>'+text(label)+'</option>';
  const pets = data.pets.map(pet => option('pet:'+pet.id,pet.name)).join('');
  const visits = [...diaryVisitOptions.values()].sort((a,b) => b.starts-a.starts).map(visit => {
    const pets = visit.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean).join(', ');
    return option('visit:'+visit.id,[pets,visit.service_name,date(visit.starts)].filter(Boolean).join(' · '));
  }).join('');
  return '<label class="diary-filter" for="diary-filter">Filter diary<select id="diary-filter" name="diary-filter">'+
    option('','All visits')+(pets ? '<optgroup label="By pet">'+pets+'</optgroup>' : '')+
    (visits ? '<optgroup label="By visit">'+visits+'</optgroup>' : '')+'</select></label>';
}
function adminSettings() {
  const schedule = data.schedule;
  const clock = value => String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const timeFields = input('Opens','opens','type="time" required value="'+clock(schedule.opens)+'"')+
    input('Closes','closes','type="time" required value="'+clock(schedule.closes)+'"');
  const exceptionList = schedule.exceptions.map(exception => '<li>'+text(exception.day)+' · '+
    (exception.opens === null ? 'Closed' : clock(exception.opens)+'–'+clock(exception.closes))+'</li>').join('');
  return '<div class="grid">'+form('schedule','<h3>Regular hours</h3><p>These hours repeat each week in Massachusetts time.</p>'+
    choiceGroup('Working days',weekdays.map((label,index)=>choice('days',index,label,{type:'checkbox',checked:Boolean(schedule.days & (1<<index))})).join(''))+
    timeFields+input('Buffer before and after a visit (minutes)','buffer','type="number" min="0" max="180" required value="'+schedule.buffer+'"')+
    button('Save weekly hours','','✓'))+
    form('schedule-exception','<h3>Adjust a date</h3><p>Close a date, change its regular hours, or go back to the weekly schedule.</p>'+
      input('Date','day','type="date" required')+
      choiceGroup('Date change',choice('mode','closed','Closed',{checked:true})+choice('mode','custom','Custom hours')+choice('mode','reset','Use weekly hours'))+
      timeFields+button('Save date change','','✓')+(exceptionList ? '<ul>'+exceptionList+'</ul>' : ''))+
    form('services','<h3>Set a service price</h3>'+
    choiceGroup('Service',Object.entries(serviceIcons).map(([service,icon],index) =>
      choice('name',service,service,{ icon, checked:index === 0, required:true })
    ).join(''))+
    input('Duration in minutes','minutes','type="number" min="1" max="1440" required')+
    input('Price in USD','price','type="number" min="0" max="10000" step="0.01" required')+button('Save service','','✓'))+
    form('slots','<h3>Add an extra appointment window</h3><p>Enter the window in your device’s local time. The portal displays Massachusetts time.</p>'+
    input('Starts','starts','type="datetime-local" required')+input('Ends','ends','type="datetime-local" required')+button('Publish window','','📅'))+'</div>'+
    '<p class="appointment-details">'+data.services.map(s=>text(s.name)+' · '+s.minutes+' min · '+money(s.cents)).join('<br>')+'</p>'+
    data.windows.map(s=>form('slots','<p class="appointment-details">'+date(s.starts)+' – '+date(s.ends)+'</p>'+button('Remove window','secondary','✕'),s.id)).join('')+
    '<h3>Backup</h3><p>Download everything (accounts, pets, bookings, diary updates and photos) as one file. '+
    'It includes password hashes, so store it somewhere private.</p>'+'<a class="tap-link" href="/api/backup" download>'+emoji('💾')+'Download backup</a>';
}
function accountSettings() {
  const sessions = data.account?.sessions ?? 1;
  const reviewLink = !data.user.admin && googleReviewLinks.write
    ? '<p>'+tapLink(googleReviewLinks.write,'Leave a Google review','⭐')+'</p>' : '';
  return '<p>Signed in as '+text(data.user.name)+' · '+text(data.user.email)+'</p>'+
    reviewLink+
    form('password','<h3>Change password</h3>'+
      input('Current password','current','required type="password" maxlength="128" autocomplete="current-password"')+
      input('New password','password','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+
      '<small>At least 12 characters. Changing it signs you out on your other devices.</small>'+button('Change password','','🔑'))+
    form('signout-all','<h3>Sign out everywhere</h3><p>'+(sessions === 1 ? 'You are signed in on 1 device.' : 'You are signed in on '+sessions+' devices.')+
      ' Use this if you signed in on a shared or lost device. It signs you out here too.</p>'+button('Sign out everywhere','secondary','↩️'));
}
const section = (id,title,contents) => '<section id="'+id+'"><h2>'+title+'</h2>'+contents+'</section>';
function dashboardActions(tasks) {
  return '<div class="dashboard-actions">'+tasks.map(([id,label,icon,detail]) =>
    '<a class="dashboard-action" href="#'+id+'">'+emoji(icon)+
    '<span><strong>'+text(label)+'</strong><small>'+text(detail)+'</small></span></a>').join('')+'</div>';
}
const weekDayKey = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'America/New_York'});
const weekDayLabel = new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
function weekCalendar() {
  const first = weekDayKey.format(Date.now());
  const noon = Date.parse(first+'T12:00:00Z');
  const rows = Array.from({length:7},(_, index) => {
    const date = noon + index*24*60*60_000;
    const key = new Date(date).toISOString().slice(0,10);
    const visits = data.week.filter(visit => weekDayKey.format(visit.starts) <= key && weekDayKey.format(visit.ends-1) >= key);
    const entries = visits.map(visit => {
      const continues = weekDayKey.format(visit.starts) < key;
      const status = !data.user.admin && visit.status === 'Requested' ? 'Waiting for Myomi' : visit.status;
      const name = data.user.admin ? visit.customer : visit.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean).join(', ');
      const icon = serviceIcons[visit.service_name];
      const buffer = data.user.admin && data.schedule.id && data.schedule.buffer && visit.status !== 'Requested'
        ? '<small>'+data.schedule.buffer+' min buffer before and after</small>' : '';
      return '<li><span>'+text(continues ? 'Continues' : appointmentTime.format(visit.starts))+'</span>'+
        '<strong>'+emoji(icon)+text(visit.service_name)+'</strong><span>'+text(name)+'</span><small>'+text(status)+'</small>'+buffer+'</li>';
    }).join('');
    const exception = data.user.admin && data.schedule.exceptions.find(item=>item.day === key);
    const openings = data.user.admin && data.schedule.openings.filter(window=>weekDayKey.format(window.starts)===key);
    const hours = data.user.admin ? '<p class="week-hours">'+(exception?.opens === null ? 'Closed' :
      openings.length ? openings.map(window=>appointmentTime.format(window.starts)+'–'+appointmentTime.format(window.ends)).join(' · ') : 'No hours set')+
      '</p><a class="text-link week-adjust" href="#settings" data-schedule-day="'+key+'">Adjust hours</a>' : '';
    return '<li class="week-day"><h4>'+(index === 0 ? 'Today · ' : '')+'<time datetime="'+key+'">'+weekDayLabel.format(date)+'</time></h4>'+
      hours+(entries ? '<ul>'+entries+'</ul>' : '<p>No visits</p>')+'</li>';
  });
  return '<div class="week-calendar"><h3>Next 7 days</h3><p>Massachusetts time</p>'+
    swipeCards(rows,'Day','Next 7 days','week-rail')+'</div>';
}
function swipeCards(cards, unit, label, railClass) {
  const name = unit.toLowerCase();
  return '<div class="swipe-cards" data-card-unit="'+unit+'"><div class="swipe-controls">'+
    '<button type="button" class="secondary" data-card-move="-1" aria-label="Previous '+name+'" aria-disabled="true">‹</button>'+
    '<span data-card-position aria-live="polite">'+unit+' 1 of '+cards.length+'</span>'+
    '<button type="button" class="secondary" data-card-move="1" aria-label="Next '+name+'">›</button></div>'+
    '<ol class="swipe-rail '+railClass+'" aria-label="'+text(label)+'" tabindex="0">'+cards.join('')+'</ol></div>';
}
function swipeIndex(rail) {
  const step = rail.children[1].offsetLeft - rail.firstElementChild.offsetLeft;
  return step ? Math.max(0,Math.min(rail.children.length-1,Math.round(rail.scrollLeft/step))) : 0;
}
function moveToSwipeCard(card, behavior) {
  const rail = card.parentElement;
  rail.scrollTo({left:card.offsetLeft-rail.firstElementChild.offsetLeft,behavior});
}
app.addEventListener('scroll',event => {
  const rail = event.target;
  if (!rail.matches?.('.swipe-rail')) return;
  const index = swipeIndex(rail);
  const cards = rail.closest('.swipe-cards');
  const position = cards.querySelector('[data-card-position]');
  const next = cards.dataset.cardUnit+' '+(index+1)+' of '+rail.children.length;
  if (position.textContent === next) return;
  position.textContent = next;
  cards.querySelector('[data-card-move="-1"]').setAttribute('aria-disabled',String(index === 0));
  cards.querySelector('[data-card-move="1"]').setAttribute('aria-disabled',String(index === rail.children.length-1));
},true);
function clientHome() {
  return dashboardActions([
    ['book',requestedService() ? 'Continue booking' : 'Book a visit','🐾','Choose care with Myomi.'],
    ['upcoming','My bookings','📅','Check requests and confirmed visits.'],
    ['pets','My pets','🐶','Add a pet or update care details.'],
    ['diary','Pet Diary','📖','Read visit notes and see photos.'],
  ])+weekCalendar();
}
function staffHome(bookings) {
  const pending = bookings.filter(booking => booking.status === 'Requested').length;
  const active = bookings.filter(booking => booking.status === 'In Progress').length;
  const tasks = [
    ['upcoming','Bookings','📅',pending ? pending+' '+(pending === 1 ? 'request to review' : 'requests to review') : 'Review requests and manage visits.'],
    ['diary','Publish updates','🐾',active ? active+' '+(active === 1 ? 'visit in progress' : 'visits in progress') : 'Share activity notes and photos.'],
    ['settings','Services & availability','🗓️','Set prices and publish appointment times.'],
    ['history','Booking history','📖','Find past visits and their details.'],
    ['financials','Financials','📊','See visit totals and service breakdowns.'],
  ];
  return dashboardActions(tasks)+weekCalendar();
}
async function showFinancials() {
  const panel = document.querySelector('#financial-summary');
  if (!panel || panel.dataset.loaded || panel.getAttribute('aria-busy') === 'true') return;
  panel.setAttribute('aria-busy','true');
  panel.textContent = 'Loading booking totals…';
  try {
    const {completed,upcoming} = await api('financials');
    if (!panel.isConnected) return;
    const totals = completed.reduce((total, row) => ({visits:total.visits+row.visits,cents:total.cents+row.cents}),{visits:0,cents:0});
    const metric = (label, row) => '<article><h3>'+label+'</h3><strong>'+money(row.cents)+'</strong><p>'+
      row.visits+(row.visits === 1 ? ' visit' : ' visits')+'</p></article>';
    const rows = completed.map(row => '<li><span>'+text(row.service)+' · '+row.visits+(row.visits === 1 ? ' visit' : ' visits')+
      '</span><strong>'+money(row.cents)+'</strong></li>').join('');
    panel.innerHTML = '<div class="financial-metrics">'+metric('Completed in the last 30 days',totals)+
      metric('Upcoming confirmed',upcoming)+'</div><h3>Completed visits by service</h3>'+
      (rows ? '<ul class="financial-breakdown">'+rows+'</ul>' : '<p>No completed visits in the last 30 days.</p>');
    panel.dataset.loaded = '1';
  } catch {
    panel.innerHTML = '<p>Couldn’t load booking totals.</p><button type="button" data-retry-financials>Try again</button>';
  } finally { panel.setAttribute('aria-busy','false'); }
}
function render() {
  logout.hidden = accountLink.hidden = !data?.user;
  if (!data?.user) {
    portalLinks.replaceChildren();
    auth();
    return;
  }
  // Replacing the page discards an open booking review, so give its held time back.
  const discarded = openReview();
  if (discarded && !discarded.dataset.expired) { clearTimeout(holdTimer); releaseHold(Number(discarded.dataset.expires)); }
  // Keep anything typed into other forms: record it before replacing the page, put it back afterwards.
  drafts.use(data.user.id);
  drafts.capture(app);
  const admin = data.user.admin;
  const today = day(Date.now());
  const bookings = data.bookings.filter(b => b.starts >= Date.now() || b.status === 'In Progress');
  const history = data.bookings.filter(b => !bookings.includes(b)).sort((a,b) => b.starts-a.starts);
  const cards = rows => rows.length ? rows.map(bookingCard).join('') : '<p>No appointments here yet.</p>';
  const older = data.history_next ? '<button type="button" class="secondary" id="more-history">'+emoji('⬇️')+'Show older bookings</button>' : '';
  const main = admin ? 'Today' : 'My bookings';
  document.querySelector('.portal h1').textContent = 'Welcome, '+data.user.name+'.';
  const links = admin
    ? [['staff-home','Staff home'],['upcoming','Today'],['diary','Publish updates'],['history','Booking history'],['settings','Services & availability'],['financials','Financials']]
    : [['client-home','Home'],['upcoming','My bookings'],['book','Book a visit'],['pets','My pets'],['diary','Pet Diary']];
  portalLinks.innerHTML = links.map(([id,label]) => '<a href="#'+id+'">'+text(label)+'</a>').join('');
  const staffNotice = !admin && new URLSearchParams(location.search).get('staff') === '1'
    ? '<p>You’re signed in as a client. Sign out to switch to your staff account.</p>' : '';
  app.innerHTML = staffNotice+(admin ? section('staff-home','Staff home',staffHome(bookings)) : section('client-home','Client home',clientHome()))+
    section('upcoming',main,admin ? cards(bookings.filter(b=>b.status === 'In Progress' || day(b.starts) === today)) +
      '<h3>Other upcoming bookings</h3>'+cards(bookings.filter(b=>b.status !== 'In Progress' && day(b.starts) !== today))
      : '<h3>Upcoming visits</h3>'+cards(bookings)+'<h3>Past visits</h3>'+cards(history)+older)+
    (admin ? section('settings','Services and availability',adminSettings()) :
      section('pets','Pet profiles',data.pets.map(p=>'<article><h3>'+text(p.name)+'</h3>'+profileSummary(p)+'<details><summary>Edit profile</summary>'+petForm(p)+'</details></article>').join('')+'<h3>Add a pet</h3>'+petForm())+
      section('book','Request care',bookingForm())+
      bookings.filter(canReviewCheckout).map(booking => section('checkout-'+booking.id,'Visit details',checkoutSummary(booking))).join(''))+
    section('diary',admin ? 'Publish updates' : 'Pet Diary',
      (admin ? publishingDesk()+'<h3>Published updates</h3>' : '')+'<div id="diary-feed">'+diary()+'</div>')+
    (admin ? section('history','Booking history',cards(history)+older)+
      section('financials','Financials','<p>These totals use booking prices. The portal doesn’t track payments collected or refunds.</p>'+
        '<div id="financial-summary" aria-live="polite"></div>') : '')+
    section('account','Account',accountSettings());
  updateQuote();
  drafts.restore(app, {
    onChoice:(form, input) => { if (form.dataset.action === 'bookings' && ['service','day'].includes(input.name)) updateQuote({ target:input }); },
    onFile:(form, input, file) => showPhotoSelection(form, file),
    onStep:(form, step) => showPetCard(form, step),
  });
  showSection();
}
function showSection(focus = false) {
  if (!data?.user) return;
  const panels = [...app.querySelectorAll(':scope > section')];
  if (!panels.length) return;
  const requested = location.hash === bookingIntake ? 'pets' : location.hash.slice(1);
  const id = panels.some(panel => panel.id === requested) ? requested : (data.user.admin ? 'staff-home' : 'client-home');
  for (const panel of panels) panel.hidden = panel.id !== id;
  for (const link of [...portalLinks.querySelectorAll('a'), accountLink]) {
    if (link.hash === '#'+id || (id.startsWith('checkout-') && link.hash === '#upcoming')) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  if (id === 'financials') showFinancials();
  if (focus) {
    const heading = document.getElementById(id).querySelector('h2');
    heading.tabIndex = -1;
    heading.focus();
  }
}
window.addEventListener('hashchange', () => {
  showSection(true);
  if (data?.user && !data.user.admin) {
    showPublicationFeedback('');
    if (location.hash === '#diary') refreshDiaryView();
  }
});
portalMenu.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link && !event.target.closest('#logout')) return;
  portalMenu.open = false;
  if (link?.getAttribute('href') === location.hash) showSection(true);
});
document.addEventListener('click', event => {
  if (!portalMenu.contains(event.target)) portalMenu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && portalMenu.open) {
    portalMenu.open = false;
    portalMenu.querySelector('summary').focus();
  }
});
function updateQuote(event) {
  const booking = app.querySelector('[data-action="bookings"]');
  if (!booking) return;
  const service = find(data.services,Number(booking.querySelector('[name="service"]:checked')?.value));
  const slots = service ? availableSlots(service.minutes,service.id) : [];
  const days = new Map(slots.map(slot => [day(slot.starts),appointmentDay.format(slot.starts)]));
  const chosenDay = event?.target.name === 'day' ? event.target.value : days.keys().next().value;
  if (event?.target.name !== 'day') {
    booking.querySelector('[data-booking-days]').innerHTML = days.size
      ? choiceGroup('Available day',[...days].map(([key,label]) => choice('day',key,label,{ checked:key === chosenDay, required:true })).join(''))
      : '';
  }
  const appointments = slots.filter(slot => day(slot.starts) === chosenDay);
  booking.querySelector('[data-booking-times]').innerHTML = appointments.length
    ? choiceGroup('Appointment',slotChoices(appointments,slot => appointmentTime.format(slot.starts),{ selected:slotKey(appointments[0]) }))
    : '';
  const availability = booking.querySelector('[data-availability]');
  availability.hidden = slots.length > 0;
  const name = requestedService();
  availability.textContent = service
    ? 'No times are available for this service right now. Try another service or check back later.'
    : (name || 'This service')+' is unavailable right now. Choose another service or check back later.';
  booking.querySelector('[data-quote]').textContent = service ? 'Request total: '+money(service.cents)+' · '+service.minutes+' minutes.' : '';
  booking.querySelector('button[type="submit"]').disabled = appointments.length === 0;
}
async function refresh() {
  const user = await api('session');
  if (user?.id !== data?.user?.id) {
    diaryFilterValue = '';
    diaryVisitOptions.clear();
  }
  data = user ? await api('portal') : null;
  if (data) await loadDiary();
  app.setAttribute('aria-busy','false');
  render();
}
async function readPhoto(file) {
  if (!file?.size) return undefined;
  if (file.size > 25_000_000) throw new Error('Choose a photo smaller than 25 MB.');
  let photo = file;
  if (file.size > 2_500_000 || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, 1600 / Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1,Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      photo = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.82));
    } catch {
      throw new Error('This photo could not be opened. Try a JPEG, PNG, or WebP.');
    } finally { bitmap?.close(); }
  }
  if (!photo || photo.size > 2_500_000) throw new Error('Choose a smaller photo.');
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected photo.'));
    reader.readAsDataURL(photo);
  });
}
function showPhotoSelection(form, file) {
  form.querySelector('[data-photo-status]').textContent = file ? 'Photo ready to publish: '+file.name : '';
  form.querySelector('[data-clear-photo]').hidden = !file;
}

app.addEventListener('change', event => {
  const { name, value, form } = event.target;
  if (['camera','photo'].includes(name) && form && event.target.type === 'file') {
    const other = form.elements[name === 'camera' ? 'photo' : 'camera'];
    const file = event.target.files[0];
    if (file) other.value = '';
    showPhotoSelection(form,file || other.files[0]);
  }
  if (form?.dataset.action === 'bookings' && ['service','day'].includes(name)) updateQuote(event);
  if (form?.dataset.action === 'bookings' && name === 'pets') form.querySelector('[data-booking-pet-error]').textContent = '';
  if (name === 'diary-filter') updateDiaryFilter(event.target);
});
async function updateDiaryFilter(select) {
  const value = select.value;
  const current = data;
  const controls = [...document.querySelectorAll('#diary-filter, #refresh-diary, #more-diary')];
  controls.forEach(control => { control.disabled = true; });
  try {
    await loadDiary({filter:value});
    if (data !== current) return;
    diaryFilterValue = value;
    const feed = document.querySelector('#diary-feed');
    feed.innerHTML = diary();
    feed.querySelector('#diary-filter').focus({preventScroll:true});
  } catch (error) {
    select.value = diaryFilterValue;
    feedback.textContent = error.message;
  } finally {
    controls.forEach(control => { control.disabled = false; });
  }
}
// Save drafts shortly after typing stops, and when the tab is hidden, so a reload or a discarded tab keeps them.
let draftTimer;
app.addEventListener('input', event => {
  if (event.target.matches('.pet-field [aria-invalid]')) petFieldError(event.target,'');
  const card = event.target.closest('[data-pet-card]');
  if (card) updatePetStepButton(card.form,card);
  const registrationError = event.target.form?.querySelector('[data-registration-error]');
  if (registrationError) registrationError.textContent = '';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => data?.user && drafts.capture(app), 400);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && data?.user) drafts.capture(app); });
app.addEventListener('click', async event => {
  const adjustHours = event.target.closest('[data-schedule-day]');
  if (adjustHours) {
    event.preventDefault();
    const date = app.querySelector('[data-action="schedule-exception"] [name="day"]');
    date.value = adjustHours.dataset.scheduleDay;
    history.pushState(null,'','#settings');
    showSection();
    date.focus();
    return;
  }
  const swipeMove = event.target.closest('[data-card-move]');
  if (swipeMove) {
    const rail = swipeMove.closest('.swipe-cards').querySelector('.swipe-rail');
    const card = rail.children[swipeIndex(rail)+Number(swipeMove.dataset.cardMove)];
    if (card) moveToSwipeCard(card,matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
    return;
  }
  if (event.target.closest('[data-retry-financials]')) {
    showFinancials();
    return;
  }
  if (event.target.closest('[data-create-account]')) {
    const heading = app.querySelector('[data-action="register"] h2');
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:'start',behavior:'instant'});
    return;
  }
  const editBooking = event.target.closest('[data-edit-booking]');
  if (editBooking) {
    const form = editBooking.form;
    const review = form.querySelector('[data-booking-review]');
    if (review.dataset.expired) {
      editBooking.disabled = true;
      await reopenBooking('Times below are up to date. Choose one and review your visit again.');
      return;
    }
    clearTimeout(holdTimer);
    editBooking.disabled = review.querySelector('button[type="submit"]').disabled = true;
    try { await api('checkout-release',{expires:Number(review.dataset.expires)}); }
    catch (error) { feedback.textContent = error.message; }
    review.hidden = true;
    review.replaceChildren();
    delete review.dataset.expires;
    const inputs = form.querySelector('[data-booking-inputs]');
    inputs.hidden = false;
    inputs.querySelector('button[type="submit"]').focus();
    return;
  }
  const petBack = event.target.closest('[data-pet-back]');
  if (petBack) {
    showPetCard(petBack.form, Number(petBack.form.dataset.draftStep)-1, true);
    drafts.capture(app);
    return;
  }
  const clearPhoto = event.target.closest('[data-clear-photo]');
  if (clearPhoto) {
    const { form } = clearPhoto;
    form.elements.camera.value = '';
    form.elements.photo.value = '';
    showPhotoSelection(form);
    form.elements.camera.focus({ preventScroll:true });
    return;
  }
  const control = event.target.closest('#refresh-diary, #more-diary, #more-history');
  if (!control) return;
  if (control.id !== 'more-history') {
    await refreshDiaryView(control);
    return;
  }
  const before = data;
  control.disabled = true;
  try {
    const page = await api('history?before='+encodeURIComponent(data.history_next));
    if (data !== before) return;
    mergePets(page.pets);
    data.bookings = [...data.bookings,...page.bookings];
    data.history_next = page.next;
    render();
    document.querySelector(data.user.admin ? '#history' : '#upcoming')?.querySelector('article:last-of-type')?.scrollIntoView({block:'nearest'});
  } catch (error) {
    if (data === before) feedback.textContent = error.message;
  } finally {
    control.disabled = false;
  }
});
async function refreshDiaryView(control) {
  const before = data;
  const controls = [...document.querySelectorAll('#diary-filter, #refresh-diary, #more-diary')];
  if (!controls.length || controls.some(item => item.disabled)) return;
  controls.forEach(item => { item.disabled = true; });
  try {
    await loadDiary({more:control?.id === 'more-diary'});
    if (data !== before) return;
    document.querySelector('#diary-feed').innerHTML = diary();
    if (control && location.hash === '#diary') {
      document.querySelector('#'+(control.id === 'more-diary' && data.diary.next ? 'more-diary' : 'refresh-diary'))?.focus({preventScroll:true});
      if (control.id === 'refresh-diary') feedback.textContent = 'Diary is up to date.';
    }
  } catch (error) {
    if (data === before) feedback.textContent = error.message;
  } finally {
    controls.forEach(item => { item.disabled = false; });
  }
}
function confirmCancellation() {
  cancelDialog.returnValue = '';
  cancelDialog.showModal();
  return new Promise(resolve => {
    cancelDialog.addEventListener('close',() => resolve(cancelDialog.returnValue === 'confirm'),{ once:true });
  });
}
app.addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.target;
  const action = form.dataset.action;
  if (action === 'pets') {
    const step = Number(form.dataset.draftStep || 0);
    const card = form.querySelector('[data-pet-card]:not([hidden])');
    const movingNext = card && step < profileGroups.length-1;
    if (!validatePetFields(form,(movingNext ? card : form).querySelectorAll('.pet-field :is(input, textarea)'))) return;
    if (movingNext) {
      showPetCard(form, step+1, true);
      drafts.capture(app);
      return;
    }
  }
  const fields = new FormData(form);
  if (action === 'bookings' && !fields.has('pets')) {
    form.querySelector('[data-booking-pet-error]').textContent = 'Choose at least one pet.';
    form.querySelector('[name="pets"]').focus();
    return;
  }
  const payload = Object.fromEntries(fields);
  if (form.dataset.id) payload.id = Number(form.dataset.id);
  if (payload.status === 'Cancelled' && !await confirmCancellation()) return;
  const control = event.submitter || form.querySelector('button[type="submit"]');
  control.disabled = true;
  const publication = action === 'events' ? 'Published to the customer’s Pet Diary.'
    : action === 'slots' && !payload.id ? 'Appointment window published.'
    : action === 'status' && payload.status === 'Completed' ? 'Visit completed. Summary published to the customer’s Pet Diary.'
    : action === 'services' ? 'Service saved. Clients can request it when a time is available.'
    : action === 'schedule' ? 'Weekly hours saved.'
    : action === 'schedule-exception' ? 'Date change saved.'
    : '';
  showPublicationFeedback('Saving…', Boolean(publication));
  let saved = false;
  try {
    if (action === 'pets') {
      const profile = { profileVersion: 1 };
      for (const [key] of profileFields) {
        if (payload[key]?.trim()) profile[key] = payload[key].trim();
        delete payload[key];
      }
      payload.details = JSON.stringify(profile);
      if (payload.details.length > 3000) throw new Error('Shorten the care notes so the profile can be saved.');
    }
    if (typeof payload.slot === 'string' && payload.slot.includes(':')) [payload.slot,payload.start] = payload.slot.split(':').map(Number);
    for (const key of ['service','slot','pet','minutes']) if (key in payload) payload[key] = Number(payload[key]);
    if (action === 'bookings') {
      const service = find(data.services,payload.service);
      if (!service || !payload.slot) throw new Error('Choose a service and an available appointment.');
      payload.pets = fields.getAll('pets').map(Number);
      payload.cents = service.cents;
      const review = form.querySelector('[data-booking-review]');
      if (!review.dataset.expires) {
        const hold = await api('checkout-hold',payload,requestKey(form,'checkout-hold\n'+JSON.stringify(payload)));
        pendingKeys.delete(form);
        review.dataset.expires = hold.expires;
        review.innerHTML = checkoutSummary({
          service_name:service.name, pet_ids:payload.pets, starts:hold.starts, ends:hold.ends, cents:service.cents,
        },hold.expires);
        form.querySelector('[data-booking-inputs]').hidden = true;
        form.querySelector('[data-booking-error]').textContent = '';
        review.hidden = false;
        startHoldTimer(form);
        const heading = review.querySelector('h3');
        heading.tabIndex = -1;
        heading.focus();
        feedback.textContent = '';
        return;
      }
      payload.hold = Number(review.dataset.expires);
    }
    if (action === 'services') payload.cents = Math.round(Number(payload.price)*100);
    if (action === 'schedule') {
      payload.days = fields.getAll('days').map(Number);
      payload.buffer = Number(payload.buffer);
    }
    if (action === 'slots' && !payload.id) {
      payload.starts = new Date(payload.starts).toISOString();
      payload.ends = new Date(payload.ends).toISOString();
    }
    if (action === 'events') {
      payload.photo = await readPhoto(fields.get('camera')?.size ? fields.get('camera') : fields.get('photo'));
      delete payload.camera;
    }
    const key = requestKey(form, action+'\n'+JSON.stringify(payload));
    let result;
    try { result = await api(action,payload,key); }
    catch (error) { if (!error.network) pendingKeys.delete(form); throw error; }
    saved = true;
    pendingKeys.delete(form);
    form.dataset.submitted = '1'; // saved: start this form empty on the next render
    drafts.forget(form);
    const resumeBooking = action === 'pets' && !form.dataset.id && location.hash === bookingIntake;
    if (resumeBooking) history.replaceState(null,'','#book');
    if (action === 'bookings') {
      clearTimeout(holdTimer);
      delete form.querySelector('[data-booking-review]').dataset.expires; // the server already removed the hold
      const next = new URL(location.href);
      next.searchParams.delete('service');
      next.searchParams.delete('rate');
      next.hash = 'upcoming';
      history.replaceState(null,'',next);
    }
    if (action === 'status' && payload.status === 'In Progress') history.replaceState(null,'','#diary');
    const signedIn = action === 'login';
    if (signedIn) history.replaceState(null,'',result?.admin ? '#staff-home' : '#client-home');
    await refresh();
    if (publication) {
      showPublicationFeedback(publication);
      return;
    }
    if (resumeBooking || signedIn || action === 'register') showSection(true);
    if (action === 'signout-all') { drafts.clear(); feedback.textContent = 'Signed out on every device.'; return; }
    feedback.textContent = action === 'bookings' ? 'Request sent. Myomi still needs to confirm your appointment.'
      : action === 'password' ? 'Password changed. Your other devices have been signed out.'
      : action === 'register' ? 'Your account is ready.'
      : signedIn ? ''
      : resumeBooking ? 'Pet added. You can continue booking.' : 'Saved.';
  } catch (error) {
    // The time was taken, the hold ran out, or another tab replaced it: show current times, not the stale list.
    if (action === 'bookings' && error.status === 409) {
      showPublicationFeedback('');
      await reopenBooking(error.message+' The times below are up to date.');
      return;
    }
    const registrationError = form.querySelector('[data-registration-error]');
    if (registrationError?.isConnected) {
      feedback.textContent = '';
      registrationError.textContent = error.message;
    } else {
      showPublicationFeedback(saved && publication ? publication+' Refresh the page to see the latest changes.' : error.message, Boolean(publication));
    }
  }
  finally { control.disabled = false; }
});
logout.addEventListener('click',async () => {
  showPublicationFeedback('');
  try {
    await api('logout',{});
    drafts.clear();
    history.replaceState(null,'',location.pathname+location.search+(new URLSearchParams(location.search).get('staff') === '1' ? '#diary' : ''));
    await refresh();
    feedback.textContent = 'Signed out.';
  } catch (error) { feedback.textContent = error.message; }
});
refresh().catch(error => {
  app.setAttribute('aria-busy','false');
  app.textContent = 'The care portal needs a running myo. server.';
  feedback.textContent = error.message;
});
