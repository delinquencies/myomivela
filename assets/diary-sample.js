import { t } from './i18n.js';
import { renderDiaryVisits } from './diary.js';

function renderSample() {
const visit = {
  id: 1,
  status: 'Completed',
  service_name: 'Dog walking',
  starts: Date.parse('2026-11-12T12:00:00-05:00'),
  pet_ids: [1],
  summary: t("Cooper took a 30-minute walk with plenty of sniff breaks. Lunch was served, the water bowl was refilled, and he settled in for a nap."),
};
const events = [
  { pet: 1, kind: 'Feeding', published: Date.parse('2026-11-12T12:35:00-05:00'), notes: t("Lunch served and water refreshed.") },
  { pet: 1, kind: 'Walk completed', published: Date.parse('2026-11-12T12:30:00-05:00'), notes: t("Cooper explored the woodland path and stopped to sniff all his favorite spots."), photo: true },
];
const samplePhoto = new URL('./home/diary-editorial.jpg',import.meta.url).href;
document.querySelector('#sample-diary').innerHTML = renderDiaryVisits(
  [visit],
  new Map([[visit.id, events]]),
  () => 'Cooper',
  event => event.photo ? { src:samplePhoto, alt:t("A golden retriever on a woodland path") } : null,
);

}
renderSample();
window.addEventListener('myo:languagechange', renderSample);
