import { formatDate } from './i18n.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// English until the diary's strings are translated (Codex X2.6).
export const formatVisitDate = value => formatDate(value, 'visit', 'en');

export const activityIcons = {
  Feeding:'🍽️', Water:'💧', 'Walk started':'🐾', 'Walk completed':'🦮', Potty:'💩',
  Medication:'💊', Playtime:'🎾', Rest:'💤', Observation:'👀', Custom:'✏️',
  Arrival:'🧳', 'Evening check-in':'🌙', 'Morning check-in':'🌅', Departure:'👋',
};

// The departure check recorded at completion (C1.3); older visits have none.
const departureTime = new Intl.DateTimeFormat('en-US',{timeStyle:'short',timeZone:'America/New_York'});
function departureLine(check) {
  if (!check) return '';
  return check.secured
    ? '<p class="diary-departure">🔒 Home secured at '+escapeHtml(departureTime.format(check.at))+'</p>'
    : '<p class="diary-departure diary-departure-warning preserve">⚠️ Not fully secured: '+escapeHtml(check.note)+'</p>';
}
export function renderDiaryVisits(visits, eventsByVisit, petName, photoFor) {
  if (!visits.length) return '<p>No diary visits for this selection yet.</p>';

  // Report-card answers as short chips; staff see answers hidden from the customer, greyed out.
  function renderFields(fields = []) {
    if (!fields.length) return '';
    return '<ul class="diary-fields">'+fields.map(field => {
      const text = field.type === 'yesno' ? (field.value ? '✓ ' : '✗ ')+field.label
        : field.type === 'count' ? field.label+': '+field.value : field.label+': '+field.value;
      return '<li'+(field.hidden ? ' class="diary-field-hidden" title="Hidden from the client"' : '')+'>'+escapeHtml(text)+'</li>';
    }).join('')+'</ul>';
  }
  function renderEntry(event) {
    const icon = Object.hasOwn(activityIcons,event.kind) ? activityIcons[event.kind] : '';
    const photo = photoFor(event);
    const image = photo ? '<img src="'+escapeHtml(photo.src)+'" alt="'+escapeHtml(photo.alt)+'" loading="lazy">' : '';
    const media = photo?.href ? '<a class="diary-photo" href="'+escapeHtml(photo.href)+'">'+image+'</a>' : image;
    return '<li><h4>'+
      (icon ? '<span class="choice-icon" aria-hidden="true">'+icon+'</span> ' : '')+
      escapeHtml(petName(event.pet))+' · '+escapeHtml(event.kind)+'</h4>'+
      '<time datetime="'+new Date(event.published).toISOString()+'">'+formatVisitDate(event.published)+'</time>'+
      '<p class="preserve">'+escapeHtml(event.notes)+'</p>'+renderFields(event.fields)+media+'</li>';
  }

  return visits.map(visit => {
    const entries = eventsByVisit.get(visit.id) || [];
    const pets = visit.pet_ids.map(petName).filter(Boolean).join(', ');
    return '<article class="diary-visit"><header><p class="diary-status">'+escapeHtml(visit.status)+'</p><h3>'+escapeHtml(visit.service_name)+'</h3>'+
      '<p data-visit-date>'+formatVisitDate(visit.starts)+' · '+escapeHtml(pets)+'</p></header>'+
      (visit.summary ? '<p class="diary-summary preserve"><strong>Visit summary</strong><br>'+escapeHtml(visit.summary)+'</p>' : '')+
      departureLine(visit.departure_check)+
      (entries.length ? '<ol class="diary-timeline">'+entries.map(renderEntry).join('')+'</ol>' : '<p class="diary-summary">No updates for this visit yet.</p>')+'</article>';
  }).join('');
}
