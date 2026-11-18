// Language support shared by the portal and the diary (C2.6).
// - locale(): the reader's choice ('en' or 'es'), from the same storage key the public site uses.
// - t(key, params): a catalog string; {name} placeholders; { one, other } entries pluralise on params.count.
// - formatDate / formatMoney: Massachusetts time and US dollars, in the given language.
// Every error code the server sends has a Spanish entry under error.<code> (checked by tests/i18n.test.mjs).
// English errors use the server's own message, which is more specific than a catalog entry.

export const languages = ['en', 'es'];
export function locale() {
  let stored = '';
  try { stored = globalThis.localStorage?.getItem('myo-language') || ''; } catch { /* storage blocked */ }
  if (languages.includes(stored)) return stored;
  const page = globalThis.document?.documentElement?.lang;
  return languages.includes(page) ? page : 'en';
}
export function setLocale(language) {
  if (!languages.includes(language)) return;
  try { globalThis.localStorage?.setItem('myo-language', language); } catch { /* storage blocked */ }
}

export const catalogs = {
  en: {
    'status.Requested': 'Waiting for Myomi',
    'status.Confirmed': 'Confirmed',
    'status.In Progress': 'In progress',
    'status.Completed': 'Completed',
    'status.Cancelled': 'Cancelled',
    'booking.nights': { one:'{count} night', other:'{count} nights' },
    'booking.pets': { one:'{count} pet', other:'{count} pets' },
  },
  es: {
    'status.Requested': 'Esperando a Myomi',
    'status.Confirmed': 'Confirmada',
    'status.In Progress': 'En curso',
    'status.Completed': 'Completada',
    'status.Cancelled': 'Cancelada',
    'booking.nights': { one:'{count} noche', other:'{count} noches' },
    'booking.pets': { one:'{count} mascota', other:'{count} mascotas' },
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
