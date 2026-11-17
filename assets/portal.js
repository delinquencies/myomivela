const app = document.querySelector('#app');
const feedback = document.querySelector('#feedback');
const logout = document.querySelector('#logout');
const text = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const find = (rows,id) => rows.find(row => row.id === id);
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents / 100);
const date = value => new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(value);
const day = value => new Intl.DateTimeFormat('en-CA',{dateStyle:'short',timeZone:'America/New_York'}).format(value);
const option = (value,label) => '<option value="'+text(value)+'">'+text(label)+'</option>';
const button = (label, style = '') => '<button class="'+style+'" type="submit">'+label+'</button>';
const form = (action, contents, id = '') => '<form data-action="'+action+'" data-id="'+id+'">'+contents+'</form>';
const input = (label,name,attributes = '') => '<label>'+label+'<input name="'+name+'" '+attributes+'></label>';
const area = (label,name,value = '',max = 3000) => '<label>'+label+'<textarea maxlength="'+max+'" name="'+name+'">'+text(value)+'</textarea></label>';
const select = (label,name,options,attributes = '') => '<label>'+label+'<select name="'+name+'" '+attributes+'>'+options+'</select></label>';
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
        button('Sign in'))+
      '<p><a class="text-link" href="./index.html">Go to the Client Portal</a></p>';
    return;
  }
  document.querySelector('.portal h1').textContent = 'Client portal.';
  const fields = input('Email','email','required type="email" maxlength="254" autocomplete="email"') +
    input('Password','password','required type="password" maxlength="128"');
  app.innerHTML = (location.hash === '#book' ? '<p>Sign in or create an account to request a visit.</p>' : '<p>Sign in to manage bookings, pet profiles, and your Pet Diary.</p>') + '<div class="grid">'+
    form('login','<h2>Sign in</h2>'+fields+button('Sign in'))+
    form('register','<h2>Create an account</h2>'+input('Name','name','required maxlength="100" autocomplete="name"')+
      fields+'<small>Use at least 12 characters for your password.</small>'+button('Create account'))+'</div>';
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
  return form('pets',groups+button(pet ? 'Save changes' : 'Add pet'),pet?.id);
}
function availableSlots(minutes, exclude, serviceId) {
  return data.slots.filter(slot => slot.ends-slot.starts >= minutes*60_000 &&
    (!serviceId || slot.service_ids.includes(serviceId)) &&
    !data.bookings.some(b => b.id !== exclude && ['Confirmed','In Progress'].includes(b.status) && slot.starts < b.ends && slot.starts + minutes*60_000 > b.starts));
}
function slotOptions(slots) {
  return slots.map(slot => option(slot.id,date(slot.starts))).join('');
}
function bookingForm() {
  if (!data.pets.length) return '<p><a class="text-link" href="#pets">Add a pet profile</a> to request care.</p>';
  if (!data.services.length || !data.slots.length) return '<p>No appointments are posted yet. Check back for availability.</p>';
  return '<p>Appointment times are shown in Massachusetts time. Myomi reviews each request before confirming.</p>' +
    form('bookings',select('Service','service',data.services.map(s => option(s.id,s.name+' · '+s.minutes+' min · '+money(s.cents))).join(''))+
    '<fieldset><legend>Pets attending</legend>'+ data.pets.map(p => '<label><input type="checkbox" name="pets" value="'+p.id+'"> '+text(p.name)+'</label>').join('')+'</fieldset>'+
    select('Available day','day','')+select('Appointment','slot','','required')+area('Care instructions for this visit','notes','',1500)+
    '<p data-quote></p>'+button('Submit booking request'));
}
function statusForm(booking,status,label) {
  const summary = status === 'Completed' ? '<label>Visit summary<textarea required maxlength="3000" name="summary"></textarea></label>' : '';
  return form('status','<input type="hidden" name="status" value="'+text(status)+'">'+summary+button(label,'secondary'),booking.id);
}
const activityIcons = {
  Feeding:'🍽️', Water:'💧', 'Walk started':'🐾', 'Walk completed':'🦮', Potty:'💩',
  Medication:'💊', Playtime:'🎾', Rest:'💤', Observation:'👀', Custom:'✏️',
};
function choice(name, value, label, icon = '') {
  return '<label><input type="radio" name="'+name+'" value="'+text(value)+'" required>'+
    '<span>'+(icon ? '<span aria-hidden="true" class="choice-icon">'+icon+'</span>' : '')+text(label)+'</span></label>';
}
function eventForm(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const petChoice = pets.length === 1
    ? '<input type="hidden" name="pet" value="'+pets[0].id+'"><p>Update for <strong>'+text(pets[0].name)+'</strong></p>'
    : '<fieldset class="tap-choices"><legend>Pet</legend><div>'+pets.map(pet => choice('pet',pet.id,pet.name)).join('')+'</div></fieldset>';
  return form('events',petChoice+
    '<fieldset class="tap-choices"><legend>Activity</legend><div>'+
    data.activityTypes.map(kind => choice('kind',kind,kind,activityIcons[kind])).join('')+'</div></fieldset>'+
    area('Details (include amounts, duration, dose or observations as appropriate)','notes')+
    '<fieldset class="photo-choices"><legend>Optional photo</legend>'+
    input('Take a photo','camera','type="file" accept="image/*" capture="environment"')+
    input('Choose from library','photo','type="file" accept="image/*"')+'</fieldset>'+
    button('Publish diary update'),booking.id);
}
function publishingDesk() {
  const visits = data.bookings.filter(booking => booking.status === 'In Progress');
  if (!visits.length) {
    return '<p><a class="text-link" href="#upcoming">Start a confirmed visit</a> to publish diary updates.</p>';
  }
  return visits.map(booking => '<article><h3>'+text(booking.service_name)+' for '+text(booking.customer)+'</h3>'+
    '<p>'+date(booking.starts)+'</p>'+eventForm(booking)+
    '<p><a class="text-link" href="#upcoming">Go to Today to complete the visit</a></p></article>').join('');
}
function bookingCard(booking) {
  const pets = booking.pet_ids.map(id => find(data.pets,id)).filter(Boolean);
  const active = booking.status === 'In Progress';
  let actions = '';
  if (data.user.admin) {
    if (booking.status === 'Requested') actions += statusForm(booking,'Confirmed','Approve request') + statusForm(booking,'Cancelled','Decline request');
    if (booking.status === 'Confirmed') actions += statusForm(booking,'In Progress','Start visit') + statusForm(booking,'Cancelled','Cancel booking');
    if (active) actions += '<p><a class="text-link" href="#diary">Publish a diary update</a></p>'+statusForm(booking,'Completed','Complete visit');
  } else if (booking.starts > Date.now() && ['Requested','Confirmed'].includes(booking.status)) {
    actions += statusForm(booking,'Cancelled','Cancel booking');
  }
  if (['Requested','Confirmed'].includes(booking.status) && (data.user.admin || booking.starts > Date.now())) {
    const slots = slotOptions(availableSlots((booking.ends-booking.starts)/60000,booking.id));
    if (slots) actions += form('reschedule',select('New time','slot',slots,'required')+button('Reschedule','secondary'),booking.id);
  }
  return '<article><h3>'+text(booking.service_name)+' · '+text(booking.status)+'</h3><p>'+date(booking.starts)+' – '+date(booking.ends)+' · '+money(booking.cents)+'</p>'+
    (data.user.admin ? '<p>'+text(booking.customer)+' · '+text(booking.email)+'</p>' : '')+
    '<p>Pets: '+pets.map(p=>text(p.name)).join(', ')+'</p><p class="preserve">'+text(booking.notes)+'</p>'+
    (booking.arrived ? '<p>Arrived: '+date(booking.arrived)+'</p>' : '') + (booking.departed ? '<p>Completed: '+date(booking.departed)+'</p>' : '')+
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
  const options = (rows, current, labelFor) => rows.map(row => '<option value="'+row.id+'"'+(String(row.id) === current ? ' selected' : '')+'>'+text(labelFor(row))+'</option>').join('');
  if (!visits.some(visit => String(visit.id) === filterVisit)) filterVisit = '';
  const visible = visits.filter(visit => !filterVisit || String(visit.id) === filterVisit);
  const entry = event => '<li><h4>'+
    (activityIcons[event.kind] ? '<span class="choice-icon" aria-hidden="true">'+activityIcons[event.kind]+'</span> ' : '')+
    text(find(data.pets,event.pet)?.name)+' · '+text(event.kind)+'</h4>'+
    '<time datetime="'+new Date(event.published).toISOString()+'">'+date(event.published)+'</time>'+
    '<p class="preserve">'+text(event.notes)+'</p>'+
    (event.has_photo ? '<a class="diary-photo" href="/api/photos/'+event.id+'"><img src="/api/photos/'+event.id+'" alt="Open full photo from the care visit" loading="lazy"></a>' : '')+'</li>';
  return '<div class="diary-toolbar"><div class="diary-filters">'+
    select('Filter by pet','filter-pet',option('','All pets')+options(data.pets,filterPet,p=>p.name),'id="filter-pet"')+
    select('Filter by visit','filter-visit',option('','All visits')+options(visits,filterVisit,b=>b.service_name+' · '+date(b.starts)),'id="filter-visit"')+
    '</div><button type="button" class="secondary" id="refresh-diary">Refresh updates</button></div>'+
    (visible.length ? visible.map(visit => {
      const entries = eventsByVisit.get(visit.id) || [];
      return '<article class="diary-visit"><header><p class="diary-status">'+text(visit.status)+'</p><h3>'+text(visit.service_name)+'</h3>'+
        '<p>'+date(visit.starts)+' · '+text(visit.pet_ids.map(id=>find(data.pets,id)?.name).filter(Boolean).join(', '))+'</p></header>'+
        (visit.summary ? '<p class="diary-summary preserve"><strong>Visit summary</strong><br>'+text(visit.summary)+'</p>' : '')+
        (entries.length ? '<ol class="diary-timeline">'+entries.map(entry).join('')+'</ol>' : '<p class="diary-summary">No updates for this visit yet.</p>')+'</article>';
    }).join('') : '<p>No diary visits for this selection yet.</p>');
}
function adminSettings() {
  return '<div class="grid">'+form('services','<h3>Set a service price</h3>'+
    select('Service','name',['Dog walking','Drop-in visit','Overnight pet sitting'].map(s=>option(s,s)).join(''))+
    input('Duration in minutes','minutes','type="number" min="1" max="1440" required')+
    input('Price in USD','price','type="number" min="0" max="10000" step="0.01" required')+button('Save service'))+
    form('slots','<h3>Publish an appointment window</h3><p>Enter the window in your device’s local time. The portal displays Massachusetts time.</p>'+
    input('Starts','starts','type="datetime-local" required')+input('Ends','ends','type="datetime-local" required')+button('Publish window'))+'</div>'+
    '<p>'+data.services.map(s=>text(s.name)+' · '+s.minutes+' min · '+money(s.cents)).join('<br>')+'</p>'+
    data.slots.map(s=>form('slots','<p>'+date(s.starts)+' – '+date(s.ends)+'</p>'+button('Remove window','secondary'),s.id)).join('');
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
    ? [['upcoming','Today'],['diary','Publish updates'],['history','Booking history'],['settings','Services & availability']]
    : [['upcoming','My bookings'],['book','Book a visit'],['pets','My pets'],['diary','Pet Diary']];
  const staffNotice = !admin && new URLSearchParams(location.search).get('staff') === '1'
    ? '<p>You’re signed in as a client. Sign out to switch to your staff account.</p>' : '';
  app.innerHTML = '<p>Welcome, '+text(data.user.name)+'.</p>'+staffNotice+'<nav aria-label="'+title+'">'+
    links.map(([id,label]) => '<a href="#'+id+'">'+label+'</a>').join('')+'</nav>'+
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
  const requested = location.hash.slice(1);
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
  const service = find(data.services,Number(booking.elements.service.value));
  const slots = availableSlots(service.minutes,undefined,service.id);
  const picker = booking.elements.day;
  if (event?.target.name !== 'day') {
    picker.innerHTML = [...new Set(slots.map(slot => day(slot.starts)))].map(value => option(value,value)).join('');
  }
  booking.elements.slot.innerHTML = slotOptions(slots.filter(slot => day(slot.starts) === picker.value));
  booking.querySelector('[data-quote]').textContent = 'Request total: '+money(service.cents)+' · '+service.minutes+' minutes.';
  booking.querySelector('button').disabled = booking.elements.slot.options.length === 0;
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
app.addEventListener('change', event => {
  if (['camera','photo'].includes(event.target.name) && event.target.files?.length) {
    event.target.form.elements[event.target.name === 'camera' ? 'photo' : 'camera'].value = '';
  }
  if (['service','day'].includes(event.target.name)) updateQuote(event);
  if (event.target.id === 'filter-pet' || event.target.id === 'filter-visit') {
    if (event.target.id === 'filter-pet') filterPet = event.target.value;
    else filterVisit = event.target.value;
    document.querySelector('#diary-feed').innerHTML = diary();
    document.getElementById(event.target.id).focus();
  }
});
app.addEventListener('click', async event => {
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
app.addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.target;
  const action = form.dataset.action;
  const fields = new FormData(form);
  const payload = Object.fromEntries(fields);
  if (form.dataset.id) payload.id = Number(form.dataset.id);
  if (payload.status === 'Cancelled' && !window.confirm('Cancel or decline this booking?')) return;
  const control = event.submitter || form.querySelector('button');
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
    for (const key of ['service','slot','pet','minutes']) if (key in payload) payload[key] = Number(payload[key]);
    if (action === 'bookings') {
      payload.pets = fields.getAll('pets').map(Number);
      payload.cents = find(data.services,payload.service).cents;
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
    if (action === 'bookings') history.replaceState(null,'','#upcoming');
    if (action === 'status' && payload.status === 'In Progress') history.replaceState(null,'','#diary');
    await refresh();
    feedback.textContent = action === 'bookings' ? 'Request sent. Myomi still needs to confirm your appointment.'
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
