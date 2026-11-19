import { en as uiEnglish, es as uiSpanish } from './ui-copy.js';
import { en as launchEnglish, es as launchSpanish } from './myo-copy.js';
import {en as careEnglish,es as careSpanish} from './care-copy.js';

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
    ...careEnglish,
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
    "error.fee_rule_invalid": "Check the fee rule details.",
    "error.fee_rule_exists": "A fee rule with this code already exists.",
    "error.payments_unavailable": "Online payment isn’t available. Myomi can take payment another way.",
    "error.payment_provider_error": "The payment provider refused the request. Try again later.",
    "error.invalid_signature": "Invalid signature.",
    "error.nothing_due": "Nothing is due on this booking.",
    "error.refund_too_large": "You can refund at most what was paid.",
    "error.tip_too_large": "Tips on one visit are limited.",
    "error.tip_not_open": "You can tip once the visit has started.",
    "error.cancel_fee_changed": "Cancelling now has a fee. Review it before cancelling.",
    "error.series_visits_only": "Recurring visits are for walks and drop-in visits.",
    "error.invalid_time": "Choose a time on the hour or half hour.",
    "error.series_limit": "You have the most recurring visits allowed. End one first.",
    "error.series_ended": "This recurring visit has ended.",
    "error.no_package_credit": "You have no package credit for this service that is valid on that date.",
    "error.package_visits_only": "Packages are for walks and drop-in visits.",
    "error.backups_unconfigured": "Scheduled backups are not set up.",
    "error.owner_only": "Only the owner can do this.",
    "error.account_disabled": "This account has been switched off. Ask Myomi for access.",
    "error.invalid_role": "Choose owner or sitter.",
    "error.email_taken": "This email already has an account.",
    "error.staff_self": "You can’t change your own staff account here.",
    "error.last_owner": "Keep at least one active owner.",
    "error.invalid_service": "Please choose one of Myomi’s services.",
    "error.invalid_zip": "Enter a five-digit ZIP code.",
    "error.invalid_pets": "Tell us about each pet: dog, cat or another small pet, and their age if you know it.",
    "error.contact_required": "Add your phone, the address where Myomi will care for your pet, and your ZIP code.",
    "error.invalid_phone": "Enter a phone number with area code.",
    "error.pet_ineligible": "Dog walks are just for dogs. Try a drop-in visit for other pets.",
    "error.invalid_transition": "This visit has already moved on. Refresh to see where it stands.",
    "error.visit_not_active": "This visit isn’t in progress, so updates can’t be added to it. Refresh to see where it stands.",
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
    ...careSpanish,
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
    'error.fee_rule_invalid': 'Revisa los datos del cargo.',
    'error.fee_rule_exists': 'Ya existe un cargo con ese código.',
    'error.payments_unavailable': 'El pago en línea no está disponible. Myomi puede cobrar de otra forma.',
    'error.payment_provider_error': 'El proveedor de pagos rechazó la solicitud. Inténtalo más tarde.',
    'error.invalid_signature': 'Firma no válida.',
    'error.nothing_due': 'No hay nada pendiente de pago en esta reserva.',
    'error.refund_too_large': 'Solo puedes reembolsar lo que se pagó.',
    'error.tip_too_large': 'Las propinas de una visita tienen un límite.',
    'error.tip_not_open': 'Puedes dejar propina cuando la visita haya comenzado.',
    'error.cancel_fee_changed': 'Cancelar ahora tiene un cargo. Revísalo antes de cancelar.',
    'error.series_visits_only': 'Las visitas recurrentes son para paseos y visitas a domicilio.',
    'error.invalid_time': 'Elige una hora en punto o y media.',
    'error.series_limit': 'Tienes el máximo de visitas recurrentes. Termina una primero.',
    'error.series_ended': 'Esta visita recurrente ya terminó.',
    'error.no_package_credit': 'No tienes créditos de paquete válidos para este servicio en esa fecha.',
    'error.package_visits_only': 'Los paquetes son para paseos y visitas a domicilio.',
    'error.backups_unconfigured': 'Las copias de seguridad programadas no están configuradas.',
    'error.owner_only': 'Solo una cuenta de administración puede hacer esto.',
    'error.account_disabled': 'Esta cuenta está desactivada. Pide acceso a Myomi.',
    'error.invalid_role': 'Elige el rol: administración o cuidado.',
    'error.email_taken': 'Este correo ya tiene una cuenta.',
    'error.staff_self': 'No puedes cambiar tu propia cuenta del equipo aquí.',
    'error.last_owner': 'Debe quedar al menos una cuenta de administración activa.',
    'error.invalid_service': 'Elige uno de los servicios de Myomi.',
    'error.invalid_zip': 'Escribe un código postal de cinco dígitos.',
    'error.invalid_pets': 'Cuéntanos de cada mascota: perro, gato u otra mascota pequeña, y su edad si la sabes.',
    'error.contact_required': 'Agrega tu teléfono, la dirección donde Myomi cuidará a tu mascota y tu código postal.',
    'error.invalid_phone': 'Escribe un número de teléfono con código de área.',
    'error.pet_ineligible': 'Los paseos son solo para perros. Para otras mascotas, prueba una visita a domicilio.',
    'error.invalid_transition': 'Esta visita ya cambió de estado. Actualiza para ver cómo va.',
    'error.visit_not_active': 'Esta visita no está en curso, así que no se le pueden añadir novedades. Actualiza para ver cómo va.',
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
