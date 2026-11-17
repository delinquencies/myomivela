export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const formatVisitDate = value => new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(value);

export const activityIcons = {
  Feeding:'🍽️', Water:'💧', 'Walk started':'🐾', 'Walk completed':'🦮', Potty:'💩',
  Medication:'💊', Playtime:'🎾', Rest:'💤', Observation:'👀', Custom:'✏️',
};

export function renderDiaryVisits(visits, eventsByVisit, petName, photoFor) {
  if (!visits.length) return '<p>No diary visits for this selection yet.</p>';

  function renderEntry(event) {
    const icon = Object.hasOwn(activityIcons,event.kind) ? activityIcons[event.kind] : '';
    const photo = photoFor(event);
    const image = photo ? '<img src="'+escapeHtml(photo.src)+'" alt="'+escapeHtml(photo.alt)+'" loading="lazy">' : '';
    const media = photo?.href ? '<a class="diary-photo" href="'+escapeHtml(photo.href)+'">'+image+'</a>' : image;
    return '<li><h4>'+
      (icon ? '<span class="choice-icon" aria-hidden="true">'+icon+'</span> ' : '')+
      escapeHtml(petName(event.pet))+' · '+escapeHtml(event.kind)+'</h4>'+
      '<time datetime="'+new Date(event.published).toISOString()+'">'+formatVisitDate(event.published)+'</time>'+
      '<p class="preserve">'+escapeHtml(event.notes)+'</p>'+media+'</li>';
  }

  return visits.map(visit => {
    const entries = eventsByVisit.get(visit.id) || [];
    const pets = visit.pet_ids.map(petName).filter(Boolean).join(', ');
    return '<article class="diary-visit"><header><p class="diary-status">'+escapeHtml(visit.status)+'</p><h3>'+escapeHtml(visit.service_name)+'</h3>'+
      '<p>'+formatVisitDate(visit.starts)+' · '+escapeHtml(pets)+'</p></header>'+
      (visit.summary ? '<p class="diary-summary preserve"><strong>Visit summary</strong><br>'+escapeHtml(visit.summary)+'</p>' : '')+
      (entries.length ? '<ol class="diary-timeline">'+entries.map(renderEntry).join('')+'</ol>' : '<p class="diary-summary">No updates for this visit yet.</p>')+'</article>';
  }).join('');
}
