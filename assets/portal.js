import { activityIcons, escapeHtml as text, formatVisitDate as date, renderDiaryVisits } from './diary.js';
import { createDrafts } from './drafts.js';
import { googleReviewLinks } from './review-links.js';
import { showPriceSheet } from './price-sheet.js';
import { locale, t, hasKey, formatDate, formatMoney, translateLabel, catalogs } from './i18n.js';
import {careSettings,staffComplianceSettings,stayCalendar,syncStayCalendar,vaccineTools,blockerHtml,staffCareTools,feedbackTool,reportInputs,reportPayload,timelineSection,clientSection,configureCareUi,bindCareUi,loadCareSection,clearEntryDetails} from './care-portal.js';
import {myoConfig} from './myo-config.js';
const uiLocale = locale;

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
const staffVisitsLabel = () => t('Today & upcoming');
const find = (rows,id) => rows.find(row => row.id === id);
const money = cents => formatMoney(cents, uiLocale());
// Mirrors quote() in lib/pricing.mjs; the server re-prices every hold and request and refuses a stale total.
const bookingTotal = (service, petCount, nights = 1) => {
  const units = service.kind === 'overnight' ? nights : 1;
  return units * (service.cents + Math.max(0, petCount - 1) * (service.extra_pet_cents || 0));
};
// Epoch ms for a wall-clock date and time in Massachusetts (overnight stays are chosen as dates and times there).
function easternEpoch(dayText, timeText) {
  const offsetAt = t => {
    const name = new Intl.DateTimeFormat('en-US',{ timeZone:'America/New_York', timeZoneName:'longOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name) || [, '+', '00', '00'];
    return (sign === '+' ? 1 : -1) * (Number(h) * 60 + Number(m)) * 60_000;
  };
  const wall = Date.parse(dayText + 'T' + timeText + ':00Z');
  return wall - offsetAt(wall - offsetAt(wall));
}
// The nights of a stay: Eastern dates from drop-off up to, not including, pickup.
const stayNightCount = (startDay, endDay) => startDay && endDay && endDay > startDay
  ? Math.round((Date.parse(endDay + 'T12:00:00Z') - Date.parse(startDay + 'T12:00:00Z')) / 86_400_000) : 0;
const day = value => new Intl.DateTimeFormat('en-CA',{dateStyle:'short',timeZone:'America/New_York'}).format(value);
const emoji = icon => icon ? '<span class="control-icon" aria-hidden="true">'+icon+'</span> ' : '';
const button = (label, style = '', icon = '') => '<button class="'+style+'" type="submit">'+emoji(icon)+text(translateLabel(label))+'</button>';
// Staff roles: an owner sees everything; a sitter runs visits and publishes updates (no prices, settings or money).
const isOwner = () => Boolean(data?.user?.admin) && (data.user.role || 'owner') === 'owner';
const form = (action, contents, id = '') => '<form data-action="'+action+'" data-id="'+id+'">'+contents+'</form>';
const input = (label,name,attributes = '') => '<label>'+text(translateLabel(label))+'<input name="'+name+'" '+attributes+'></label>';
const area = (label,name,value = '',max = 3000) => '<label>'+text(translateLabel(label))+'<textarea maxlength="'+max+'" name="'+name+'">'+text(value)+'</textarea></label>';
const serviceIcons = { 'Dog walking':'🦮', 'Drop-in visit':'🏠', 'Overnight pet sitting':'🌙', 'Meet & Greet':'🤝' };
const tapLink = (href,label,icon) => '<a class="tap-link" href="'+text(href)+'">'+emoji(icon)+text(translateLabel(label))+'</a>';
const serviceNames = new Map([
  ['pet-sitting', 'Overnight pet sitting'],
  ['dog-walking', 'Dog walking'],
  ['drop-in', 'Drop-in visit'],
  ['meet', 'Meet & Greet'],
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
      if (!key || attempt === 2) throw Object.assign(new Error(t("The connection dropped. Check your signal and tap the button again; it will not be saved twice.")), { network:true });
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
    }
  }
  const result = await response.json();
  if (!response.ok) {
    // In Spanish, show the catalog's message for the error code; in English the server's message is the most specific.
    const message = result?.code && hasKey('error.'+result.code, uiLocale())
      ? t('error.'+result.code, {}, uiLocale())
      : hasKey(result?.error) ? t(result.error)
      : uiLocale() === 'en' && result?.error ? result.error : t('Please try again.');
    throw Object.assign(new Error(message || t("Please try again.")), { status:response.status, code:result?.code, blockers:result?.blockers });
  }
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
    document.querySelector('.portal h1').textContent = t("Staff sign-in.");
    app.innerHTML = ("<p>" + t("Sign in to start visits and publish Pet Diary updates.") + "</p>")+
      form('login',input(t("Email"),'email','required type="email" maxlength="254" autocomplete="username"')+
        input(t("Password"),'password','required type="password" maxlength="128" autocomplete="current-password"')+
        button(t("Sign in"),'','🔑'))+
      tapLink('./index.html',t("Go to the Client Portal"),'🐾');
    return;
  }
  document.querySelector('.portal h1').textContent = t("Client portal.");
  const emailField = input(t("Email"),'email','required type="email" maxlength="254" autocomplete="email"');
  const service = requestedService();
  const bookingPrompt = service ? t("Sign in or create an account to request {service}.", {service:text(translateLabel(service))})
    : t("Sign in or create an account to request a visit.");
  const bookingEntry = ['#book', bookingIntake].includes(location.hash);
  app.innerHTML = (bookingEntry ? '<p>'+bookingPrompt+'</p>' : ("<p>" + t("Sign in to manage bookings, pet profiles, and your Pet Diary.") + "</p>")) +
    ("<button type=\"button\" class=\"secondary auth-jump\" data-create-account>" + t("New here? Create an account") + "</button>")+
    (bookingEntry ? ("<section class=\"auth-availability\"><h2>" + t("Prices &amp; availability") + "</h2><p>" + t("Times shown in Massachusetts time. Myomi confirms each request.") + "</p>")+
      '<div data-auth-price-sheet aria-live="polite"></div></section>' :
      ("<p><a class=\"text-link\" href=\"../index.html#services\">" + t("See services and prices") + "</a></p>"))+'<div class="grid">'+
    form('login',("<h2>" + t("Sign in") + "</h2>")+emailField+input(t("Password"),'password','required type="password" maxlength="128" autocomplete="current-password"')+button(t("Sign in"),'','🔑'))+
    form('register',("<h2 tabindex=\"-1\">" + t("Create an account") + "</h2>")+input(t("Name"),'name','required maxlength="100" autocomplete="name"')+
      emailField+input(t("Password"),'password','required type="password" minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="registration-password-tip"')+
      ("<small id=\"registration-password-tip\">" + t("Use at least 12 characters for your password.") + "</small>")+
      '<p class="pet-field-error" data-registration-error role="alert"></p>'+button(t("Create account"),'','👋'))+'</div>';
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
      '<dt>'+text(translateLabel(label))+'</dt><dd class="preserve">'+text(saved[key])+'</dd>').join('');
    const details = index === 0 ? ("<dt>" + t("Species") + "</dt><dd>")+text(pet.species)+'</dd>'+entries : entries;
    return '<li class="pet-profile-card"><h4>'+text(translateLabel(group))+'</h4>'+
      (details ? '<dl>'+details+'</dl>' : ("<p>" + t("No details added.") + "</p>"))+'</li>';
  });
  return swipeCards(sections,'Section',t('Care profile for {name}', {name:pet.name}),'pet-profile-rail');
}
function petField(pet, key, label, value, { required = false, max = 120, multiline = false } = {}) {
  const id = 'pet-'+(pet?.id ?? 'new')+'-'+key;
  const attrs = 'id="'+id+'" name="'+key+'" maxlength="'+max+'" aria-describedby="'+id+'-tip '+id+'-error"'+
    (required ? ' required' : '');
  const control = multiline
    ? '<textarea '+attrs+'>'+text(value)+'</textarea>'
    : '<input '+attrs+' value="'+text(value)+'"'+(key.endsWith('Phone') ? ' type="tel"' : '')+
      (key === 'weight' ? ' inputmode="decimal"' : '')+'>';
  return '<div class="pet-field"><div class="pet-field-heading"><label for="'+id+'">'+text(translateLabel(label))+
    (required ? (" <span class=\"pet-required\">" + t("(required)") + "</span>") : '')+'</label>'+
    '<details class="pet-field-tip"><summary aria-label="'+text(t("Help for {field}", {field:translateLabel(label)}))+'">?</summary>'+
    '<p id="'+id+'-tip">'+translateLabel(petFieldTips[key])+'</p></details></div>'+control+
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
    const basics = index === 0 ? petField(pet,'name',t("Pet name"),pet?.name,{ required:true, max:80 })+
      petField(pet,'species',t("Species"),pet?.species,{ required:true, max:60 }) : '';
    return '<fieldset'+(pet ? '' : ' data-pet-card'+(index ? ' hidden' : ''))+'><legend'+
      (pet ? '' : ' tabindex="-1"')+'>'+text(translateLabel(group))+(index && !pet ? (" <span class=\"pet-required\">" + t("(optional)") + "</span>") : '')+'</legend>'+
      basics+(!pet && index === 0 ? ("<details class=\"pet-optional\"><summary>" + t("Add more details (optional)") + "</summary>")+extraFields+'</details>' : extraFields)+'</fieldset>';
  });
  const start = '<form data-action="pets" data-id="'+(pet?.id ?? '')+'" novalidate>';
  if (pet) return start+swipeCards(groups.map(group => '<li class="pet-profile-card">'+group+'</li>'),
    'Section',t("Edit {name}’s profile", {name:pet.name}),'pet-profile-rail')+button(t("Save changes"),'','🐾')+'</form>';
  return start+("<p class=\"pet-step-count\" data-pet-step-count>" + t("Step {current} of {total}", {current:1,total:profileGroups.length}))+'</p>'+
    groups.join('')+("<div class=\"pet-step-actions\"><button type=\"button\" class=\"secondary\" data-pet-back hidden>" + t("Back") + "</button>")+
    button(t("Save & continue"))+("</div><p class=\"pet-draft-note\">" + t("Your draft stays in this tab until you add your pet.") + "</p></form>");
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
      message = field.name === 'name' ? t("Enter your pet’s name.") : t("Enter your pet’s species.");
    } else if (value.length > field.maxLength) {
      message = t('Use {count} characters or fewer.', {count:field.maxLength});
    } else if (value && (!form.dataset.id || field.value !== field.defaultValue)) {
      if (field.name === 'weight' && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0)) {
        message = t("Enter a weight above zero in pounds, such as 12.5.");
      } else if (field.type === 'tel') {
        const number = value.replace(/\s*(?:ext\.?|x|#)\s*\d+$/i,'');
        const digits = number.replace(/\D/g,'').length;
        if (!/^\+?[\d ().-]+$/.test(number) || digits < 7 || digits > 15) message = t("Enter a phone number with 7 to 15 digits.");
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
  form.querySelector('button[type="submit"]').textContent = step === profileGroups.length-1 ? t("Add pet") :
    step > 0 && !hasAnswers ? t("Skip for now") : t("Save & continue");
}
function showPetCard(form, step, focus = false) {
  const cards = [...form.querySelectorAll('[data-pet-card]')];
  if (!cards[step]) return;
  form.dataset.draftStep = step;
  cards.forEach((card,index) => { card.hidden = index !== step; });
  form.querySelector('[data-pet-step-count]').textContent = t('Step {current} of {total}', {current:step+1, total:cards.length});
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
  for (const pet of rows) known.set(pet.id,{...known.get(pet.id),...pet});
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
const appointmentTime = { format:ms => formatDate(ms, 'time', uiLocale()) };
const appointmentDay = { format:ms => formatDate(ms, 'day', uiLocale()) };
const appointmentHour = new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:'America/New_York'});
const daysPerPage = 7;
// A bookable time is a published window id plus a start time inside it.
const slotKey = slot => slot.id+':'+slot.starts;
function slotChoices(slots, labelFor = slot => date(slot.starts), { selected } = {}) {
  return slots.map(slot => choice('slot',slotKey(slot),labelFor(slot),{ checked:slotKey(slot) === selected, required:true })).join('');
}
function bookingForm() {
  if (!data.pets.length) {
    const service = requestedService();
    return ("<p>" + t("Add your pet to continue "))+(service ? t("booking {service}", {service:text(translateLabel(service))}) : t("booking a visit"))+'.</p>'+
      tapLink(bookingIntake,t("Add a pet profile"),'🐾');
  }
  if (!data.services.length) return ("<p>" + t("There are no services available to book right now. Check back for availability.") + "</p>");
  const serviceName = requestedService();
  const matching = data.services.filter(service => service.name === serviceName);
  const preferred = matching.find(service => String(service.id) === requestedRate()) || matching[0];
  const unavailable = serviceName && !preferred;
  const initial = preferred ?? (unavailable ? null : data.services[0]);
  const serviceOptions = data.services.map(service =>
    choice('service',service.id,translateLabel(service.name)+' · '+service.minutes+' min · '+(service.cents === 0 ? t("Free") : money(service.cents)),{
      checked:service.id === initial?.id, required:true, icon:serviceIcons[service.name],
    })
  ).join('');
  return ("<p>" + t("Appointment times are shown in Massachusetts time. Myomi reviews each request before confirming.") + "</p>") +
    form('bookings','<div data-booking-inputs><p class="pet-field-error" data-booking-error role="alert" tabindex="-1"></p>'+choiceGroup(t("Service"),serviceOptions)+
    '<div data-availability hidden><p data-availability-message></p>'+
    '<button type="button" class="secondary" data-check-availability>'+emoji('🔄')+(t("Check again") + "</button></div>")+
    '<p data-availability-status role="status"></p>'+
    (data.pricing_mode==='launch'?'<p>'+text(t('The first attending pet in this list uses the base rate.'))+'</p>':'')+
    choiceGroup(t("Pets attending"),data.pets.map(pet => choice('pets',pet.id,pet.name,{ type:'checkbox', icon:'🐾' })).join(''))+
    '<p class="pet-field-error" data-booking-pet-error role="alert"></p>'+
    '<div data-booking-options hidden><div data-booking-days></div>'+
    ("<div class=\"booking-date-pages\"><button type=\"button\" class=\"secondary\" data-day-page=\"-1\">" + t("Earlier") + "</button>")+
    ("<button type=\"button\" class=\"secondary\" data-day-page=\"1\">" + t("Later dates") + "</button></div>")+
    ("<div data-booking-times role=\"group\" aria-label=\"" + t("Appointment times") + "\"></div>")+
    area(t("Care instructions for this visit"),'notes','',1500)+'</div>'+
    '<div data-booking-summary hidden><p data-quote></p><div data-quote-lines></div>'+
    ("<p data-quote-status role=\"status\"></p><button type=\"button\" class=\"secondary\" data-retry-quote hidden>" + t("Retry price") + "</button>")+
    ((data.package_balances || []).some(balance => !balance.expired && balance.remaining > 0)
      ? '<label class="check-row"><input type="checkbox" name="use_package"> '+t("Use a package credit (covers the base price)")+'</label>' : '')+
    button(t("Review booking"),'','📅')+'</div></div><div data-booking-review hidden></div>');
}
function statusForm(booking,status,label) {
  // Completing records the departure check (C1.3): secured, or a note saying what wasn't and what was done.
  const summary = status === 'Completed' ? ("<label>" + t("Visit summary") + "<textarea required maxlength=\"3000\" name=\"summary\"></textarea></label>")+
    ("<fieldset class=\"departure-check\"><legend>" + t("Before you leave") + "</legend>")+
    ("<label class=\"departure-secured\"><input type=\"checkbox\" name=\"secured\" value=\"1\">" + t(" Doors locked and home secured") + "</label>")+
    ("<label data-secure-note hidden>" + t("What wasn’t secured, and what did you do?") + "<textarea name=\"secure_note\" maxlength=\"500\"></textarea></label>")+
    ("<button type=\"button\" class=\"secondary\" data-report-unsecured>" + t("Report an unsecured home") + "</button></fieldset>") : '';
  const control = button(label,status === 'Cancelled' ? 'secondary' : '',{ Confirmed:'✓', 'In Progress':'🐾', Completed:'🏁', Cancelled:'✕' }[status]);
  return form('status','<input type="hidden" name="status" value="'+text(translateLabel(status))+'">'+summary+
    (status === 'Completed' ? control.replace('<button ','<button disabled data-needs-departure ') : control),booking.id);
}
// "Complete visit" stays disabled until the home is confirmed secured or a note of at least 3 characters explains why not.
function updateDepartureCheck(form) {
  const control = form.querySelector('[data-needs-departure]');
  if (!control) return;
  const { secured,secure_note } = form.elements;
  const note = form.querySelector('[data-secure-note]');
  note.hidden = secured.checked || (!form.dataset.unsecured && !secure_note.value.trim());
  form.querySelector('[data-report-unsecured]').hidden = secured.checked || !note.hidden;
  control.disabled = !(secured.checked || secure_note.value.trim().length >= 3);
}
function choice(name, value, label, { icon = '', checked = false, required = false, type = 'radio' } = {}) {
  return '<label><input type="'+type+'" name="'+name+'" value="'+text(value)+'"'+
    (checked ? ' checked' : '')+(required ? ' required' : '')+'>'+
    '<span>'+emoji(icon)+text(['pet', 'pets'].includes(name) ? label : translateLabel(label))+'</span></label>';
}
function choiceGroup(label, choices) {
  return '<fieldset class="tap-choices"><legend>'+text(translateLabel(label))+'</legend><div>'+choices+'</div></fieldset>';
}
function photoChoice(name, label, icon, capture = '') {
  return '<label><input type="file" name="'+name+'" accept="image/*"'+capture+
    '><span>'+emoji(icon)+text(translateLabel(label))+'</span></label>';
}
// Arrival, the evening and morning check-ins and departure belong to an overnight stay (C2.4).
const overnightOnly = ['Arrival','Evening check-in','Morning check-in','Departure'];
function eventForm(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const petChoice = pets.length === 1
    ? '<input type="hidden" name="pet" value="'+pets[0].id+("\"><p>" + t("Update for ") + "<strong>")+text(pets[0].name)+'</strong></p>'
    : choiceGroup(t("Pet"),pets.map(pet => choice('pet',pet.id,pet.name,{ icon:'🐾', required:true })).join(''));
  return form('events',petChoice+
    choiceGroup(t("Activity"),data.activityTypes.filter(kind => booking.service_kind === 'overnight' || !overnightOnly.includes(kind)).map(kind =>
      choice('kind',kind,kind,{ icon:activityIcons[kind], required:true })
    ).join(''))+
    area(t("Details (include amounts, duration, dose or observations as appropriate)"),'notes')+
    '<div data-report-fields data-service-kind="'+booking.service_kind+'"></div>'+
    button(t("Publish diary update"),'','🐾')+
    ("<fieldset class=\"tap-choices photo-choices\"><legend>" + t("Optional photo") + "</legend><div>")+
    photoChoice('camera',t("Take a photo"),'📸',' capture="environment"')+
    photoChoice('photo',t("Choose from library"),'🖼️')+'</div>'+
    '<p data-photo-status role="status"></p><button type="button" class="secondary" data-clear-photo hidden>'+
    emoji('↩️')+(t("Remove photo") + "</button></fieldset>"),booking.id);
}
function publishingDesk() {
  const visits = data.bookings.filter(booking => booking.status === 'In Progress');
  if (!visits.length) {
    return ("<p>" + t("Start a confirmed visit to publish diary updates.") + "</p>")+tapLink('#upcoming',t("Go to ")+staffVisitsLabel(),'📅');
  }
  return visits.map(booking => '<article><h3>'+text(translateLabel(booking.service_name))+' for '+text(booking.customer)+'</h3>'+
    '<p class="appointment-details">'+date(booking.starts)+'</p>'+eventForm(booking)+
    tapLink('#upcoming',t("Go to {section} to complete the visit", {section:staffVisitsLabel()}),'🏁')+'</article>').join('');
}
// "Start visit" opens a set number of minutes before the booked time (the visit buffer); until then it is
// disabled with the time it opens, and a timer enables it when that time comes.
function startVisitForm(booking) {
  const from = booking.starts - (data.schedule?.earlyStart ?? 30) * 60_000;
  if (Date.now() >= from) return statusForm(booking,'In Progress',t("Start visit"));
  const note = 'start-note-'+booking.id;
  const when = day(from) === day(Date.now()) ? appointmentTime.format(from) : date(from);
  return form('status','<input type="hidden" name="status" value="In Progress">'+
    '<button type="submit" disabled data-start-after="'+from+'" aria-describedby="'+note+'">'+emoji('🐾')+(t("Start visit") + "</button>")+
    '<p class="start-note" id="'+note+'">'+text(t('You can start this visit from {time} ET.', {time:when}))+'</p>',booking.id);
}
setInterval(() => {
  for (const control of app.querySelectorAll('[data-start-after]')) {
    if (Date.now() < Number(control.dataset.startAfter)) continue;
    control.disabled = false;
    control.removeAttribute('data-start-after');
    const note = document.getElementById(control.getAttribute('aria-describedby'));
    if (note) note.textContent = t("You can start this visit now.");
  }
}, 15_000);
function updateLaunchServiceForm(form) {
  if(!form || data.pricing_mode!=='launch')return;
  const name=form.querySelector('[name="name"]:checked')?.value;
  const minutes=form.elements.minutes;
  if(!minutes.value)minutes.value=30;
  const price=name==='Meet & Greet'?0:name==='Overnight pet sitting'?myoConfig.rates.overnight:myoConfig.rates.visit+(Number(minutes.value)===60?myoConfig.rates.extension:0);
  form.elements.price.value=price;
  form.elements.price.readOnly=true;
  form.elements.extra_pet.value=name==='Meet & Greet'?0:myoConfig.rates.additionalDog;
  form.elements.extra_pet.readOnly=true;
  form.elements.extra_pet.closest('label').hidden=true;
  if(!form.querySelector('[data-launch-rates]')){
    const note=document.createElement('p');note.dataset.launchRates='';note.textContent=t('Approved launch rates apply automatically.');form.append(note);
  }
}
const moveQuotes=new WeakMap();
const canReviewCheckout = booking => !data.user.admin && booking.status === 'Confirmed' && booking.starts > Date.now();
// Money on a booking card (C3.1): its payment status for both sides, Pay now and tips for customers, and
// recording payments and refunds for staff. Refunds by card need online payment to be on.
const paymentLabels = { none:'Not due yet', due:'Payment due', pending:'Checkout started', partial:'Partly paid', paid:'Paid', refund_due:'Refund due', refunded:'Refunded' };
const methodLabel = method => t(method[0].toUpperCase()+method.slice(1));
const dollarsInput = (label, name) => input(label,name,'type="number" min="1" max="10000" step="0.01" required');
function paymentBlock(booking) {
  const payment = booking.payment;
  if (!payment || (payment.status === 'none' && !payment.paid_cents)) return '';
  const balance = payment.balance_cents > 0 ? ' · '+t("Balance {amount}",{ amount:money(payment.balance_cents) })
    : payment.balance_cents < 0 ? ' · '+t("{amount} to return",{ amount:money(-payment.balance_cents) }) : '';
  let html = '<p class="payment-status" data-payment-status>'+t("Payment:")+' <strong>'+t(paymentLabels[payment.status])+'</strong>'+balance+'</p>';
  if (data.user.admin && !isOwner()) return html;
  if (data.user.admin) {
    const methods = choiceGroup(t("Method"),['cash','check','other'].map((method,index) => choice('method',method,methodLabel(method),{ checked:index === 0, required:true })).join(''));
    html += '<details><summary>'+emoji('💵')+t("Record a payment")+'</summary>'+form('payments/record',dollarsInput(t("Amount (USD)"),'dollars')+methods+
      input(t("Note"),'note','maxlength="200"')+button(t("Record payment"),'secondary','✓'),booking.id)+'</details>';
    if (payment.paid_cents > payment.refunded_cents) {
      const refundMethods = choiceGroup(t("Refund to"),(data.payments_enabled ? ['card','cash','check','other'] : ['cash','check','other'])
        .map((method,index) => choice('method',method,methodLabel(method),{ checked:index === 0, required:true })).join(''));
      html += '<details><summary>'+emoji('↩️')+t("Refund")+'</summary>'+form('refunds',dollarsInput(t("Amount (USD)"),'dollars')+refundMethods+
        input(t("Note"),'note','maxlength="200"')+button(t("Refund"),'secondary','↩️'),booking.id)+'</details>';
    }
    return html;
  }
  if (data.payments_enabled && payment.balance_cents > 0 && booking.status !== 'Requested') {
    html += form('payments/start',button(t("Pay {amount} now",{ amount:money(payment.balance_cents) }),'','💳'),booking.id);
  }
  if (['In Progress','Completed'].includes(booking.status)) {
    html += '<details><summary>'+emoji('💝')+t("Add a tip")+'</summary>'+form('tips',input(t("Tip (USD)"),'dollars','type="number" min="1" max="500" step="1" required')+
      button(t("Add tip"),'secondary','✓'),booking.id)+'</details>';
  }
  return html;
}
function bookingCard(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const active = booking.status === 'In Progress';
  let actions = '';
  if (data.user.admin) {
    if (booking.status === 'Requested' && isOwner()) actions += statusForm(booking,'Confirmed',t("Approve request")) + statusForm(booking,'Cancelled',t("Decline request"));
    if (booking.status === 'Confirmed') actions += startVisitForm(booking) + (isOwner() ? statusForm(booking,'Cancelled',t("Cancel booking")) : '');
    if (active) actions += tapLink('#diary',t("Publish a diary update"),'🐾')+statusForm(booking,'Completed',t("Complete visit"));
  } else if (booking.starts > Date.now() && ['Requested','Confirmed'].includes(booking.status)) {
    if (canReviewCheckout(booking)) {
      actions += '<a class="tap-link checkout-link" href="#checkout-'+booking.id+("\">" + t("View visit details") + "</a>");
    }
    actions += statusForm(booking,'Cancelled',t("Cancel booking"));
  }
  // A customer's proposed new time for a confirmed visit (C1.2): the visit keeps its time until Myomi decides.
  const change = booking.pending_change;
  let changeNote = '';
  if (change && data.user.admin && isOwner()) {
    changeNote = ("<p class=\"change-note\"><strong>" + t("Customer asked to move to "))+text(date(change.starts))+'.</strong></p>'+
      form('changes/decide','<input type="hidden" name="decision" value="approve">'+button(t("Approve change"),'','✓'),change.id)+
      form('changes/decide','<input type="hidden" name="decision" value="decline">'+button(t("Decline change"),'secondary','✕'),change.id);
  } else if (change && data.user.admin) {
    changeNote = ("<p class=\"change-note\"><strong>" + t("Customer asked to move to "))+text(date(change.starts))+'.</strong> '+t("The owner decides.")+'</p>';
  } else if (change) {
    changeNote = ("<p class=\"change-note\">" + t("Requested change: "))+text(date(change.starts))+(t(" — waiting for Myomi. Your current time stays booked until then.") + "</p>")+
      form('changes/withdraw',button(t("Withdraw request"),'secondary','↩️'),change.id);
  } else if (!data.user.admin && booking.status === 'Confirmed' && booking.last_change?.status === 'Declined') {
    changeNote = ("<p class=\"change-note\">" + t("Change declined. Your visit is still booked at the original time.") + "</p>");
  }
  if(change?.proposed_cents!=null)changeNote+='<p>'+text(t('Proposed total {amount}',{amount:money(change.proposed_cents)}))+'</p>';
  if (['Requested','Confirmed'].includes(booking.status) && (data.user.admin ? isOwner() : booking.starts > Date.now())) {
    const slots = availableSlots((booking.ends-booking.starts)/60000);
    const needsApproval = !data.user.admin && booking.status === 'Confirmed'
      ? ("<p>" + t("Myomi will confirm the new time. Your current time stays booked until then.") + "</p>") : '';
    if (slots.length) actions += '<details class="reschedule-options"><summary>'+emoji('📅')+(t("Reschedule") + "</summary>")+
      form('reschedule',needsApproval+choiceGroup(t("New time"),slotChoices(slots))+'<p data-move-quote role="status"></p><input type="hidden" name="cents">'+button(needsApproval ? t("Request new time") : t("Confirm new time"),'secondary','✓'),booking.id)+'</details>';
  }
  const statusLabel = !data.user.admin && booking.status === 'Requested' ? t("Waiting for Myomi") : booking.status;
  if (!data.user.admin && booking.status === 'Completed') {
    actions += '<a class="tap-link" href="#book" data-book-again="'+booking.id+'">'+emoji('🐾')+(t("Book again") + "</a>");
  }
  return '<article><h3>'+text(translateLabel(booking.service_name))+' · '+text(translateLabel(statusLabel))+'</h3><p class="appointment-details">'+date(booking.starts)+' – '+date(booking.ends)+' · '+(booking.cents === 0 ? t("Free") : money(booking.cents))+'</p>'+
    (!data.user.admin ? quoteLines(booking.lines) : '')+
    (data.user.admin ? '<p>'+text(booking.customer)+' · '+text(booking.email)+'</p>' : '')+
    ("<p>" + t("Pets: "))+pets.map(p=>text(p.name)).join(', ')+'</p><p class="preserve">'+text(booking.notes)+'</p>'+
    (booking.arrived ? ("<p class=\"appointment-details\">" + t("Arrived: "))+date(booking.arrived)+'</p>' : '') + (booking.departed ? ("<p class=\"appointment-details\">" + t("Completed: "))+date(booking.departed)+'</p>' : '')+
    (booking.summary ? ("<p class=\"preserve\"><strong>" + t("Visit summary:") + "</strong> ")+text(booking.summary)+'</p>' : '')+changeNote+paymentBlock(booking)+
    (data.user.admin ? pets.map(p=>'<details><summary>'+text(p.name)+(t("’s care profile") + "</summary>")+profileSummary(p)+'</details>').join('') : '')+
    (data.user.admin ? staffCareTools(booking,pets) : '')+actions+'</article>';
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
function expireHold(form, message = t("Your hold on this time has ended, so someone else may book it. Choose a time again to continue.")) {
  const review = form.querySelector('[data-booking-review]');
  if (!review?.isConnected || review.hidden || !review.dataset.expires || review.dataset.expired) return;
  review.dataset.expired = '1';
  review.querySelector('.checkout-status').textContent = t("Hold ended");
  review.querySelector('[data-hold-note]').textContent = message;
  review.querySelector('button[type="submit"]').disabled = true;
  review.querySelector('[data-edit-booking]').textContent = t("Choose another time");
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
  if (review?.dataset.released) expireHold(review.closest('form'), t("You left this page, so the time was released for others. Choose a time again to continue."));
});
function checkoutSummary(booking, expires) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean);
  const ends = day(booking.starts) === day(booking.ends) ? appointmentTime.format(booking.ends) : date(booking.ends);
  return '<article class="checkout-card"><header><span class="checkout-service-icon" aria-hidden="true">'+
    text(serviceIcons[booking.service_name] || '🐾')+'</span><div><p class="checkout-status">'+
    (expires ? t("Review your visit") : t("Confirmed by Myomi"))+'</p>'+
    '<h3>'+text(translateLabel(booking.service_name))+'</h3></div></header>'+
    ("<dl><div><dt>" + t("Sitter") + "</dt><dd>Myomi</dd></div>")+
    '<div><dt>'+ (pets.length === 1 ? t("Pet") : t("Pets"))+'</dt><dd>'+text(pets.join(', '))+'</dd></div>'+
    ("<div class=\"checkout-appointment\"><dt>" + t("Appointment") + "</dt><dd class=\"appointment-details\">")+date(booking.starts)+' – '+ends+(t(" ET") + "</dd></div>")+
    (booking.service_kind === 'overnight'
      ? ("<div><dt>" + t("Nights") + "</dt><dd>")+Math.max(1,stayNightCount(day(booking.starts), day(booking.ends)))+'</dd></div></dl>'
      : ("<div><dt>" + t("Duration") + "</dt><dd>")+((booking.ends-booking.starts)/60_000)+(t(" min") + "</dd></div></dl>"))+
    quoteLines(booking.lines)+
    ("<div class=\"checkout-total\"><span>" + t("Visit total") + "</span><strong>")+(booking.cents === 0 ? t("No charge") : money(booking.cents))+'</strong></div>'+
    (expires ? ("<p class=\"checkout-payment-note\" data-hold-note role=\"status\">" + t("Time held until "))+appointmentTime.format(expires)+t(' ET. ')+
      (booking.cents === 0 ? '' : t("Online payment is currently unavailable. "))+(t("Send a request for Myomi to confirm.") + "</p>") :
      (booking.cents === 0 ? '' : ("<p class=\"checkout-payment-note\">" + t("Your visit is confirmed. Online payment is currently unavailable.") + "</p>")))+'</article>'+
    (expires ? ("<div class=\"checkout-actions\"><button type=\"button\" class=\"secondary\" data-edit-booking>" + t("Edit booking") + "</button>")+
      button(t("Send booking request"),'','📅')+'</div>' : tapLink('#upcoming',t("Back to my bookings"),''));
}
function diary() {
  const eventsByVisit = new Map();
  for (const event of data.diary.events) {
    if (!eventsByVisit.has(event.booking)) eventsByVisit.set(event.booking, []);
    eventsByVisit.get(event.booking).push(event);
  }
  const empty = !data.user.admin && !diaryFilterValue && !data.diary.visits.length;
  return '<div class="diary-toolbar">'+(empty ? '' : diaryFilter())+
    '<button type="button" class="secondary" id="refresh-diary">'+emoji('🔄')+(t("Refresh updates") + "</button></div>")+
    (empty ? ("<p>" + t("Updates will appear here once Myomi starts your visit and shares an update.") + "</p>")+
      tapLink('#upcoming',t("View my bookings"),'📅') : renderDiaryVisits(data.diary.visits, eventsByVisit, id => find(data.pets,id)?.name, event => {
      if (!event.has_photo) return null;
      const url = '/api/photos/'+event.id;
      return { src:url, href:url, alt:t("Open full photo from the care visit") };
    },data.user.admin ? undefined : feedbackTool))+
    (data.diary.next ? '<button type="button" class="secondary" id="more-diary">'+emoji('⬇️')+(t("Show older visits") + "</button>") : '');
}
function diaryFilter() {
  const option = (value,label) => '<option value="'+text(value)+'"'+
    (value === diaryFilterValue ? ' selected' : '')+'>'+text(translateLabel(label))+'</option>';
  const pets = data.pets.map(pet => option('pet:'+pet.id,pet.name)).join('');
  const visits = [...diaryVisitOptions.values()].sort((a,b) => b.starts-a.starts).map(visit => {
    const pets = visit.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean).join(', ');
    return option('visit:'+visit.id,[pets,translateLabel(visit.service_name),date(visit.starts)].filter(Boolean).join(' · '));
  }).join('');
  return ("<label class=\"diary-filter\" for=\"diary-filter\">" + t("Filter diary") + "<select id=\"diary-filter\" name=\"diary-filter\">")+
    option('',t("All visits"))+(pets ? ("<optgroup label=\"" + t("By pet") + "\">")+pets+'</optgroup>' : '')+
    (visits ? ("<optgroup label=\"" + t("By visit") + "\">")+visits+'</optgroup>' : '')+'</select></label>';
}
// Staff accounts (owner only), loaded when Settings opens: who has access, their role, and adding a sitter.
function staffPanel(staff) {
  const roleChoices = selected => choiceGroup(t("Role"),[['sitter',t("Sitter")],['owner',t("Owner")]]
    .map(([value,label]) => choice('role',value,label,{ checked:value === selected, required:true })).join(''));
  const rows = staff.map(member => '<li><strong>'+text(member.name)+'</strong> · '+text(member.email)+' · '+
    t(member.role === 'owner' ? "Owner" : "Sitter")+(member.disabled ? ' · '+t("Switched off") : '')+(member.you ? ' '+t("(you)") : '')+
    (member.you ? '' : form('staff/update','<input type="hidden" name="disabled" value="'+(!member.disabled)+'">'+
      button(member.disabled ? t("Switch on") : t("Switch off"),'secondary',member.disabled ? '✓' : '✕'),member.id)+
      form('staff/update','<input type="hidden" name="role" value="'+(member.role === 'owner' ? 'sitter' : 'owner')+'">'+
      button(member.role === 'owner' ? t("Make sitter") : t("Make owner"),'secondary','↔️'),member.id)+
      '<details><summary>'+t("Set a new password")+'</summary>'+form('staff/password',
        input(t("New password"),'password','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+
        button(t("Save password"),'secondary','🔑'),member.id)+'</details>')+'</li>').join('');
  return '<ul class="staff-list">'+rows+'</ul>'+form('staff','<h4>'+t("Add a staff member")+'</h4>'+
    input(t("Name"),'name','required maxlength="100"')+input(t("Email"),'email','required type="email" maxlength="254" autocomplete="off"')+
    input(t("Temporary password (12+ characters)"),'password','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+
    roleChoices('sitter')+button(t("Add staff member"),'','➕'));
}
async function showStaffPanel() {
  const panel = document.querySelector('[data-staff-panel]');
  if (!panel || panel.dataset.loaded) return;
  panel.dataset.loaded = '1';
  try {
    const { staff } = await api('staff');
    if (panel.isConnected) panel.innerHTML = staffPanel(staff);
  } catch { panel.textContent = t("Couldn’t load staff accounts."); }
}
function adminSettings() {
  const schedule = data.schedule;
  const clock = value => String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const timeFields = input(t("Opens"),'opens','type="time" required value="'+clock(schedule.opens)+'"')+
    input(t("Closes"),'closes','type="time" required value="'+clock(schedule.closes)+'"');
  const exceptionList = schedule.exceptions.map(exception => '<li>'+text(exception.day)+' · '+
    (exception.opens === null ? t("Closed") : clock(exception.opens)+'–'+clock(exception.closes))+'</li>').join('');
  return '<div class="grid">'+form('schedule',("<h3>" + t("Regular hours") + "</h3><p>" + t("These hours repeat each week in Massachusetts time.") + "</p>")+
    choiceGroup(t("Working days"),weekdays.map((label,index)=>choice('days',index,label,{type:'checkbox',checked:Boolean(schedule.days & (1<<index))})).join(''))+
    timeFields+input(t("Buffer before and after a visit (minutes)"),'buffer','type="number" min="0" max="180" required aria-describedby="buffer-tip" value="'+schedule.buffer+'"')+
    choiceGroup(t("Overnight stays (nights starting on)"),weekdays.map((label,index)=>choice('overnight_days',index,label,{type:'checkbox',checked:Boolean((schedule.overnight_days || 0) & (1<<index))})).join(''))+
    input(t("Late pickup grace (minutes)"),'late_pickup_grace','type="number" min="0" max="720" required value="'+(schedule.late_pickup_grace ?? 120)+'"')+
    ("<small id=\"buffer-tip\">" + t("Visits can also start this many minutes before their booked time.") + "</small>")+
    button(t("Save weekly hours"),'','✓'))+
    form('schedule-exception',("<h3>" + t("Adjust a date") + "</h3><p>" + t("Close a date, change its regular hours, or go back to the weekly schedule.") + "</p>")+
      input(t("Date"),'day','type="date" required')+
      choiceGroup(t("Date change"),choice('mode','closed',t("Closed"),{checked:true})+choice('mode','custom',t("Custom hours"))+choice('mode','reset',t("Use weekly hours")))+
      timeFields+button(t("Save date change"),'','✓')+(exceptionList ? '<ul>'+exceptionList+'</ul>' : ''))+
    form('services',("<h3>" + t("Set a service price") + "</h3>")+
    choiceGroup(t("Service"),Object.entries(serviceIcons).map(([service,icon],index) =>
      choice('name',service,service,{ icon, checked:index === 0, required:true })
    ).join(''))+
    input(t("Duration in minutes"),'minutes','type="number" min="1" max="1440" required')+
    input(t("Price in USD"),'price','type="number" min="0" max="10000" step="0.01" required')+
    input(t("Extra pet (USD)"),'extra_pet','type="number" min="0" max="1000" step="0.01" value="0"')+
    input(t("Free cancellation until (hours before)"),'cancel_cutoff_hours','type="number" min="0" max="336" value="24"')+
    input(t("Cancellation fee after that (%)"),'cancel_fee_percent','type="number" min="0" max="100" value="0"')+button(t("Save service"),'','✓'))+
    form('slots',("<h3>" + t("Add an extra appointment window") + "</h3><p>" + t("Enter the window in your device’s local time. The portal displays Massachusetts time.") + "</p>")+
    input(t("Starts"),'starts','type="datetime-local" required')+input(t("Ends"),'ends','type="datetime-local" required')+button(t("Publish window"),'','📅'))+'</div>'+
    '<p class="appointment-details">'+data.services.map(s=>text(translateLabel(s.name))+' · '+s.minutes+' min · '+money(s.cents)+
      (s.extra_pet_cents ? ' + '+money(s.extra_pet_cents)+' per extra pet' : '')+
      (s.cancel_fee_percent ? ' · '+t("{percent}% fee inside {hours} h",{ percent:s.cancel_fee_percent, hours:s.cancel_cutoff_hours }) : '')).join('<br>')+'</p>'+
    data.windows.map(s=>form('slots','<p class="appointment-details">'+date(s.starts)+' – '+date(s.ends)+'</p>'+button(t("Remove window"),'secondary','✕'),s.id)).join('')+
    ("<h3>" + t("Backup") + "</h3><p>" + t("Download everything (accounts, pets, bookings, diary updates and photos) as one file. "))+
    (t("It includes password hashes, so store it somewhere private.") + "</p>")+'<a class="tap-link" href="/api/backup" download>'+emoji('💾')+(t("Download backup") + "</a>")+
    '<p data-backup-status role="status"></p>'+
    '<h3>'+t("Staff")+'</h3><p>'+t("Sitters run visits and publish updates. Owners also set prices, hours and money, and manage staff.")+'</p>'+
    '<div data-staff-panel aria-live="polite"></div>';
}
function accountSettings() {
  const sessions = data.account?.sessions ?? 1;
  const reviewLink = !data.user.admin && googleReviewLinks.write
    ? '<p>'+tapLink(googleReviewLinks.write,t("Leave a Google review"),'⭐')+'</p>' : '';
  const percent = data.user.auto_tip_percent || 0;
  const tipping = data.user.admin ? '' : form('auto-tip','<h3>'+t("Automatic tip")+'</h3><p>'+t("Added to each visit when Myomi completes it.")+'</p>'+
    choiceGroup(t("Tip"),[0,10,15,20,25].map(value => choice('percent',value,value ? value+'%' : t("Off"),{ checked:value === percent, required:true })).join(''))+
    button(t("Save tip"),'secondary','✓'));
  const balances = (data.package_balances || []).filter(balance => !balance.expired && balance.remaining > 0);
  const packages = balances.length ? '<h3>'+t("Your packages")+'</h3><ul>'+balances.map(balance => '<li>'+text(balance.name)+' · '+
    t("{remaining} of {credits} left · use by {date}",{ remaining:balance.remaining, credits:balance.credits, date:formatDate(balance.expires,'date',uiLocale()) })+'</li>').join('')+'</ul>' : '';
  return ("<p>" + t("Signed in as "))+text(data.user.name)+' · '+text(data.user.email)+'</p>'+
    reviewLink+packages+tipping+
    form('password',("<h3>" + t("Change password") + "</h3>")+
      input(t("Current password"),'current','required type="password" maxlength="128" autocomplete="current-password"')+
      input(t("New password"),'password','required type="password" minlength="12" maxlength="128" autocomplete="new-password"')+
      ("<small>" + t("At least 12 characters. Changing it signs you out on your other devices.") + "</small>")+button(t("Change password"),'','🔑'))+
    form('signout-all',("<h3>" + t("Sign out everywhere") + "</h3><p>")+(sessions === 1 ? t("You are signed in on 1 device.") : t('You are signed in on ')+t('{count} devices.', {count:sessions}))+
      (t(" Use this if you signed in on a shared or lost device. It signs you out here too.") + "</p>")+button(t("Sign out everywhere"),'secondary','↩️'));
}
const section = (id,title,contents) => '<section id="'+id+'"><h2>'+title+'</h2>'+contents+'</section>';
function dashboardActions(tasks) {
  return '<div class="dashboard-actions">'+tasks.map(([id,label,icon,detail]) =>
    '<a class="dashboard-action" href="#'+id+'">'+emoji(icon)+
    '<span><strong>'+text(translateLabel(label))+'</strong><small>'+text(detail)+'</small></span></a>').join('')+'</div>';
}
const weekDayKey = new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'America/New_York'});
const weekDayLabel = {format: value => new Intl.DateTimeFormat(locale() === 'es' ? 'es-US' : 'en-US', {weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(value)};
function weekCalendar() {
  const first = weekDayKey.format(Date.now());
  const noon = Date.parse(first+'T12:00:00Z');
  const rows = Array.from({length:7},(_, index) => {
    const date = noon + index*24*60*60_000;
    const key = new Date(date).toISOString().slice(0,10);
    const visits = data.week.filter(visit => weekDayKey.format(visit.starts) <= key && weekDayKey.format(visit.ends-1) >= key);
    const entries = visits.map(visit => {
      const continues = weekDayKey.format(visit.starts) < key;
      const status = !data.user.admin && visit.status === 'Requested' ? t("Waiting for Myomi") : visit.status;
      const name = data.user.admin ? visit.customer : visit.pet_ids.map(id => find(data.pets,id)?.name).filter(Boolean).join(', ');
      const icon = serviceIcons[visit.service_name];
      const buffer = data.user.admin && data.schedule.id && data.schedule.buffer && visit.status !== 'Requested'
        ? '<small>'+data.schedule.buffer+(t(" min buffer before and after") + "</small>") : '';
      return '<li><span>'+text(continues ? t("Continues") : appointmentTime.format(visit.starts))+'</span>'+
        '<strong>'+emoji(icon)+text(translateLabel(visit.service_name))+'</strong><span>'+text(name)+'</span><small>'+text(translateLabel(status))+'</small>'+buffer+'</li>';
    }).join('');
    const exception = data.user.admin && data.schedule.exceptions.find(item=>item.day === key);
    const openings = data.user.admin && data.schedule.openings.filter(window=>weekDayKey.format(window.starts)===key);
    const hours = data.user.admin ? '<p class="week-hours">'+(exception?.opens === null ? t("Closed") :
      openings.length ? openings.map(window=>appointmentTime.format(window.starts)+'–'+appointmentTime.format(window.ends)).join(' · ') : t("No hours set"))+
      '</p><a class="text-link week-adjust" href="#settings" data-schedule-day="'+key+("\">" + t("Adjust hours") + "</a>") : '';
    return '<li class="week-day"><h4>'+(index === 0 ? t("Today · ") : '')+'<time datetime="'+key+'">'+weekDayLabel.format(date)+'</time></h4>'+
      hours+(entries ? '<ul>'+entries+'</ul>' : ("<p>" + t("No visits") + "</p>"))+'</li>';
  });
  return ("<div class=\"week-calendar\"><h3>" + t("Next 7 days") + "</h3><p>" + t("Massachusetts time") + "</p>")+
    swipeCards(rows,'Day',t("Next 7 days"),'week-rail')+'</div>';
}
function swipeCards(cards, unit, label, railClass) {
  const name = translateLabel(unit).toLocaleLowerCase(locale());
  return '<div class="swipe-cards" data-card-unit="'+unit+'"><div class="swipe-controls">'+
    '<button type="button" class="secondary" data-card-move="-1" aria-label="'+text(t("Previous {unit}", {unit:name}))+'" aria-disabled="true">‹</button>'+
    '<span data-card-position aria-live="polite">'+t('{unit} {current} of {total}', {unit:translateLabel(unit),current:1,total:cards.length})+'</span>'+
    '<button type="button" class="secondary" data-card-move="1" aria-label="'+text(t("Next {unit}", {unit:name}))+'">›</button></div>'+
    '<ol class="swipe-rail '+railClass+'" aria-label="'+text(translateLabel(label))+'" tabindex="0">'+cards.join('')+'</ol></div>';
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
  const next = t('{unit} {current} of {total}', {unit:translateLabel(cards.dataset.cardUnit),current:index+1,total:rail.children.length});
  if (position.textContent === next) return;
  position.textContent = next;
  cards.querySelector('[data-card-move="-1"]').setAttribute('aria-disabled',String(index === 0));
  cards.querySelector('[data-card-move="1"]').setAttribute('aria-disabled',String(index === rail.children.length-1));
},true);
function clientHome() {
  const meet = (data.first_visit || (data.pricing_mode === 'launch' && !data.meet_available)) && data.services.some(service => service.kind === 'meet');
  const invitation = meet ? '<p>'+tapLink('?service=meet#book',t("Book a free Meet & Greet"),'🤝')+("<br>" + text(data.pricing_mode==='launch'?t('A complimentary Meet & Greet is required for each new booking.'):t("Meet Myomi before your first visit.")) + "</p>") : '';
  return invitation+dashboardActions([
    ['book',requestedService() ? t("Continue booking") : t("Book a visit"),'🐾',t("Choose care with Myomi.")],
    ['upcoming',t("My bookings"),'📅',t("Check requests and confirmed visits.")],
    ['pets',t("My pets"),'🐶',t("Add a pet or update care details.")],
    ['care',t('Care details'),'📝',t('Complete intake, agreements, and home access.')],
    ['diary',t("Pet Diary"),'📖',t("Read visit notes and see photos.")],
  ])+weekCalendar();
}
function staffHome(bookings) {
  // Requests and change requests both wait on Myomi.
  const pending = bookings.filter(booking => booking.status === 'Requested' || booking.pending_change).length;
  const active = bookings.filter(booking => booking.status === 'In Progress').length;
  const tasks = [
    ['upcoming',staffVisitsLabel(),'📅',pending ? t(pending === 1 ? '{count} request to review' : '{count} requests to review', {count:pending}) : t("Review requests and manage visits.")],
    ['diary',t("Publish updates"),'🐾',active ? t(active === 1 ? '{count} visit in progress' : '{count} visits in progress', {count:active}) : t("Share activity notes and photos.")],
    ['settings',t("Services & availability"),'🗓️',t("Set prices and publish appointment times.")],
    ['history',t("Booking history"),'📖',t("Find past visits and their details.")],
    ['financials',t("Financials"),'📊',t("See visit totals and service breakdowns.")],
    ['clients',t('Clients'),'👥',t('Find customer records and private notes.')],
  ].filter(([id]) => isOwner() || !['settings','financials'].includes(id));
  const keys=data.keys_to_return||[];
  return dashboardActions(tasks)+weekCalendar()+(keys.length?'<aside><h3>'+text(t('Keys to return'))+'</h3>'+keys.map(client=>'<button type="button" data-client="'+client.owner+'">'+text(client.customer)+'</button>').join('')+'</aside>':'');
}
// The daily scheduled backup's state, loaded when Settings opens.
async function showBackupStatus() {
  const line = document.querySelector('[data-backup-status]');
  if (!line || line.dataset.loaded) return;
  line.dataset.loaded = '1';
  try {
    const status = await api('backups');
    if (!line.isConnected) return;
    line.textContent = !status.enabled ? t("Daily backups are off: no backup destination is set up.")
      : status.last_error ? t("The last daily backup failed: {error}",{ error:status.last_error })
      : status.last_backup ? t("Daily backup: last made {date}. The newest {keep} are kept.",{ date:date(status.last_backup), keep:status.keep })
      : t("Daily backups are on. The first one is made within a day.");
  } catch { line.textContent = ''; }
}
async function showFinancials() {
  const panel = document.querySelector('#financial-summary');
  if (!panel || panel.dataset.loaded || panel.getAttribute('aria-busy') === 'true') return;
  panel.setAttribute('aria-busy','true');
  panel.textContent = t("Loading booking totals…");
  try {
    const [{completed,upcoming},feedback] = await Promise.all([api('financials'),api('feedback')]);
    if (!panel.isConnected) return;
    const totals = completed.reduce((total, row) => ({visits:total.visits+row.visits,cents:total.cents+row.cents}),{visits:0,cents:0});
    const metric = (label, row) => '<article><h3>'+label+'</h3><strong>'+money(row.cents)+'</strong><p>'+
      t('booking.visits', {count:row.visits})+'</p></article>';
    const rows = completed.map(row => '<li><span>'+text(row.service)+' · '+row.visits+(row.visits === 1 ? ' visit' : ' visits')+
      '</span><strong>'+money(row.cents)+'</strong></li>').join('');
    panel.innerHTML = '<div class="financial-metrics">'+metric(t("Completed in the last 30 days"),totals)+
      metric(t("Upcoming confirmed"),upcoming)+("</div><h3>" + t("Completed visits by service") + "</h3>")+
      (rows ? '<ul class="financial-breakdown">'+rows+'</ul>' : ("<p>" + t("No completed visits in the last 30 days.") + "</p>"));
    panel.insertAdjacentHTML('beforeend','<h3>'+text(t('Visit feedback'))+'</h3><p>'+
      [[1,'Happy'],[0,'Okay'],[-1,'Needs attention']].map(([score,label])=>text(t(label))+' '+feedback.counts[score]).join(' · ')+'</p>'+
      feedback.recent.filter(item=>item.comment).map(item=>'<p class="preserve"><strong>'+text(item.customer)+'</strong> · '+text(item.comment)+'</p>').join(''));
    panel.dataset.loaded = '1';
  } catch {
    panel.innerHTML = ("<p>" + t("Couldn’t load booking totals.") + "</p><button type=\"button\" data-retry-financials>" + t("Try again") + "</button>");
  } finally { panel.setAttribute('aria-busy','false'); }
}
let changingLanguage = false;
let heldBooking;
function render() {
  configureCareUi({data,api,refresh,notify:showPublicationFeedback});
  logout.hidden = accountLink.hidden = !data?.user;
  if (!data?.user) {
    portalLinks.replaceChildren();
    auth();
    return;
  }
  // Replacing the page discards an open booking review, so give its held time back.
  const discarded = changingLanguage ? null : openReview();
  if (discarded && !discarded.dataset.expired) { clearTimeout(holdTimer); releaseHold(Number(discarded.dataset.expires)); }
  // Keep anything typed into other forms: record it before replacing the page, put it back afterwards.
  drafts.use(data.user.id);
  drafts.capture(app);
  const admin = data.user.admin;
  const today = day(Date.now());
  const bookings = data.bookings.filter(b => b.starts >= Date.now() || b.status === 'In Progress');
  const history = data.bookings.filter(b => !bookings.includes(b)).sort((a,b) => b.starts-a.starts);
  const cards = rows => rows.length ? rows.map(bookingCard).join('') : ("<p>" + t("No appointments here yet.") + "</p>");
  const older = data.history_next ? '<button type="button" class="secondary" id="more-history">'+emoji('⬇️')+(t("Show older bookings") + "</button>") : '';
  const main = admin ? staffVisitsLabel() : t("My bookings");
  document.querySelector('.portal h1').textContent = t("Welcome, ")+data.user.name+'.';
  const links = admin
    ? [['staff-home',t("Staff home")],['upcoming',staffVisitsLabel()],['diary',t("Publish updates")],['history',t("Booking history")],['settings',t("Services & availability")],['financials',t("Financials")],['clients',t('Clients')]].filter(([id]) => isOwner() || !['settings','financials'].includes(id))
    : [['client-home',t("Home")],['upcoming',t("My bookings")],['book',t("Book a visit")],['pets',t("My pets")],['care',t('Care details')],['diary',t("Pet Diary")]];
  portalLinks.innerHTML = links.map(([id,label]) => '<a href="#'+id+'">'+text(translateLabel(label))+'</a>').join('');
  const staffNotice = !admin && new URLSearchParams(location.search).get('staff') === '1'
    ? ("<p>" + t("You’re signed in as a client. Sign out to switch to your staff account.") + "</p>") : '';
  app.innerHTML = staffNotice+(admin ? section('staff-home',t("Staff home"),staffHome(bookings)) : section('client-home',t("Client home"),clientHome()))+
    section('upcoming',main,admin ? cards(bookings.filter(b=>b.status === 'In Progress' || day(b.starts) === today)) +
      ("<h3>" + t("Other upcoming bookings") + "</h3>")+cards(bookings.filter(b=>b.status !== 'In Progress' && day(b.starts) !== today))
      : ("<h3>" + t("Upcoming visits") + "</h3>")+cards(bookings)+("<h3>" + t("Past visits") + "</h3>")+cards(history)+older)+
    (admin ? (isOwner() ? section('settings',t("Services and availability"),adminSettings()+staffComplianceSettings(data)) : '') :
      section('pets',t("Pet profiles"),data.pets.map(p=>'<article><h3>'+text(p.name)+'</h3>'+profileSummary(p)+vaccineTools(p)+tapLink('#pet-'+p.id,t('Care history'),'📖')+("<details><summary>" + t("Edit profile") + "</summary>")+petForm(p)+'</details></article>').join('')+("<h3>" + t("Add a pet") + "</h3>")+petForm())+
      section('book',t("Request care"),bookingForm())+
      bookings.filter(canReviewCheckout).map(booking => section('checkout-'+booking.id,t("Visit details"),checkoutSummary(booking))).join(''))+
    section('diary',admin ? t("Publish updates") : t("Pet Diary"),
      (admin ? publishingDesk()+("<h3>" + t("Published updates") + "</h3>") : '')+'<div id="diary-feed">'+diary()+'</div>')+
    (admin ? section('history',t("Booking history"),cards(history)+older)+
      (isOwner() ? section('financials',t("Financials"),("<p>" + t("These totals use booking prices. The portal doesn’t track payments collected or refunds.") + "</p>")+
        '<div id="financial-summary" aria-live="polite"></div>') : '') : '')+
    section('account',t("Account"),accountSettings())+
    (admin ? clientSection() : section('care',t('Care details'),careSettings(data))+data.pets.map(timelineSection).join(''));
  if(admin)updateLaunchServiceForm(app.querySelector('[data-action="services"]'));
  updateQuote();
  drafts.restore(app, {
    onChoice:(form, input) => {
      if(form.dataset.action==='reschedule' && data.pricing_mode==='launch')input.dispatchEvent(new Event('change',{bubbles:true}));
      if (form.dataset.action === 'events' && input.name === 'kind') {
        const panel=form.querySelector('[data-report-fields]');
        panel.innerHTML=reportInputs(data.reportFields[panel.dataset.serviceKind]?.[input.value] || []);
      }
      if (form.dataset.action !== 'bookings') return;
      if (['service','day','slot'].includes(input.name)) updateQuote({ target:input });
      if (input.name === 'pets') updateTotal(form);
    },
    onFile:(form, input, file) => showPhotoSelection(form, file),
    onStep:(form, step) => showPetCard(form, step),
  });
  for (const form of app.querySelectorAll('form[data-action="status"]')) updateDepartureCheck(form); // after drafts are restored
  if (!admin && location.hash === '#book') applyRepeatBooking();
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
  loadCareSection(id);
  if (id === 'settings') { showBackupStatus(); showStaffPanel(); }
  if (focus) {
    const heading = document.getElementById(id).querySelector('h2');
    heading.tabIndex = -1;
    heading.focus();
  }
}
window.addEventListener('hashchange', () => {
  showSection(true);
  if (data?.user && !data.user.admin) {
    if (location.hash === '#book') applyRepeatBooking();
    showPublicationFeedback('');
    if (location.hash === '#diary') refreshDiaryView();
  }
});
function applyRepeatBooking(prefill) {
  try {
    prefill ??= JSON.parse(sessionStorage.getItem('myo-prefill'));
    sessionStorage.removeItem('myo-prefill');
  } catch { /* a click can still prefill when storage is blocked */ }
  const booking = app.querySelector('[data-action="bookings"]');
  if (!booking || !prefill || prefill.owner !== data.user.id) return;
  const service = [...booking.querySelectorAll('[name="service"]')].find(input => Number(input.value) === prefill.service);
  if (!service) return;
  service.checked = true;
  for (const pet of booking.querySelectorAll('[name="pets"]')) pet.checked = prefill.pets.includes(Number(pet.value));
  updateQuote({target:service});
}
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
function quoteLines(lines) {
  return lines?.length ? '<dl class="quote-lines">'+lines.map(line =>
    '<div><dt>'+text(line.code === 'nightly' ? t('{service} (per night)', {service:translateLabel(line.label.replace(/ \(per night\)$/, ''))}) : translateLabel(line.label))+(line.code === 'extra_pet' ? ' × '+Number(line.quantity) : '')+
    '</dt><dd>'+money(line.cents)+'</dd></div>').join('')+'</dl>' : '';
}
const quoteRequests = new WeakMap();
function updateTotal(booking, message = '') {
  syncStayCalendar(booking);
  clearTimeout(quoteRequests.get(booking)?.timer);
  const request = {};
  quoteRequests.set(booking,request);
  const fields = new FormData(booking);
  const service = find(data.services,Number(fields.get('service')));
  const overnight = service?.kind === 'overnight';
  const nights = overnight ? stayNightCount(fields.get('stay_start'), fields.get('stay_end')) : 0;
  const stay = overnight && nights ? { arrive:easternEpoch(fields.get('stay_start'), fields.get('drop_time')), depart:easternEpoch(fields.get('stay_end'), fields.get('pick_time')) } : null;
  const [slot,start] = overnight ? [stay && 1, stay?.arrive] : (fields.get('slot') || '').split(':').map(Number);
  const pets = fields.getAll('pets').map(Number);
  const summary = booking.querySelector('[data-quote]');
  const lines = booking.querySelector('[data-quote-lines]');
  const status = booking.querySelector('[data-quote-status]');
  const retry = booking.querySelector('[data-retry-quote]');
  const review = booking.querySelector('[data-booking-summary] button[type="submit"]');
  const showTotal = cents => {
    summary.textContent = !start ? '' : overnight ? [money(cents),t('booking.nights', {count:nights})].join(' · ')
      : [appointmentDay.format(start),appointmentTime.format(start),money(cents)].join(' · ');
  };
  delete booking.dataset.quotedCents;
  lines.replaceChildren();
  retry.hidden = true;
  status.textContent = message;
  review.disabled = !slot || pets.length > 0;
  if (!service || !slot) { summary.textContent = ''; return; }
  showTotal(bookingTotal(service,pets.length,nights || 1));
  if (!pets.length) return;
  request.timer = setTimeout(async () => {
    if (!booking.isConnected || quoteRequests.get(booking) !== request) return;
    try {
      const quote = await api('quote',overnight ? { service:service.id,...stay,pets } : { service:service.id,slot,start,pets });
      if (!booking.isConnected || quoteRequests.get(booking) !== request) return;
      booking.dataset.quotedCents = quote.total_cents;
      showTotal(quote.total_cents);
      lines.innerHTML = quoteLines(quote.lines);
      const blocked = quote.blockers || [];
      status.innerHTML = blockerHtml(blocked,data);
      review.disabled = blocked.length > 0;
    } catch (error) {
      if (!booking.isConnected || quoteRequests.get(booking) !== request) return;
      status.textContent = error.message;
      retry.hidden = false;
    }
  },250);
}
function showBookingDayPage(booking, page) {
  const dates = [...booking.querySelectorAll('[name="day"]')];
  const start = page * daysPerPage;
  // Keep off-page radios in the form so the selected day remains available to draft capture and restore.
  dates.forEach((input,index) => { input.closest('label').hidden = index < start || index >= start + daysPerPage; });
  booking.dataset.bookingDayPage = page;
  booking.querySelector('[data-day-page="-1"]').disabled = page === 0;
  booking.querySelector('[data-day-page="1"]').disabled = start + daysPerPage >= dates.length;
}
// An overnight stay is chosen as drop-off and pickup dates and times (C2.1). The server checks every night.
function stayFields(booking) {
  const nights = data.overnight_nights || [];
  const availability = booking.querySelector('[data-availability]');
  availability.hidden = nights.length > 0;
  booking.querySelector('[data-availability-message]').textContent = t("Myomi isn’t taking overnight stays right now. Check back later.");
  booking.querySelector('[data-check-availability]').hidden = true;
  booking.querySelector('[data-booking-options]').hidden = !nights.length;
  booking.querySelector('.booking-date-pages').hidden = true;
  booking.querySelector('[data-booking-summary]').hidden = !nights.length;
  const first = nights[0]?.date || '', last = nights.at(-1)?.date || '';
  const lastPickup = last ? new Date(Date.parse(last + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10) : '';
  booking.querySelector('[data-booking-days]').innerHTML = nights.length ? ("<fieldset class=\"stay-fields\"><legend>" + t("Your stay") + "</legend>")+
    ("<p>" + t("Nights available from "))+text(formatDate(easternEpoch(first,'12:00'),'date'))+(t(". Times are Massachusetts time.") + "</p>")+
    stayCalendar(nights)+input(t("Drop-off date"),'stay_start','type="date" required min="'+first+'" max="'+last+'"')+
    input(t("Drop-off time"),'drop_time','type="time" step="1800" required value="17:00"')+
    input(t("Pickup date"),'stay_end','type="date" required min="'+first+'" max="'+lastPickup+'"')+
    input(t("Pickup time"),'pick_time','type="time" step="1800" required value="10:00"')+'</fieldset>' : '';
  booking.querySelector('[data-booking-times]').innerHTML = '';
  updateTotal(booking);
}
function updateQuote(event, keepDay = false) {
  const booking = app.querySelector('[data-action="bookings"]');
  if (!booking) return;
  const service = find(data.services,Number(booking.querySelector('[name="service"]:checked')?.value));
  if (service?.kind === 'overnight') { stayFields(booking); return; }
  booking.querySelector('.booking-date-pages').hidden = false;
  const slots = service ? availableSlots(service.minutes,service.id) : [];
  const days = new Map(slots.map(slot => [day(slot.starts),appointmentDay.format(slot.starts)]));
  const changed = event?.target.name;
  const previousDay = booking.querySelector('[name="day"]:checked')?.value;
  const previousTime = booking.querySelector('[name="slot"]:checked')?.value;
  const dayKeys = [...days.keys()];
  const chosenDay = (keepDay || changed === 'day' || changed === 'slot') && days.has(previousDay) ? previousDay : dayKeys[0];
  if (!['day','slot'].includes(changed)) {
    booking.querySelector('[data-booking-days]').innerHTML = choiceGroup(t("Available day"),
      [...days].map(([key,label]) => choice('day',key,label,{ checked:key === dayKeys[0], required:true })).join(''));
    if (chosenDay) booking.querySelectorAll('[name="day"]')[dayKeys.indexOf(chosenDay)].checked = true;
  }
  if (changed !== 'slot') showBookingDayPage(booking,Math.floor(Math.max(0,dayKeys.indexOf(chosenDay))/daysPerPage));
  const appointments = slots.filter(slot => day(slot.starts) === chosenDay);
  if (changed !== 'slot') {
    const groups = new Map([['Morning',[]],['Midday',[]],['Evening',[]]]);
    for (const slot of appointments) {
      const hour = Number(appointmentHour.format(slot.starts));
      groups.get(hour < 12 ? 'Morning' : hour < 16 ? 'Midday' : 'Evening').push(slot);
    }
    const firstTime = appointments[0] && slotKey(appointments[0]);
    booking.querySelector('[data-booking-times]').innerHTML = [...groups].filter(([,times]) => times.length)
      .map(([label,times]) => choiceGroup(label,slotChoices(times,slot => appointmentTime.format(slot.starts),{ selected:firstTime }))).join('');
    if (keepDay) {
      const restored = [...booking.querySelectorAll('[name="slot"]')].find(input => input.value === previousTime);
      if (restored) restored.checked = true;
    }
  }
  const selectedTime = booking.querySelector('[name="slot"]:checked')?.value;
  const appointment = appointments.find(slot => slotKey(slot) === selectedTime);
  const availability = booking.querySelector('[data-availability]');
  availability.hidden = slots.length > 0;
  const name = requestedService();
  booking.querySelector('[data-availability-message]').textContent = service
    ? (data.services.length === 1 ? t("Myomi hasn't published times for {service} yet.", {service:translateLabel(service.name)})
      : t("No times are available for this service right now. Try another service or check back later."))
    : t("{service} is unavailable right now. Choose another service or check back later.", {service:translateLabel(name || t("This service"))});
  booking.querySelector('[data-check-availability]').hidden = !service;
  booking.querySelector('[data-booking-options]').hidden = !slots.length;
  booking.querySelector('[data-booking-summary]').hidden = !appointment;
  updateTotal(booking);
}
async function checkAvailability(control) {
  const booking = control.form;
  const current = data;
  const status = booking.querySelector('[data-availability-status]');
  control.disabled = true;
  control.textContent = t("Checking…");
  status.textContent = '';
  try {
    const { slots } = await api('portal');
    if (data !== current || !booking.isConnected) return;
    const hadButton = !control.closest('[hidden]');
    data.slots = slots;
    updateQuote(undefined,true);
    const found = booking.querySelector('[data-availability]').hidden;
    status.textContent = found ? t("Available times updated.") : t("Still no times — try again later.");
    if (found && hadButton && document.activeElement === document.body) {
      booking.querySelector('[name="day"]:checked')?.focus();
    }
  } catch {
    status.textContent = t("Couldn’t check for times. Try again.");
  } finally {
    control.disabled = false;
    control.innerHTML = emoji('🔄')+t("Check again");
  }
}
async function refresh() {
  const user = await api('session');
  // Keep the account's language in step with the reader's choice, for messages sent outside the portal.
  if (user && user.locale !== locale()) api('locale', { locale:locale() }).catch(() => {});
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
  if (file.size > 25_000_000) throw new Error(t("Choose a photo smaller than 25 MB."));
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
      throw new Error(t("This photo could not be opened. Try a JPEG, PNG, or WebP."));
    } finally { bitmap?.close(); }
  }
  if (!photo || photo.size > 2_500_000) throw new Error(t("Choose a smaller photo."));
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t("Could not read the selected photo.")));
    reader.readAsDataURL(photo);
  });
}
function showPhotoSelection(form, file) {
  form.querySelector('[data-photo-status]').textContent = file ? t("Photo ready to publish: ")+file.name : '';
  form.querySelector('[data-clear-photo]').hidden = !file;
}

app.addEventListener('change', event => {
  const { name, value, form } = event.target;
  if(form?.dataset.action==='services')updateLaunchServiceForm(form);
  if (name === 'kind' && form?.dataset.action === 'events') {
    const panel=form.querySelector('[data-report-fields]');
    panel.innerHTML=reportInputs(data.reportFields[panel.dataset.serviceKind]?.[value] || []);
  }
  if (form?.dataset.action === 'reschedule' && name==='slot' && data.pricing_mode==='launch') {
    const token={};
    moveQuotes.set(form,token);
    const control=form.querySelector('button[type="submit"]');
    const status=form.querySelector('[data-move-quote]');
    control.disabled=true;
    const [slot,start]=value.split(':').map(Number);
    api('reschedule-quote',{id:Number(form.dataset.id),slot,start}).then(result=>{
      if(!form.isConnected||moveQuotes.get(form)!==token)return;
      let cents=form.elements.cents;
      if(!cents){cents=document.createElement('input');cents.type='hidden';cents.name='cents';form.append(cents);}
      cents.value=result.total_cents;
      status.textContent=t('Proposed total {amount}',{amount:money(result.total_cents)});
      control.disabled=false;
    }).catch(error=>{if(form.isConnected&&moveQuotes.get(form)===token)status.textContent=error.message;});
  }
  if (['camera','photo'].includes(name) && form && event.target.type === 'file') {
    const other = form.elements[name === 'camera' ? 'photo' : 'camera'];
    const file = event.target.files[0];
    if (file) other.value = '';
    showPhotoSelection(form,file || other.files[0]);
  }
  if (name === 'secured' && form) {
    if (!event.target.checked) form.dataset.unsecured = '1';
    updateDepartureCheck(form);
  }
  if (form?.dataset.action === 'bookings' && ['stay_start','stay_end','drop_time','pick_time'].includes(name)) updateTotal(form);
  if (form?.dataset.action === 'bookings' && name === 'pets') { form.querySelector('[data-booking-pet-error]').textContent = ''; updateTotal(form); }
  if (form?.dataset.action === 'bookings' && ['service','day','slot'].includes(name)) {
    form.querySelector('[data-availability-status]').textContent = '';
    updateQuote(event);
  }
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
  if (event.target.name === 'secure_note' && event.target.form) updateDepartureCheck(event.target.form);
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
  const changeDates = event.target.closest('[data-day-page]');
  if (changeDates) {
    const booking = changeDates.form;
    showBookingDayPage(booking,Number(booking.dataset.bookingDayPage)+Number(changeDates.dataset.dayPage));
    if (changeDates.disabled) booking.querySelector('[data-day-page="'+(-Number(changeDates.dataset.dayPage))+'"]').focus();
    return;
  }
  const availabilityCheck = event.target.closest('[data-check-availability]');
  if (availabilityCheck) {
    await checkAvailability(availabilityCheck);
    return;
  }
  const retryQuote = event.target.closest('[data-retry-quote]');
  if (retryQuote) {
    updateTotal(retryQuote.form);
    return;
  }
  const reportUnsecured = event.target.closest('[data-report-unsecured]');
  if (reportUnsecured) {
    reportUnsecured.form.dataset.unsecured = '1';
    updateDepartureCheck(reportUnsecured.form);
    reportUnsecured.form.elements.secure_note.focus();
    return;
  }
  const bookAgain = event.target.closest('[data-book-again]');
  if (bookAgain) {
    const visit = find(data.bookings,Number(bookAgain.dataset.bookAgain));
    if (!visit) return;
    const prefill = {owner:data.user.id,service:visit.service,pets:visit.pet_ids};
    try {
      sessionStorage.setItem('myo-prefill',JSON.stringify(prefill));
      if (location.hash === '#book') applyRepeatBooking(prefill);
    } catch { applyRepeatBooking(prefill); }
    return;
  }
  const editBooking = event.target.closest('[data-edit-booking]');
  if (editBooking) {
    const form = editBooking.form;
    const review = form.querySelector('[data-booking-review]');
    if (review.dataset.expired) {
      editBooking.disabled = true;
      await reopenBooking(t("Times below are up to date. Choose one and review your visit again."));
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
      if (control.id === 'refresh-diary') feedback.textContent = t("Diary is up to date.");
    }
  } catch (error) {
    if (data === before) feedback.textContent = error.message;
  } finally {
    controls.forEach(item => { item.disabled = false; });
  }
}
// Resolves to null when kept, or { fee } when confirmed. A customer sees any cancellation fee first (C3.2), and the
// fee they saw is sent with the cancellation so a fee that changed meanwhile is never charged unseen.
async function confirmCancellation(kind, bookingId) {
  const decline = kind === 'decline';
  cancelDialog.querySelector('h3').textContent = decline ? t("Decline this request?") : t("Cancel this visit?");
  cancelDialog.querySelector('[value="keep"]').textContent = decline ? t("Keep request") : t("Keep visit");
  cancelDialog.querySelector('[data-cancel-label]').textContent = decline ? t("Decline request") : t("Cancel visit");
  const terms = cancelDialog.querySelector('[data-cancel-terms]');
  terms.textContent = '';
  let fee = 0;
  if (!data.user.admin && bookingId) {
    try {
      const preview = await api('cancellation-preview?booking='+bookingId);
      fee = preview.fee_cents;
      const back = preview.refund_due_cents ? ' '+t("{amount} of what you paid will be due back to you.",{ amount:money(preview.refund_due_cents) }) : '';
      terms.textContent = (fee ? t("Cancelling now has a fee of {fee} ({percent}% · within {hours} hours of the visit).",{ fee:money(fee), percent:preview.percent, hours:preview.cutoff_hours })
        : t("Cancelling is free."))+back;
    } catch { /* the server still checks the fee */ }
  }
  cancelDialog.returnValue = '';
  cancelDialog.showModal();
  return new Promise(resolve => {
    cancelDialog.addEventListener('close',() => resolve(cancelDialog.returnValue === 'confirm' ? { fee } : null),{ once:true });
  });
}
app.addEventListener('submit',async event => {
  if (event.target.matches('[data-care-action]')) return;
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
    form.querySelector('[data-booking-pet-error]').textContent = t("Choose at least one pet.");
    form.querySelector('[name="pets"]').focus();
    return;
  }
  const payload = Object.fromEntries(fields);
  if (form.dataset.id) payload.id = Number(form.dataset.id);
  const cancelling = action === 'status' && payload.status === 'Cancelled';
  const declining = cancelling && data.user.admin && find(data.bookings,payload.id)?.status === 'Requested';
  if (cancelling) {
    const confirmed = await confirmCancellation(declining ? 'decline' : 'cancel', payload.id);
    if (!confirmed) return;
    if (confirmed.fee) payload.accept_fee_cents = confirmed.fee;
  }
  const control = event.submitter || form.querySelector('button[type="submit"]');
  if (action === 'signout-all') suspendBookingQuote();
  control.disabled = true;
  const languageControls = [...document.querySelectorAll('[data-language]')];
  languageControls.forEach(button => { button.disabled = true; });
  const publication = action === 'events' ? t("Published to the customer’s Pet Diary.")
    : action === 'slots' && !payload.id ? t("Appointment window published.")
    : action === 'status' && payload.status === 'Completed' ? t("Visit completed. Summary published to the customer’s Pet Diary.")
    : action === 'services' ? t("Service saved. Clients can request it when a time is available.")
    : action === 'schedule' ? t("Weekly hours saved.")
    : action === 'schedule-exception' ? t("Date change saved.")
    : '';
  showPublicationFeedback(t("Saving…"), Boolean(publication));
  let saved = false;
  try {
    if (action === 'pets') {
      const profile = { profileVersion: 1 };
      for (const [key] of profileFields) {
        if (payload[key]?.trim()) profile[key] = payload[key].trim();
        delete payload[key];
      }
      payload.details = JSON.stringify(profile);
      if (payload.details.length > 3000) throw new Error(t("Shorten the care notes so the profile can be saved."));
    }
    if (typeof payload.slot === 'string' && payload.slot.includes(':')) [payload.slot,payload.start] = payload.slot.split(':').map(Number);
    for (const key of ['service','slot','pet','minutes','cents']) if (key in payload) payload[key] = Number(payload[key]);
    if (action === 'bookings') {
      const service = find(data.services,payload.service);
      let nights = 1;
      if (service?.kind === 'overnight') {
        nights = stayNightCount(payload.stay_start, payload.stay_end);
        if (!nights) throw new Error(t("Choose a pickup date after the drop-off date."));
        payload.arrive = easternEpoch(payload.stay_start, payload.drop_time);
        payload.depart = easternEpoch(payload.stay_end, payload.pick_time);
        for (const key of ['stay_start','stay_end','drop_time','pick_time','slot']) delete payload[key];
      } else if (!service || !payload.slot) throw new Error(t("Choose a service and an available appointment."));
      payload.pets = fields.getAll('pets').map(Number);
      if (fields.has('use_package')) payload.use_package = true; else delete payload.use_package;
      const review = form.querySelector('[data-booking-review]');
      if (form.dataset.quotedCents === undefined) throw new Error(t("Wait for the updated price before reviewing your booking."));
      payload.cents = Number(form.dataset.quotedCents);
      if (!review.dataset.expires) {
        const hold = await api('checkout-hold',payload,requestKey(form,'checkout-hold\n'+JSON.stringify(payload)));
        pendingKeys.delete(form);
        review.dataset.expires = hold.expires;
        heldBooking = {
          service_name:service.name, service_kind:service.kind, pet_ids:payload.pets, starts:hold.starts, ends:hold.ends, cents:hold.total_cents, lines:hold.lines,
        };
        review.innerHTML = checkoutSummary(heldBooking,hold.expires);
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
    if (action === 'services') {
      payload.cents = Math.round(Number(payload.price)*100);
      payload.extra_pet_cents = Math.round(Number(payload.extra_pet)*100);
      delete payload.extra_pet;
      payload.cancel_cutoff_hours = Number(payload.cancel_cutoff_hours);
      payload.cancel_fee_percent = Number(payload.cancel_fee_percent);
    }
    if (action === 'status' && payload.status === 'Completed') payload.secured = fields.has('secured');
    if (['payments/start','payments/record','refunds','tips'].includes(action)) {
      payload.booking = payload.id;
      delete payload.id;
      if ('dollars' in payload) { payload.cents = Math.round(Number(payload.dollars)*100); delete payload.dollars; }
    }
    if (action === 'auto-tip') payload.percent = Number(payload.percent);
    if (action === 'staff/update' && 'disabled' in payload) payload.disabled = payload.disabled === 'true';
    if (action === 'schedule') {
      payload.days = fields.getAll('days').map(Number);
      payload.buffer = Number(payload.buffer);
      payload.overnight_days = fields.getAll('overnight_days').map(Number);
      payload.late_pickup_grace = Number(payload.late_pickup_grace);
    }
    if (action === 'slots' && !payload.id) {
      payload.starts = new Date(payload.starts).toISOString();
      payload.ends = new Date(payload.ends).toISOString();
    }
    if (action === 'events') {
      const panel=form.querySelector('[data-report-fields]');
      payload.data=reportPayload(form,data.reportFields[panel.dataset.serviceKind]?.[payload.kind] || []);
      for(const key of Object.keys(payload)) if(key.startsWith('report_'))delete payload[key];
      payload.photo = await readPhoto(fields.get('camera')?.size ? fields.get('camera') : fields.get('photo'));
      delete payload.camera;
    }
    const key = requestKey(form, action+'\n'+JSON.stringify(payload));
    let result;
    try { result = await api(action,payload,key); }
    catch (error) { if (!error.network) pendingKeys.delete(form); throw error; }
    // Online payment happens on the provider's page; the booking shows as paid once the provider confirms it.
    if (result?.redirect_url) { drafts.forget(form); location.assign(result.redirect_url); return; }
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
    if (action === 'signout-all') { drafts.clear(); feedback.textContent = t("Signed out on every device."); return; }
    if (result?.change) { feedback.textContent = t("Change requested — waiting for Myomi."); return; }
    if (action === 'changes/decide') { feedback.textContent = payload.decision === 'approve' ? t("Change approved. The visit has moved.") : t("Change declined. The visit keeps its time."); return; }
    if (action === 'changes/withdraw') { feedback.textContent = t("Change request withdrawn."); return; }
    if (action === 'payments/record') { feedback.textContent = t("Payment recorded."); return; }
    if (action.startsWith('staff')) { feedback.textContent = t("Staff accounts saved."); return; }
    if (action === 'refunds') { feedback.textContent = t("Refund recorded."); return; }
    if (action === 'tips') { feedback.textContent = t("Thank you! Your tip was added to the balance."); return; }
    if (action === 'auto-tip') { feedback.textContent = payload.percent ? t("Automatic tip saved.") : t("Automatic tip turned off."); return; }
    feedback.textContent = action === 'bookings' ? t("Request sent. Myomi still needs to confirm your appointment.")
      : action === 'status' && payload.status === 'Confirmed' ? t("Request approved.")
      : action === 'status' && payload.status === 'Cancelled' ? (declining ? t("Request declined.") : t("Visit cancelled."))
      : action === 'reschedule' ? (data.user.admin ? t("New time saved.") : t("Visit moved to ")+date(payload.start)+'.')
      : action === 'password' ? t("Password changed. Your other devices have been signed out.")
      : action === 'register' ? t("Your account is ready.")
      : signedIn ? ''
      : resumeBooking ? t("Pet added. You can continue booking.") : t("Saved.");
  } catch (error) {
    if (action === 'bookings' && error.code === 'blocked') {
      const review=openReview();
      if(review)await releaseHold(Number(review.dataset.expires));
      await reopenBooking(t('Complete the booking requirements below.'));
      const status=app.querySelector('[data-quote-status]');
      if(status)status.innerHTML=blockerHtml(error.blockers || [],data);
      return;
    }
    if (action === 'bookings' && error.code === 'price_changed') {
      const review = openReview();
      if (review) await releaseHold(Number(review.dataset.expires));
      await reopenBooking(t("The price changed — review the new total."));
      const booking = app.querySelector('[data-action="bookings"]');
      if (booking) updateTotal(booking,t("The price changed — review the new total."));
      return;
    }
    if (action === 'changes/decide' && error.code === 'time_reserved') {
      feedback.textContent = t("That time was taken. Decline the change or ask for another time.");
      return;
    }
    // The time was taken, the hold ran out, or another tab replaced it: show current times, not the stale list.
    if (action === 'bookings' && error.status === 409) {
      showPublicationFeedback('');
      await reopenBooking(error.message+" "+t("The times below are up to date."));
      return;
    }
    const registrationError = form.querySelector('[data-registration-error]');
    if (registrationError?.isConnected) {
      feedback.textContent = '';
      registrationError.textContent = error.message;
    } else {
      showPublicationFeedback(saved && publication ? publication+" "+t("Refresh the page to see the latest changes.") : error.message, Boolean(publication));
    }
  }
  finally {
    control.disabled = false;
    languageControls.forEach(button => { button.disabled = false; });
  }
});
logout.addEventListener('click',async () => {
  suspendBookingQuote();
  showPublicationFeedback('');
  try {
    await api('logout',{});
    drafts.clear();
    history.replaceState(null,'',location.pathname+location.search+(new URLSearchParams(location.search).get('staff') === '1' ? '#diary' : ''));
    await refresh();
    feedback.textContent = t("Signed out.");
  } catch (error) { feedback.textContent = error.message; }
});

function suspendBookingQuote() {
  const booking=app.querySelector('[data-action="bookings"]');
  if (!booking) return;
  clearTimeout(quoteRequests.get(booking)?.timer);
  quoteRequests.delete(booking);
}
refresh().then(() => {
  // Back from the hosted checkout: the redirect proves nothing, so say what happens next and tidy the address.
  const returned = new URLSearchParams(location.search).get('payment');
  if (!returned) return;
  feedback.textContent = returned === 'success' ? t("Thank you. Your payment is being confirmed; it shows as paid once the payment provider confirms it.")
    : t("Checkout cancelled. Nothing was charged.");
  const clean = new URL(location.href);
  for (const name of ['payment','fake_session']) clean.searchParams.delete(name);
  history.replaceState(null,'',clean);
}).catch(error => {
  app.setAttribute('aria-busy','false');
  app.textContent = t("The care portal needs a running myo. server.");
  feedback.textContent = error.message;
});

// A language change re-renders labels while keeping the current form values in memory.
// Passwords and files never enter localStorage or sessionStorage through this snapshot.
bindCareUi(app);
document.addEventListener('visibilitychange', () => {if(document.hidden)clearEntryDetails();});
window.addEventListener('pagehide',clearEntryDetails);
window.addEventListener('myo:languagechange', () => {
  const forms = [...app.querySelectorAll('form')].map(form => ({
    fields: [...form.elements].filter(field => field.name && !field.matches('[data-no-draft]')).map(field => ({
      name: field.name, value: field.value, checked: field.checked,
      type: field.type, files: field.type === 'file' ? field.files : null,
      error: field.closest('.pet-field')?.querySelector('.pet-field-error')?.textContent || '',
    })),
    details: [...form.querySelectorAll('details')].map(detail => detail.open),
    step: Number(form.dataset.draftStep || 0),
  }));
  const heldReview = openReview();
  const heldState = heldReview && {
    expires: Number(heldReview.dataset.expires),
    expired: heldReview.dataset.expired,
    released: heldReview.dataset.released,
  };
  const message = feedback.textContent;
  changingLanguage = true;
  try {
    render();
    const newForms = [...app.querySelectorAll('form')];
    forms.forEach((saved, index) => {
      const form = newForms[index];
      if (!form) return;
      for (const state of saved.fields) {
        const field = [...form.elements].find(candidate =>
          candidate.name === state.name && candidate.type === state.type &&
          (!['radio', 'checkbox'].includes(state.type) || candidate.value === state.value));
        if (!field) continue;
        if (state.type === 'file') field.files = state.files;
        else if (['radio', 'checkbox'].includes(state.type)) field.checked = state.checked;
        else field.value = state.value;
        field.setCustomValidity?.('');
        if (state.error && field.closest('.pet-field')) petFieldError(field, translateMessage(state.error));
        if (form.dataset.action === 'bookings' && state.checked &&
            ['service', 'day', 'slot'].includes(state.name)) updateQuote({target: field}, true);
      }
      saved.details.forEach((open, index) => {
        const details = form.querySelectorAll('details')[index];
        if (details) details.open = open;
      });
      if (form.querySelector('[data-pet-card]')) showPetCard(form, saved.step);
      if (form.dataset.action === 'bookings') updateTotal(form);
    });
    if (heldState && heldBooking) {
      const form = app.querySelector('[data-action="bookings"]');
      const review = form?.querySelector('[data-booking-review]');
      if (review) {
        review.innerHTML = checkoutSummary(heldBooking, heldState.expires);
        form.dataset.quotedCents = heldBooking.cents;
        review.dataset.expires = heldState.expires;
        review.hidden = false;
        form.querySelector('[data-booking-inputs]').hidden = true;
        if (heldState.expired || heldState.released || heldState.expires <= Date.now()) {
          expireHold(form);
        } else {
          startHoldTimer(form);
        }
      }
    }
    feedback.textContent = translateMessage(message);
    if (data?.user) api('locale', {locale: locale()}).catch(() => {});
  } finally {
    changingLanguage = false;
  }
});

function translateMessage(message) {
  for (const [key, entry] of Object.entries(catalogs.en)) {
    if (typeof entry === 'string' && (message === entry || message === catalogs.es[key])) return t(key);
  }
  return message;
}

// Browser validation follows the selected site language, including when the browser itself uses English.
app.addEventListener('invalid', event => {
  const field = event.target;
  let key = 'Check this field.';
  if (field.validity.valueMissing) key = 'Complete this required field.';
  else if (field.validity.typeMismatch && field.type === 'email') key = 'Enter a valid email address.';
  else if (field.validity.tooShort) key = 'Use at least {count} characters.';
  else if (field.validity.rangeUnderflow || field.validity.rangeOverflow) key = 'Enter a value within the allowed range.';
  field.setCustomValidity(t(key, {count:field.minLength}));
}, true);
app.addEventListener('input', event => event.target.setCustomValidity?.(''));
