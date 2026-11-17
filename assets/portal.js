import { activityIcons, escapeHtml as text, formatVisitDate as date, renderDiaryVisits } from './diary.js';

const app = document.querySelector('#app');
const feedback = document.querySelector('#feedback');
const logout = document.querySelector('#logout');
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
const bookingIntake = '#pet-intake';
let data;
let filterPet = '';
let filterVisit = '';

async function api(path, payload) {
  const response = await fetch('/api/'+path, payload === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
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
  const fields = input('Email','email','required type="email" maxlength="254" autocomplete="email"') +
    input('Password','password','required type="password" maxlength="128"');
  const service = requestedService();
  const bookingPrompt = service ? 'Sign in or create an account to request '+text(service.toLowerCase())+'.'
    : 'Sign in or create an account to request a visit.';
  app.innerHTML = (['#book', bookingIntake].includes(location.hash) ? '<p>'+bookingPrompt+'</p>' : '<p>Sign in to manage bookings, pet profiles, and your Pet Diary.</p>') + '<div class="grid">'+
    form('login','<h2>Sign in</h2>'+fields+button('Sign in','','🔑'))+
    form('register','<h2>Create an account</h2>'+input('Name','name','required maxlength="100" autocomplete="name"')+
      fields+'<small>Use at least 12 characters for your password.</small>'+button('Create account','','👋'))+'</div>';
}
const profileGroups = [
  ['About your pet', [['breed','Breed'],['sex','Sex'],['age','Age or birthday'],['weight','Weight (lb)']]],
  ['Medical requirements', [['health','Health conditions'],['medication','Medication and schedule'],['heartworm','Heartworm protection'],['allergies','Allergies and care instructions'],['vaccinations','Vaccinations']]],
  ['Dietary requirements', [['food','Food and type'],['portion','Portion size'],['feeding','Feeding schedule'],['restrictions','Food and treat restrictions']]],
  ['Emergency contacts', [['vet','Veterinary clinic'],['vetPhone','Vet phone number'],['contact','Emergency contact name'],['contactPhone','Emergency contact phone number']]],
  ['Daily care', [['behavior','Temperament and triggers'],['notes','Other care instructions']]],
];
const profileFields = profileGroups.flatMap(([, fields]) => fields);
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
  const sections = profileGroups.map(([group, fields]) => {
    const entries = fields.filter(([key]) => saved[key]).map(([key,label]) =>
      '<dt>'+label+'</dt><dd class="preserve">'+text(saved[key])+'</dd>').join('');
    return entries ? '<h4>'+group+'</h4><dl>'+entries+'</dl>' : '';
  }).join('');
  return '<p>'+text(pet.species)+'</p>'+(sections || '<p>No care details added yet.</p>');
}
function petForm(pet) {
  const saved = profileData(pet?.details);
  const groups = profileGroups.map(([group, fields], index) => '<fieldset><legend>'+group+'</legend>'+
    (index === 0 ? input('Pet name','name','required maxlength="80" value="'+text(pet?.name)+'"')+
      input('Species','species','required maxlength="60" value="'+text(pet?.species)+'"') : '')+
    '<div class="grid">'+fields.map(([key,label]) =>
      ['health','medication','allergies','behavior','notes','restrictions'].includes(key)
        ? area(label,key,saved[key],key === 'notes' ? 3000 : 280)
        : input(label,key,'maxlength="120" value="'+text(saved[key])+'"'+(key.endsWith('Phone') ? ' type="tel"' : ''))
    ).join('')+'</div></fieldset>').join('');
  return form('pets',groups+button(pet ? 'Save changes' : 'Add pet','','🐾'),pet?.id);
}
function availableSlots(minutes, exclude, serviceId) {
  return data.slots.filter(slot => slot.ends-slot.starts >= minutes*60_000 &&
    (!serviceId || slot.service_ids.includes(serviceId)) &&
    !data.bookings.some(b => b.id !== exclude && ['Confirmed','In Progress'].includes(b.status) && slot.starts < b.ends && slot.starts + minutes*60_000 > b.starts));
}
const appointmentTime = new Intl.DateTimeFormat('en-US',{timeStyle:'short',timeZone:'America/New_York'});
const appointmentDay = new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/New_York'});
// A bookable time is a published window id plus a start time inside it.
const slotKey = slot => slot.id+':'+slot.starts;
function slotChoices(slots, labelFor = slot => date(slot.starts), { selected } = {}) {
  return slots.map(slot => choice('slot',slotKey(slot),labelFor(slot),{ checked:slotKey(slot) === selected, required:true })).join('');
}
function bookingForm() {
  if (!data.pets.length) return '<p>Add a pet profile to request care.</p>'+tapLink(bookingIntake,'Add a pet profile','🐾');
  if (!data.services.length) return '<p>There are no services available to book right now. Check back for availability.</p>';
  const serviceName = requestedService();
  const preferred = data.services.find(service => service.name === serviceName);
  const unavailable = serviceName && !preferred;
  const initial = preferred ?? (unavailable ? null : data.services[0]);
  const serviceOptions = data.services.map(service =>
    choice('service',service.id,service.name+' · '+service.minutes+' min · '+money(service.cents),{
      checked:service.id === initial?.id, required:true, icon:serviceIcons[service.name],
    })
  ).join('');
  return '<p>Appointment times are shown in Massachusetts time. Myomi reviews each request before confirming.</p>' +
    form('bookings',choiceGroup('Service',serviceOptions)+
    choiceGroup('Pets attending',data.pets.map(pet => choice('pets',pet.id,pet.name,{ type:'checkbox', icon:'🐾' })).join(''))+
    '<div data-booking-days></div><div data-booking-times></div><p data-availability role="status" hidden></p>'+
    area('Care instructions for this visit','notes','',1500)+
    '<p data-quote></p>'+button('Submit booking request','','📅'));
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
function bookingCard(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const active = booking.status === 'In Progress';
  let actions = '';
  if (data.user.admin) {
    if (booking.status === 'Requested') actions += statusForm(booking,'Confirmed','Approve request') + statusForm(booking,'Cancelled','Decline request');
    if (booking.status === 'Confirmed') actions += statusForm(booking,'In Progress','Start visit') + statusForm(booking,'Cancelled','Cancel booking');
    if (active) actions += tapLink('#diary','Publish a diary update','🐾')+statusForm(booking,'Completed','Complete visit');
  } else if (booking.starts > Date.now() && ['Requested','Confirmed'].includes(booking.status)) {
    actions += statusForm(booking,'Cancelled','Cancel booking');
  }
  if (['Requested','Confirmed'].includes(booking.status) && (data.user.admin || booking.starts > Date.now())) {
    const slots = availableSlots((booking.ends-booking.starts)/60000,booking.id);
    if (slots.length) actions += '<details class="reschedule-options"><summary>'+emoji('📅')+'Reschedule</summary>'+
      form('reschedule',choiceGroup('New time',slotChoices(slots))+button('Confirm new time','secondary','✓'),booking.id)+'</details>';
  }
  return '<article><h3>'+text(booking.service_name)+' · '+text(booking.status)+'</h3><p class="appointment-details">'+date(booking.starts)+' – '+date(booking.ends)+' · '+money(booking.cents)+'</p>'+
    (data.user.admin ? '<p>'+text(booking.customer)+' · '+text(booking.email)+'</p>' : '')+
    '<p>Pets: '+pets.map(p=>text(p.name)).join(', ')+'</p><p class="preserve">'+text(booking.notes)+'</p>'+
    (booking.arrived ? '<p class="appointment-details">Arrived: '+date(booking.arrived)+'</p>' : '') + (booking.departed ? '<p class="appointment-details">Completed: '+date(booking.departed)+'</p>' : '')+
    (booking.summary ? '<p class="preserve"><strong>Visit summary:</strong> '+text(booking.summary)+'</p>' : '')+
    (data.user.admin ? pets.map(p=>'<details><summary>'+text(p.name)+'’s care profile</summary>'+profileSummary(p)+'</details>').join('') : '')+
    actions+'</article>';
}
function diary() {
  const eventsByVisit = new Map();
  for (const event of data.events) {
    if (filterPet && String(event.pet) !== filterPet) continue;
    if (!eventsByVisit.has(event.booking)) eventsByVisit.set(event.booking, []);
    eventsByVisit.get(event.booking).push(event);
  }
  const visits = data.bookings.filter(booking =>
    (!filterPet || booking.pet_ids.some(id => String(id) === filterPet)) &&
    (eventsByVisit.has(booking.id) || ['In Progress','Completed'].includes(booking.status))
  ).sort((a,b) => b.starts-a.starts);
  if (!visits.some(visit => String(visit.id) === filterVisit)) filterVisit = '';
  const visible = visits.filter(visit => !filterVisit || String(visit.id) === filterVisit);
  return '<div class="diary-toolbar"><div class="diary-filters">'+
    diaryFilter('filter-pet','🐾','Filter by pet','All pets',filterPet,data.pets,pet => pet.name)+
    diaryFilter('filter-visit','📅','Filter by visit','All visits',filterVisit,visits,visit => visit.service_name+' · '+date(visit.starts))+
    '</div><button type="button" class="secondary" id="refresh-diary">'+emoji('🔄')+'Refresh updates</button></div>'+
    renderDiaryVisits(visible, eventsByVisit, id => find(data.pets,id)?.name, event => {
      if (!event.has_photo) return null;
      const url = '/api/photos/'+event.id;
      return { src:url, href:url, alt:'Open full photo from the care visit' };
    });
}
function diaryFilter(name, icon, label, allLabel, current, rows, labelFor) {
  if (!rows.length) return '';
  const selected = rows.find(row => String(row.id) === current);
  const choices = choice(name,'',allLabel,{ checked:!selected })+
    rows.map(row => choice(name,row.id,labelFor(row),{ checked:row === selected })).join('');
  return '<details data-diary-filter="'+name+'"><summary>'+emoji(icon)+text(label)+
    '<span class="filter-selection">'+text(selected ? labelFor(selected) : allLabel)+'</span></summary>'+
    choiceGroup(label,choices)+'</details>';
}
function adminSettings() {
  return '<div class="grid">'+form('services','<h3>Set a service price</h3>'+
    choiceGroup('Service',Object.entries(serviceIcons).map(([service,icon],index) =>
      choice('name',service,service,{ icon, checked:index === 0, required:true })
    ).join(''))+
    input('Duration in minutes','minutes','type="number" min="1" max="1440" required')+
    input('Price in USD','price','type="number" min="0" max="10000" step="0.01" required')+button('Save service','','✓'))+
    form('slots','<h3>Publish an appointment window</h3><p>Enter the window in your device’s local time. The portal displays Massachusetts time.</p>'+
    input('Starts','starts','type="datetime-local" required')+input('Ends','ends','type="datetime-local" required')+button('Publish window','','📅'))+'</div>'+
    '<p class="appointment-details">'+data.services.map(s=>text(s.name)+' · '+s.minutes+' min · '+money(s.cents)).join('<br>')+'</p>'+
    data.windows.map(s=>form('slots','<p class="appointment-details">'+date(s.starts)+' – '+date(s.ends)+'</p>'+button('Remove window','secondary','✕'),s.id)).join('');
}
const section = (id,title,contents) => '<section id="'+id+'"><h2>'+title+'</h2>'+contents+'</section>';
function render() {
  logout.hidden = !data?.user;
  if (!data?.user) { auth(); return; }
  const admin = data.user.admin;
  const today = day(Date.now());
  const bookings = data.bookings.filter(b => b.starts >= Date.now() || b.status === 'In Progress');
  const history = data.bookings.filter(b => !bookings.includes(b));
  const cards = rows => rows.length ? rows.map(bookingCard).join('') : '<p>No appointments here yet.</p>';
  const main = admin ? 'Today' : 'My bookings';
  const title = admin ? 'Myomi’s dashboard' : 'My account';
  document.querySelector('.portal h1').textContent = title;
  const links = admin
    ? [['upcoming','Today','📅'],['diary','Publish updates','🐾'],['history','Booking history','🗂️'],['settings','Services & availability','⚙️']]
    : [['upcoming','My bookings','📅'],['book','Book a visit','➕'],['pets','My pets','🐾'],['diary','Pet Diary','📖']];
  const staffNotice = !admin && new URLSearchParams(location.search).get('staff') === '1'
    ? '<p>You’re signed in as a client. Sign out to switch to your staff account.</p>' : '';
  app.innerHTML = '<p>Welcome, '+text(data.user.name)+'.</p>'+staffNotice+'<nav aria-label="'+title+'">'+
    links.map(([id,label,icon]) => '<a href="#'+id+'">'+emoji(icon)+'<span>'+label+'</span></a>').join('')+'</nav>'+
    section('upcoming',main,admin ? cards(bookings.filter(b=>b.status === 'In Progress' || day(b.starts) === today)) +
      '<h3>Other upcoming bookings</h3>'+cards(bookings.filter(b=>b.status !== 'In Progress' && day(b.starts) !== today))
      : '<h3>Upcoming visits</h3>'+cards(bookings)+'<h3>Past visits</h3>'+cards(history.slice().reverse()))+
    (admin ? section('settings','Services and availability',adminSettings()) :
      section('pets','Pet profiles',data.pets.map(p=>'<article><h3>'+text(p.name)+'</h3>'+profileSummary(p)+'<details><summary>Edit profile</summary>'+petForm(p)+'</details></article>').join('')+'<h3>Add a pet</h3>'+petForm())+
      section('book','Request care',bookingForm()))+
    section('diary',admin ? 'Publish updates' : 'Pet Diary',
      (admin ? publishingDesk()+'<h3>Published updates</h3>' : '')+'<div id="diary-feed">'+diary()+'</div>')+
    (admin ? section('history','Booking history',cards(history.slice().reverse())) : '');
  updateQuote();
  showSection();
}
function showSection(focus = false) {
  const panels = [...app.querySelectorAll(':scope > section')];
  if (!panels.length) return;
  const requested = location.hash === bookingIntake ? 'pets' : location.hash.slice(1);
  const id = panels.some(panel => panel.id === requested) ? requested : 'upcoming';
  for (const panel of panels) panel.hidden = panel.id !== id;
  for (const link of app.querySelectorAll('nav a')) {
    if (link.hash === '#'+id) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  if (focus) {
    const heading = document.getElementById(id).querySelector('h2');
    heading.tabIndex = -1;
    heading.focus();
  }
}
window.addEventListener('hashchange', () => showSection(true));
function updateQuote(event) {
  const booking = app.querySelector('[data-action="bookings"]');
  if (!booking) return;
  const service = find(data.services,Number(booking.querySelector('[name="service"]:checked')?.value));
  const slots = service ? availableSlots(service.minutes,undefined,service.id) : [];
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
  data = user ? await api('portal') : null;
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
  if (name === 'filter-pet' || name === 'filter-visit') {
    if (name === 'filter-pet') filterPet = value;
    else filterVisit = value;
    const feed = document.querySelector('#diary-feed');
    feed.innerHTML = diary();
    const filter = feed.querySelector('[data-diary-filter="'+name+'"]');
    if (filter) {
      filter.open = true;
      filter.querySelector(':checked')?.focus({ preventScroll:true });
    }
  }
});
app.addEventListener('click', async event => {
  const clearPhoto = event.target.closest('[data-clear-photo]');
  if (clearPhoto) {
    const { form } = clearPhoto;
    form.elements.camera.value = '';
    form.elements.photo.value = '';
    showPhotoSelection(form);
    form.elements.camera.focus({ preventScroll:true });
    return;
  }
  const control = event.target.closest('#refresh-diary');
  if (!control) return;
  const before = data;
  control.disabled = true;
  try {
    const latest = await api('portal');
    if (data !== before) return;
    data = latest;
    document.querySelector('#diary-feed').innerHTML = diary();
    document.querySelector('#refresh-diary')?.focus({preventScroll:true});
    feedback.textContent = 'Diary is up to date.';
  } catch (error) {
    if (data === before) feedback.textContent = error.message;
  } finally {
    control.disabled = false;
  }
});
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
  const fields = new FormData(form);
  const payload = Object.fromEntries(fields);
  if (form.dataset.id) payload.id = Number(form.dataset.id);
  if (payload.status === 'Cancelled' && !await confirmCancellation()) return;
  const control = event.submitter || form.querySelector('button[type="submit"]');
  control.disabled = true;
  feedback.textContent = 'Saving…';
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
    }
    if (action === 'services') payload.cents = Math.round(Number(payload.price)*100);
    if (action === 'slots' && !payload.id) {
      payload.starts = new Date(payload.starts).toISOString();
      payload.ends = new Date(payload.ends).toISOString();
    }
    if (action === 'events') {
      payload.photo = await readPhoto(fields.get('camera')?.size ? fields.get('camera') : fields.get('photo'));
      delete payload.camera;
    }
    await api(action,payload);
    const resumeBooking = action === 'pets' && !form.dataset.id && location.hash === bookingIntake;
    if (resumeBooking) history.replaceState(null,'','#book');
    if (action === 'bookings') {
      const next = new URL(location.href);
      next.searchParams.delete('service');
      next.hash = 'upcoming';
      history.replaceState(null,'',next);
    }
    if (action === 'status' && payload.status === 'In Progress') history.replaceState(null,'','#diary');
    await refresh();
    if (resumeBooking) showSection(true);
    feedback.textContent = action === 'bookings' ? 'Request sent. Myomi still needs to confirm your appointment.'
      : resumeBooking ? 'Pet added. You can continue booking.'
      : action === 'events' ? 'Published to the customer’s Pet Diary.' : 'Saved.';
  } catch (error) { feedback.textContent = error.message; }
  finally { control.disabled = false; }
});
logout.addEventListener('click',async () => {
  try {
    await api('logout',{});
    history.replaceState(null,'',location.pathname+location.search+(new URLSearchParams(location.search).get('staff') === '1' ? '#diary' : ''));
    filterPet = filterVisit = '';
    await refresh();
    feedback.textContent = 'Signed out.';
  } catch (error) { feedback.textContent = error.message; }
});
refresh().catch(error => {
  app.setAttribute('aria-busy','false');
  app.textContent = 'The care portal needs a running myo. server.';
  feedback.textContent = error.message;
});
