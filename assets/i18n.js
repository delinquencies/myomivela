import { en as uiEnglish, es as uiSpanish } from './ui-copy.js';
import { en as launchEnglish, es as launchSpanish } from './myo-copy.js';

// Language support shared by the portal and the diary (C2.6).
// - locale(): the reader's choice ('en' or 'es'), from the same storage key the public site uses.
// - t(key, params): a catalog string; {name} placeholders; { one, other } entries pluralise on params.count.
// - formatDate / formatMoney: Massachusetts time and US dollars, in the given language.
// Every error code the server sends has a Spanish entry under error.<code> (checked by tests/i18n.test.mjs).
// Error codes have matching English and Spanish entries. Unknown errors use a translated generic message.

let currentLanguage = 'en';
export const languages = ['en', 'es'];
export function locale() {
  let stored = '';
  try { stored = globalThis.localStorage?.getItem('myo-language') || ''; } catch { /* storage blocked */ }
  if (languages.includes(stored)) return stored;
  return currentLanguage;
}
export function setLocale(language) {
  if (!languages.includes(language)) return;
  currentLanguage = language;
  try { globalThis.localStorage?.setItem('myo-language', language); } catch { /* storage blocked */ }
  if (globalThis.document) document.documentElement.lang = language;
}

export const catalogs = {
  en: {
    ...uiEnglish,
    "error.time_unavailable": "That time is no longer available. Choose another.",
    "error.window_too_short": "This service does not fit in that window. Choose an earlier time.",
    "error.time_reserved": "That time is reserved. Choose another.",
    "error.hold_expired": "Your temporary hold expired or the visit changed. Review your booking again.",
    "error.price_changed": "The price changed. Review the new total.",
    "error.change_not_pending": "This change request is no longer pending.",
    "error.departure_check_required": "Confirm whether the doors are locked and the home is secured.",
    "error.secure_note_required": "Explain what was not secured and what you did.",
    "error.meet_is_free": "A Meet & Greet is complimentary. Its price must be zero.",
    "error.night_unavailable": "Myomi is unavailable for one of those nights. Choose different dates.",
    "error.stay_length": "Choose a stay of 1 to 28 nights.",
    "error.stay_reschedule_unsupported": "To change an overnight stay, cancel and request new dates.",
    "error.blocked": "Complete the outstanding requirements before booking.",
    "error.invalid_date": "Check the date.",
    "error.agreement_changed": "An updated agreement is available. Read it before continuing.",
    "error.vault_unconfigured": "Home access details are temporarily unavailable.",
    "error.vault_decrypt_failed": "Could not open home access details.",
    "error.access_not_yet": "Home access details unlock shortly before the visit.",
    "error.not_set": "This client has not saved home access details.",
    "error.invalid_method": "Choose how Myomi will enter.",
    "error.invalid_key_status": "Choose where the key is.",
    "error.unknown_field": "This field is not part of the report.",
    "error.invalid_field": "Check the report answer.",
    "error.invalid_score": "Choose how the visit went.",
    "error.feedback_closed": "Feedback for this visit can no longer be changed.",
    "error.invalid_locale": "Choose English or Spanish.",
    "error.invalid_subject": "Choose who this note is about.",
    ...Object.fromEntries(Object.entries(launchEnglish).map(([key, value]) => ['launch.'+key, value])),
    'status.Requested': 'Waiting for Myomi',
    'status.Confirmed': 'Confirmed',
    'status.In Progress': 'In progress',
    'status.Completed': 'Completed',
    'status.Cancelled': 'Cancelled',
    'booking.nights': { one:'{count} night', other:'{count} nights' },
    'booking.pets': { one:'{count} pet', other:'{count} pets' },
    'booking.visits': { one:'{count} visit', other:'{count} visits' },
  },
  es: {
    ...uiSpanish,
    ...Object.fromEntries(Object.entries(launchSpanish).map(([key, value]) => ['launch.'+key, value])),
    'status.Requested': 'Esperando a Myomi',
    'status.Confirmed': 'Confirmada',
    'status.In Progress': 'En curso',
    'status.Completed': 'Completada',
    'status.Cancelled': 'Cancelada',
    'booking.nights': { one:'{count} noche', other:'{count} noches' },
    'booking.pets': { one:'{count} mascota', other:'{count} mascotas' },
    'booking.visits': { one:'{count} visita', other:'{count} visitas' },
    'error.time_unavailable': 'Este horario ya no está disponible. Elige otro.',
    'error.window_too_short': 'Este servicio no cabe en ese horario. Elige una hora más temprana.',
    'error.time_reserved': 'Este horario ya está reservado. Elige otro.',
    'error.hold_expired': 'Tu reserva temporal venció o la visita cambió. Revisa la reserva de nuevo.',
    'error.price_changed': 'El precio cambió. Revisa el nuevo total.',
    'error.change_not_pending': 'Esta solicitud de cambio ya no está pendiente.',
    'error.departure_check_required': 'Confirma si las puertas quedaron cerradas y la casa asegurada.',
    'error.secure_note_required': 'Explica qué no quedó asegurado y qué hiciste al respecto.',
    'error.meet_is_free': 'La visita de presentación es gratuita: su precio debe ser 0.',
    'error.night_unavailable': 'Myomi no está disponible una de esas noches. Elige otras fechas.',
    'error.stay_length': 'Una estadía es de 1 a 28 noches.',
    'error.stay_reschedule_unsupported': 'Todavía no se puede mover una estadía. Cancélala y solicita nuevas fechas.',
    'error.blocked': 'Antes de reservar, completa lo que falta.',
    'error.invalid_date': 'Revisa la fecha.',
    'error.agreement_changed': 'Se publicó un acuerdo nuevo. Léelo primero.',
    'error.vault_unconfigured': 'Los datos de acceso no están disponibles en este momento.',
    'error.vault_decrypt_failed': 'No se pudieron abrir los datos de acceso.',
    'error.access_not_yet': 'Los datos de acceso se desbloquean poco antes de la visita.',
    'error.not_set': 'Este cliente no ha guardado datos de acceso.',
    'error.invalid_method': 'Elige cómo entra Myomi.',
    'error.invalid_key_status': 'Elige dónde está la llave.',
    'error.unknown_field': 'Ese campo no forma parte del reporte.',
    'error.invalid_field': 'Revisa la respuesta del reporte.',
    'error.invalid_score': 'Elige cómo fue la visita.',
    'error.feedback_closed': 'Ya no se puede cambiar la opinión sobre esta visita.',
    'error.invalid_locale': 'Elige inglés o español.',
    'error.invalid_subject': 'Elige sobre quién es la nota.',
  },
};
export const hasKey = (key, language = locale()) => key in (catalogs[language] || {});
export function t(key, params = {}, language = locale()) {
  let entry = catalogs[language]?.[key] ?? catalogs.en[key] ?? key;
  if (typeof entry === 'object') {
    const rule = new Intl.PluralRules(language === 'es' ? 'es-US' : 'en-US').select(params.count ?? 0);
    entry = entry[rule] ?? entry.other;
  }
  return entry.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}

const tags = { en:'en-US', es:'es-US' };
const zone = 'America/New_York';
const dateStyles = {
  visit: { dateStyle:'medium', timeStyle:'short' },   // Nov 18, 2026, 9:00 AM
  day: { weekday:'short', month:'short', day:'numeric' }, // Wed, Nov 18
  time: { timeStyle:'short' },                        // 9:00 AM
  date: { dateStyle:'medium' },                       // Nov 18, 2026
};
const formatters = new Map();
export function formatDate(ms, style = 'visit', language = locale()) {
  const key = language + ':' + style;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(tags[language] || 'en-US', { ...dateStyles[style], timeZone:zone }));
  return formatters.get(key).format(ms);
}
export function formatMoney(cents, language = locale()) {
  return new Intl.NumberFormat(tags[language] || 'en-US', { style:'currency', currency:'USD' }).format(cents / 100);
}

// Only catalog-controlled labels are translated. Pet names, care notes and other client content stay verbatim.
export function translateLabel(value) {
  return hasKey(value) ? t(value) : value;
}
